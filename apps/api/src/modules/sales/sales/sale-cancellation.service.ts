import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, type SaleOrigin } from '@prisma/client';
import {
  approvalRequestMachine,
  cancellationImpact,
  type CancellationDecision,
  type CancellationDecisionInput,
  type CancellationDecisionSummary,
  cancellationWindowEndsAt,
  type CancellationReason,
  type CancellationRequestInput,
  type CancellationReview,
  Decimal,
  InvalidTransitionError,
  invoiceCancellationAction,
  invoiceCancellationEvent,
  invoiceMachine,
  type InvoiceStatus,
  isCancellableStatus,
  isWithinCancellationWindow,
  SALE_REF_TYPE,
  saleMachine,
  siatCancellationReasonCode,
  validateCancellationDecision,
  validateCancellationRequest,
  type SaleCancellationResponse,
  type SaleCancellationState,
  type SaleStatus,
} from '@rodasoft/domain';
import { SiatUnavailableError } from '@rodasoft/siat';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { SiatGatewayFactory } from '../../../common/siat/siat-gateway.factory';
import { MembershipService } from '../../access/membership.service';
import { StockMovementService } from '../../inventory/stock-movement.service';
import { posErrors } from '../pos/pos.errors';
import { returnErrors } from '../returns/sale-returns.errors';
import { cancellationErrors } from './sale-cancellation.errors';
import { SaleVisibilityService } from './sale-visibility.service';

/** What `stateOf` needs from a sale: the detail query already reads all of it. */
export interface CancellationSale {
  id: string;
  status: SaleStatus;
  createdAt: Date;
  warehouse: { name: string };
  /** null for a sale born from an order dispatch (HU-VEN-20): it was not sold at a register */
  shift: { register: { name: string } } | null;
  /** A sale born from an order dispatch is not cancelled here: the order balance would not follow (HU-VEN-20). */
  origin: SaleOrigin;
}

/** What deciding a cancellation reads of a sale: its lines, payments and invoice, and where it was sold. */
const DECISION_INCLUDE = {
  items: { select: { productId: true, quantity: true } },
  payments: { select: { method: true, amount: true } },
  invoice: { select: { id: true, status: true, number: true } },
  warehouse: { select: { name: true } },
  shift: { select: { registerId: true, register: { select: { name: true } } } },
} satisfies Prisma.SaleInclude;

type SaleForDecision = Prisma.SaleGetPayload<{ include: typeof DECISION_INCLUDE }>;

/** The reason written on the stock and cash movements of an approved cancellation (a user-visible text). */
const cancellationReason = (saleNumber: string) => `Anulación de venta ${saleNumber}`;

/** What approving the sale will do, from its own lines, payments and invoice. */
function impactOf(sale: SaleForDecision) {
  return cancellationImpact({
    invoiceStatus: (sale.invoice?.status ?? 'PENDING') as InvoiceStatus,
    lines: sale.items,
    payments: sale.payments.map((payment) => ({ method: payment.method, amount: payment.amount.toFixed(2) })),
  });
}

/**
 * Asking for the cancellation of a sale and taking the request back (HU-VEN-14), and Management deciding it (HU-VEN-15). Asking creates a `CANCELLATION` approval
 * request and moves the sale to `CANCELLATION_PENDING`; nothing else changes: the invoice stays valid and no stock or cash
 * moves until Management approves. Approving cancels the sale, voids the invoice, returns the stock and refunds the cash;
 * rejecting puts the sale back to `COMPLETED` with the reply. Both actions lock the sale row, so two calls on the same sale run one after
 * the other and the partial unique index on pending requests is only a second line of defence.
 */
@Injectable()
export class SaleCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly visibility: SaleVisibilityService,
    private readonly membership: MembershipService,
    private readonly stock: StockMovementService,
    private readonly gateways: SiatGatewayFactory,
  ) {}

  /** `COMPLETED → CANCELLATION_PENDING`, with a pending request that carries the reason and the cashier's comment. */
  async request(saleId: string, input: CancellationRequestInput): Promise<SaleCancellationResponse> {
    const errors = validateCancellationRequest(input);
    if (errors.length > 0) throw cancellationErrors.invalid(errors);
    const comment = input.comment.trim();
    const days = await this.settings.get('sales.cancellationWindowDays');
    const companyId = this.requireCompany();
    const userId = this.requireUser();

    return this.prisma.tenant.$transaction(async (tx) => {
      const locked = await this.lockSale(tx, saleId, companyId);
      const { origin } = await tx.sale.findFirstOrThrow({ where: { id: saleId }, select: { origin: true } });
      if (origin === 'ORDER') throw cancellationErrors.fromOrder();
      // the sale is locked: a return cannot be registered meanwhile, so the stock is never returned twice (HU-VEN-21)
      const returns = await tx.saleReturn.count({ where: { saleId, status: { not: 'REJECTED' } } });
      if (returns > 0) throw returnErrors.hasReturns();
      let next: SaleStatus;
      try {
        next = saleMachine.next(locked.status, 'requestCancellation');
      } catch (err) {
        if (!(err instanceof InvalidTransitionError)) throw err;
        throw locked.status === 'CANCELLATION_PENDING' ? cancellationErrors.alreadyPending() : cancellationErrors.notCancellable(locked.status);
      }
      if (!isWithinCancellationWindow(new Date(), locked.createdAt, days)) {
        throw cancellationErrors.windowExpired((cancellationWindowEndsAt(locked.createdAt, days) as Date).toISOString());
      }

      let created: { id: string };
      try {
        created = await tx.approvalRequest.create({
          data: { companyId, type: 'CANCELLATION', subjectId: saleId, requestedById: userId, reason: input.reason, requesterComment: comment },
          select: { id: true },
        });
      } catch (err) {
        // the partial unique index: a pending request exists that the status did not show
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw cancellationErrors.alreadyPending();
        throw err;
      }
      await tx.sale.update({ where: { id: saleId }, data: { status: next } });

      await this.audit.log(
        {
          action: 'sales.sale.cancellation-request',
          entity: 'Sale',
          entityId: saleId,
          before: { status: locked.status },
          after: { status: next, requestId: created.id, reason: input.reason },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      await this.outbox.publish(
        'sales.cancellation.requested',
        { saleId, saleNumber: locked.number, total: locked.total, requestId: created.id, reason: input.reason, requestedById: userId },
        { tx, idempotencyKey: `cancellation-requested:${created.id}` },
      );
      return { saleId, status: next };
    });
  }

  /** `CANCELLATION_PENDING → COMPLETED`: the requester, or who may approve cancellations, takes the request back. */
  async withdraw(saleId: string): Promise<SaleCancellationResponse> {
    const companyId = this.requireCompany();
    const userId = this.requireUser();
    const granted = await this.granted();

    return this.prisma.tenant.$transaction(async (tx) => {
      const { locked, pending } = await this.lockPendingCancellation(tx, saleId, companyId);
      if (pending.requestedById !== userId && !granted.has('sales.cancellations.approve')) throw cancellationErrors.withdrawForbidden();
      await this.requireNotInSiatCancellation(tx, saleId);

      const next = saleMachine.next(locked.status, 'withdrawCancellation');
      const requestStatus = approvalRequestMachine.next('PENDING', 'withdraw');
      await tx.approvalRequest.update({ where: { id: pending.id }, data: { status: requestStatus, decidedById: userId, decidedAt: new Date() } });
      await tx.sale.update({ where: { id: saleId }, data: { status: next } });

      await this.audit.log(
        {
          action: 'sales.sale.cancellation-withdraw',
          entity: 'Sale',
          entityId: saleId,
          before: { status: locked.status },
          after: { status: next, requestId: pending.id },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      await this.outbox.publish(
        'sales.cancellation.withdrawn',
        { saleId, saleNumber: locked.number, requestId: pending.id, withdrawnById: userId },
        { tx, idempotencyKey: `cancellation-withdrawn:${pending.id}` },
      );
      return { saleId, status: next };
    });
  }

  /** What Management sees before deciding (VP-15c): the request, the sale and what an approval will undo. */
  async review(saleId: string): Promise<CancellationReview> {
    const scope = await this.visibility.resolve();
    const sale = await this.prisma.tenant.sale.findFirst({ where: { AND: [{ id: saleId }, scope.where] }, include: DECISION_INCLUDE });
    if (!sale || !sale.invoice) throw posErrors.saleNotFound();
    const pending = await this.prisma.tenant.approvalRequest.findFirst({ where: { type: 'CANCELLATION', subjectId: saleId, status: 'PENDING' } });
    if (!pending) throw cancellationErrors.notPending();

    const [openShift, audit] = await Promise.all([
      sale.shift
        ? this.prisma.tenant.cashShift.findFirst({ where: { registerId: sale.shift.registerId, status: 'OPEN' }, select: { id: true } })
        : Promise.resolve(null),
      this.prisma.auditLog.findMany({
        where: { companyId: sale.companyId, entity: 'Sale', entityId: saleId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { action: true, createdAt: true, userId: true },
      }),
    ]);
    const names = await this.userNames([pending.requestedById, ...audit.map((row) => row.userId)]);

    return {
      saleId,
      saleNumber: sale.number,
      request: {
        id: pending.id,
        reason: pending.reason as CancellationReason,
        comment: pending.requesterComment ?? '',
        requestedBy: names.get(pending.requestedById) ?? '',
        requestedAt: pending.createdAt.toISOString(),
      },
      sale: {
        total: sale.total.toFixed(2),
        createdAt: sale.createdAt.toISOString(),
        invoice: { status: sale.invoice.status as InvoiceStatus, number: sale.invoice.number },
      },
      impact: {
        ...impactOf(sale),
        warehouseName: sale.warehouse.name,
        registerName: sale.shift?.register.name ?? '',
        shiftOpen: openShift !== null,
      },
      audit: audit.map((row) => ({ action: row.action, at: row.createdAt.toISOString(), userName: row.userId ? (names.get(row.userId) ?? null) : null })),
    };
  }

  /**
   * `CANCELLATION_PENDING → CANCELLED`: the invoice is voided (or asked to be cancelled in the SIAT), every unit goes back to
   * the sale's warehouse and the cash the sale kept leaves the register of the sale. All of it commits or none of it does.
   * The lock order is the POS's: the shift, then the sale, then the products by id.
   */
  async approve(saleId: string, input: CancellationDecisionInput): Promise<SaleCancellationResponse> {
    const comment = this.reply('APPROVE', input);
    const companyId = this.requireCompany();
    const userId = this.requireUser();
    // a valid invoice is cancelled in the SIAT first, outside any transaction (HU-FAC-10); null when the invoice never got there
    const siat = await this.cancelInvoiceInSiat(saleId, companyId);

    return this.prisma.tenant.$transaction(async (tx) => {
      const scope = await this.visibility.resolve();
      const sale = await tx.sale.findFirst({ where: { AND: [{ id: saleId }, scope.where] }, include: DECISION_INCLUDE });
      if (!sale || !sale.invoice) throw posErrors.saleNotFound();
      const impact = impactOf(sale);

      // the refund leaves the register of the sale, in a shift that is still open: a closed shift has its totals frozen
      const refund = Decimal.of(impact.cashRefund);
      const refundShiftId =
        refund.cmp(Decimal.zero()) > 0 && sale.shift
          ? await this.lockRefundShift(tx, companyId, sale.shift.registerId, sale.shift.register.name)
          : null;

      const { locked, pending } = await this.lockPendingCancellation(tx, saleId, companyId);

      // read after the lock: the SIAT epic may have moved the invoice meanwhile
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { saleId }, select: { id: true, status: true } });
      // after the SIAT cancelled it the invoice waits in CANCELLATION_PENDING for this commit; otherwise the local rules apply
      const invoiceAction = siat ? 'REQUEST_SIAT_CANCELLATION' : invoiceCancellationAction(invoice.status as InvoiceStatus);
      const invoiceEvent = siat
        ? invoice.status === 'CANCELLATION_PENDING'
          ? ('approveCancellation' as const)
          : null
        : invoiceCancellationEvent(invoice.status as InvoiceStatus);
      if (!invoiceEvent) throw cancellationErrors.invoiceNotCancellable(invoice.status);
      // the invoice was issued after the SIAT step decided it needed no SIAT call: approving again goes through the SIAT
      if (!siat && (invoice.status === 'VALID' || invoice.status === 'CANCELLATION_PENDING')) throw cancellationErrors.invoiceNotCancellable(invoice.status);

      const nextSale = saleMachine.next(locked.status, 'approveCancellation');
      const nextRequest = approvalRequestMachine.next('PENDING', 'approve');
      const nextInvoice = invoiceMachine.next(invoice.status as InvoiceStatus, invoiceEvent);

      await this.returnStock(tx, sale, locked.number);
      if (refundShiftId) await this.refundCash(tx, { companyId, shiftId: refundShiftId, amount: impact.cashRefund, saleId, saleNumber: locked.number, userId });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: nextInvoice, cancelledAt: new Date(), ...(siat ? { cancellationReasonCode: siat.reasonCode } : {}) },
      });
      await tx.sale.update({ where: { id: saleId }, data: { status: nextSale } });
      await tx.approvalRequest.update({ where: { id: pending.id }, data: { status: nextRequest, decidedById: userId, decidedAt: new Date(), comment } });

      await this.audit.log(
        {
          action: 'sales.sale.cancellation-approve',
          entity: 'Sale',
          entityId: saleId,
          before: { status: locked.status, invoiceStatus: invoice.status },
          after: {
            status: nextSale,
            invoiceStatus: nextInvoice,
            invoiceAction,
            requestId: pending.id,
            stockUnits: impact.stockUnits,
            cashRefund: impact.cashRefund,
            manualRefunds: impact.manualRefunds,
          },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      await this.outbox.publish(
        'sales.cancellation.approved',
        {
          saleId,
          saleNumber: locked.number,
          requestId: pending.id,
          requestedById: pending.requestedById,
          decidedById: userId,
          invoiceId: invoice.id,
          invoiceAction,
          cashRefund: impact.cashRefund,
          manualRefunds: impact.manualRefunds,
          // a sale on credit collected nothing for this part: accounts receivable (HU-CON-03) takes it off the customer's balance
          creditReversal: sale.payments
            .filter((payment) => payment.method === 'CREDIT')
            .reduce((acc, payment) => acc.add(Decimal.of(payment.amount.toFixed(2))), Decimal.zero())
            .toString(),
          customerId: sale.customerId,
        },
        { tx, idempotencyKey: `cancellation-approved:${pending.id}` },
      );
      return { saleId, status: nextSale };
    });
  }

  /** `CANCELLATION_PENDING → COMPLETED`: the sale stays as it was and the requester gets the reply. */
  async reject(saleId: string, input: CancellationDecisionInput): Promise<SaleCancellationResponse> {
    const comment = this.reply('REJECT', input);
    const companyId = this.requireCompany();
    const userId = this.requireUser();

    return this.prisma.tenant.$transaction(async (tx) => {
      const { locked, pending } = await this.lockPendingCancellation(tx, saleId, companyId);
      await this.requireNotInSiatCancellation(tx, saleId);

      const nextSale = saleMachine.next(locked.status, 'rejectCancellation');
      const nextRequest = approvalRequestMachine.next('PENDING', 'reject');
      await tx.approvalRequest.update({ where: { id: pending.id }, data: { status: nextRequest, decidedById: userId, decidedAt: new Date(), comment } });
      await tx.sale.update({ where: { id: saleId }, data: { status: nextSale } });

      await this.audit.log(
        {
          action: 'sales.sale.cancellation-reject',
          entity: 'Sale',
          entityId: saleId,
          before: { status: locked.status },
          after: { status: nextSale, requestId: pending.id },
        },
        tx as unknown as Prisma.TransactionClient,
      );
      await this.outbox.publish(
        'sales.cancellation.rejected',
        { saleId, saleNumber: locked.number, requestId: pending.id, requestedById: pending.requestedById, decidedById: userId, comment },
        { tx, idempotencyKey: `cancellation-rejected:${pending.id}` },
      );
      return { saleId, status: nextSale };
    });
  }

  /** What the sale detail says about cancelling (VP-15): the open request, whether another may be asked, and what an approval undoes. */
  async stateOf(sale: CancellationSale): Promise<SaleCancellationState> {
    const [days, granted] = await Promise.all([this.settings.get('sales.cancellationWindowDays'), this.granted()]);
    const windowEndsAt = cancellationWindowEndsAt(sale.createdAt, days);
    const row =
      sale.status === 'CANCELLATION_PENDING'
        ? await this.prisma.tenant.approvalRequest.findFirst({ where: { type: 'CANCELLATION', subjectId: sale.id, status: 'PENDING' } })
        : null;
    const requester = row ? await this.prisma.user.findUnique({ where: { id: row.requestedById }, select: { name: true } }) : null;
    const lastDecision = sale.status === 'CANCELLATION_PENDING' ? null : await this.lastDecisionOf(sale.id);

    return {
      canRequest: sale.origin === 'POS' && isCancellableStatus(sale.status) && isWithinCancellationWindow(new Date(), sale.createdAt, days),
      windowEndsAt: windowEndsAt?.toISOString() ?? null,
      lastDecision,
      pending: row
        ? {
            id: row.id,
            reason: row.reason as CancellationReason,
            comment: row.requesterComment ?? '',
            requestedBy: requester?.name ?? '',
            requestedAt: row.createdAt.toISOString(),
            canWithdraw: row.requestedById === this.cls.get('userId') || granted.has('sales.cancellations.approve'),
          }
        : null,
      impact: { warehouseName: sale.warehouse.name, registerName: sale.shift?.register.name ?? '' },
    };
  }

  /** The request that ended the sale's last cancellation attempt, when it ended in a decision (a withdrawn one says nothing). */
  private async lastDecisionOf(saleId: string): Promise<CancellationDecisionSummary | null> {
    const row = await this.prisma.tenant.approvalRequest.findFirst({
      where: { type: 'CANCELLATION', subjectId: saleId, status: { not: 'PENDING' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if ((row?.status !== 'APPROVED' && row?.status !== 'REJECTED') || !row.decidedAt) return null;
    const names = await this.userNames([row.decidedById]);
    return {
      status: row.status,
      decidedBy: (row.decidedById && names.get(row.decidedById)) || '',
      decidedAt: row.decidedAt.toISOString(),
      comment: row.comment ?? '',
    };
  }

  /**
   * HU-FAC-10 · Cancels a valid invoice in the SIAT before any stock or cash moves, in three steps so no transaction is open while the
   * SIAT is called: (A) under the sale lock the invoice goes `VALID → CANCELLATION_PENDING`; (B) the SIAT is asked; (C) is the commit
   * of `approve`. If the SIAT does not answer or refuses, the invoice goes back to `VALID`, nothing else was touched and the request
   * stays pending. An invoice already in `CANCELLATION_PENDING` is a crash between B and C: the SIAT is asked what it did, so it is
   * never cancelled twice. Returns null when the invoice needs no SIAT call (never issued, or rejected: it is voided locally).
   */
  private async cancelInvoiceInSiat(saleId: string, companyId: string): Promise<{ reasonCode: number } | null> {
    const start = await this.prisma.tenant.$transaction(async (tx) => {
      const { pending } = await this.lockPendingCancellation(tx, saleId, companyId);
      // the approver must be able to see the sale before the SIAT is touched: a refusal after it would leave the SIAT cancelled and the sale open
      const scope = await this.visibility.resolve();
      if (!(await tx.sale.findFirst({ where: { AND: [{ id: saleId }, scope.where] }, select: { id: true } }))) throw posErrors.saleNotFound();
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { saleId }, select: { id: true, status: true, cuf: true } });
      if (invoice.status !== 'VALID' && invoice.status !== 'CANCELLATION_PENDING') return null;
      if (!invoice.cuf) throw cancellationErrors.invoiceNotCancellable(invoice.status);
      // what the local commit will need is checked before the SIAT is touched: once it cancels, only a re-approval can finish
      await this.requireLocalCommitPossible(tx, saleId);
      // the reason of the request decides the SIN code; anything the table does not know goes as the generic "badly issued"
      const reasonCode = siatCancellationReasonCode(pending.reason ?? '') ?? 1;
      const resumed = invoice.status === 'CANCELLATION_PENDING';
      if (!resumed) {
        const next = invoiceMachine.next('VALID', 'requestCancellation');
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: next } });
        await this.audit.log(
          { action: 'invoicing.invoice.cancellation-start', entity: 'Invoice', entityId: invoice.id, before: { status: 'VALID' }, after: { status: next, reasonCode } },
          tx as unknown as Prisma.TransactionClient,
        );
      }
      return { invoiceId: invoice.id, cuf: invoice.cuf, reasonCode, resumed };
    });
    if (!start) return null;

    try {
      const gateway = await this.gateways.forCurrentCompany();
      // always ask first: another approval (or a crash before the commit) may already have got the SIAT to cancel it
      const known = await gateway.invoiceStatus(start.cuf);
      if (known.status !== 'CANCELLED') {
        const result = await gateway.cancelInvoice(start.cuf, start.reasonCode);
        if (!result.cancelled) {
          // a refusal is only final when the SIAT still holds the invoice as valid
          const after = await gateway.invoiceStatus(start.cuf);
          if (after.status !== 'CANCELLED') {
            await this.revertSiatCancellation(saleId, companyId, start.invoiceId, 'refused');
            throw cancellationErrors.siatRefused(result.messages);
          }
        }
      }
    } catch (err) {
      if (err instanceof SiatUnavailableError) {
        // only the attempt that moved the invoice to CANCELLATION_PENDING gives it back: for a resumed one the SIAT's real state is unknown
        if (!start.resumed) await this.revertSiatCancellation(saleId, companyId, start.invoiceId, 'unavailable');
        throw cancellationErrors.siatUnavailable();
      }
      throw err;
    }
    return { reasonCode: start.reasonCode };
  }

  /** The refund has an open shift to leave from and the warehouse can take the stock back: the two refusals of the local commit. */
  private async requireLocalCommitPossible(tx: TenantTransaction, saleId: string): Promise<void> {
    const sale = await tx.sale.findFirstOrThrow({ where: { id: saleId }, include: DECISION_INCLUDE });
    if (Decimal.of(impactOf(sale).cashRefund).cmp(Decimal.zero()) > 0 && sale.shift) {
      const open = await tx.cashShift.findFirst({ where: { registerId: sale.shift.registerId, status: 'OPEN' }, select: { id: true } });
      if (!open) throw cancellationErrors.refundShiftNotOpen(sale.shift.register.name);
    }
    const warehouse = await tx.warehouse.findFirst({ where: { id: sale.warehouseId }, select: { status: true } });
    if (warehouse?.status === 'INACTIVE') throw cancellationErrors.warehouseInactive(sale.warehouse.name);
  }

  /**
   * While the SIAT cancellation of the invoice is under way (`CANCELLATION_PENDING`) the request can only be approved: withdrawing or
   * rejecting it now would leave a sale that is open next to an invoice the SIAT has cancelled.
   */
  private async requireNotInSiatCancellation(tx: TenantTransaction, saleId: string): Promise<void> {
    const invoice = await tx.invoice.findUnique({ where: { saleId }, select: { status: true } });
    if (invoice?.status === 'CANCELLATION_PENDING') throw cancellationErrors.inProgress();
  }

  /** The SIAT did not cancel: the invoice is valid again and the request waits for a new decision. */
  private async revertSiatCancellation(saleId: string, companyId: string, invoiceId: string, why: 'unavailable' | 'refused'): Promise<void> {
    await this.prisma.tenant.$transaction(async (tx) => {
      await this.lockSale(tx, saleId, companyId);
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { status: true } });
      if (invoice.status !== 'CANCELLATION_PENDING') return;
      const next = invoiceMachine.next('CANCELLATION_PENDING', 'rejectCancellation');
      await tx.invoice.update({ where: { id: invoiceId }, data: { status: next } });
      await this.audit.log(
        { action: 'invoicing.invoice.cancellation-revert', entity: 'Invoice', entityId: invoiceId, before: { status: 'CANCELLATION_PENDING' }, after: { status: next, why } },
        tx as unknown as Prisma.TransactionClient,
      );
    });
  }

  /** The sale locked and its open cancellation request; fails when the sale is not waiting for a decision. */
  private async lockPendingCancellation(tx: TenantTransaction, saleId: string, companyId: string) {
    const locked = await this.lockSale(tx, saleId, companyId);
    const pending = await tx.approvalRequest.findFirst({
      where: { type: 'CANCELLATION', subjectId: saleId, status: 'PENDING' },
      select: { id: true, requestedById: true, reason: true },
    });
    if (!pending || locked.status !== 'CANCELLATION_PENDING') throw cancellationErrors.notPending();
    return { locked, pending };
  }

  /** Every unit goes back to the sale's warehouse, products in id order so two decisions never lock them in opposite order. */
  private async returnStock(tx: TenantTransaction, sale: SaleForDecision, saleNumber: string): Promise<void> {
    const units = new Map<string, number>();
    for (const item of sale.items) units.set(item.productId, (units.get(item.productId) ?? 0) + item.quantity);
    for (const [productId, quantity] of [...units].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      await this.stock
        .apply(tx, {
          productId,
          warehouseId: sale.warehouseId,
          type: 'SALE_CANCELLATION',
          quantity,
          reason: cancellationReason(saleNumber),
          refType: SALE_REF_TYPE,
          refId: sale.id,
          refNumber: saleNumber,
        })
        .catch((err: unknown) => {
          // the inventory says it with its own code; Management needs to know what to do about it
          if (err instanceof UnprocessableEntityException && (err.getResponse() as { code?: string }).code === 'WAREHOUSE_INACTIVE') {
            throw cancellationErrors.warehouseInactive(sale.warehouse.name);
          }
          throw err;
        });
    }
  }

  /** The type says the money goes out; the amount is positive, like the other movements. */
  private async refundCash(
    tx: TenantTransaction,
    refund: { companyId: string; shiftId: string; amount: string; saleId: string; saleNumber: string; userId: string },
  ): Promise<void> {
    await tx.cashMovement.create({
      data: {
        companyId: refund.companyId,
        shiftId: refund.shiftId,
        type: 'REFUND',
        amount: refund.amount,
        reason: cancellationReason(refund.saleNumber),
        refType: SALE_REF_TYPE,
        refId: refund.saleId,
        userId: refund.userId,
      },
    });
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    const users = unique.length ? await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } }) : [];
    return new Map(users.map((user) => [user.id, user.name]));
  }

  /** The reply of a decision, trimmed; `null` when there is none. Rejecting must have one. */
  private reply(decision: CancellationDecision, input: CancellationDecisionInput): string | null {
    const errors = validateCancellationDecision({ decision, comment: input.comment });
    if (errors.length > 0) throw cancellationErrors.invalidDecision(errors);
    const comment = input.comment?.trim() ?? '';
    return comment === '' ? null : comment;
  }

  /**
   * The open shift of the register the sale was made in, locked `FOR SHARE` like the POS does, so a close of that shift waits
   * for this decision. Without one the refund has nowhere to go.
   */
  private async lockRefundShift(tx: TenantTransaction, companyId: string, registerId: string, registerName: string): Promise<string> {
    const shift = await tx.cashShift.findFirst({ where: { registerId, status: 'OPEN' }, select: { id: true } });
    if (!shift) throw cancellationErrors.refundShiftNotOpen(registerName);
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM cash_shifts WHERE id = ${shift.id}::uuid AND company_id = ${companyId}::uuid FOR SHARE`;
    if (rows[0]?.status !== 'OPEN') throw cancellationErrors.refundShiftNotOpen(registerName);
    return shift.id;
  }

  /**
   * The sale as the caller may see it, locked until the transaction ends. A sale the caller cannot see is a sale that does not
   * exist (the same rule as the history), and the status is read after the lock so a concurrent decision is never missed.
   */
  private async lockSale(
    tx: TenantTransaction,
    saleId: string,
    companyId: string,
  ): Promise<{ status: SaleStatus; createdAt: Date; number: string; total: string }> {
    const scope = await this.visibility.resolve();
    const visible = await tx.sale.findFirst({ where: { AND: [{ id: saleId }, scope.where] }, select: { id: true } });
    if (!visible) throw posErrors.saleNotFound();
    const rows = await tx.$queryRaw<{ status: SaleStatus; created_at: Date; number: string; total: Prisma.Decimal }[]>`
      SELECT status::text AS status, created_at, number, total
      FROM sales WHERE id = ${saleId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw posErrors.saleNotFound();
    const [row] = rows;
    return { status: row.status, createdAt: row.created_at, number: row.number, total: row.total.toFixed(2) };
  }

  private async granted(): Promise<Set<string>> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.permissions(membershipId) : new Set<string>();
  }

  private requireCompany(): string {
    const id = this.cls.get('companyId');
    if (!id) throw posErrors.saleNotFound();
    return id;
  }

  private requireUser(): string {
    const id = this.cls.get('userId');
    if (!id) throw posErrors.saleNotFound();
    return id;
  }
}
