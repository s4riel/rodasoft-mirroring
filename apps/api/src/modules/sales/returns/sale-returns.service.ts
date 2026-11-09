import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  approvalRequestMachine,
  cancellationWindowEndsAt,
  Decimal,
  InvalidTransitionError,
  isReturnableSaleStatus,
  isWithinReturnWindow,
  needsReturnApproval,
  normalizeReturnLines,
  returnableQuantity,
  returnTotals,
  saleReturnMachine,
  validateReturnDecision,
  validateReturnHeader,
  validateReturnLines,
  type CreateSaleReturnInput,
  type ReturnDecisionInput,
  type SaleReturnDetail,
  type SaleStatus,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { MembershipService } from '../../access/membership.service';
import { StockMovementService } from '../../inventory/stock-movement.service';
import { CashShiftsService } from '../cash/cash-shifts.service';
import { cashErrors } from '../cash/cash.errors';
import { nextDocumentNumber } from '../document-sequence';
import { returnErrors, returnIssueError } from './sale-returns.errors';
import { SaleReturnsQueryService } from './sale-returns-query.service';

/** The ref type of the movements and cash movements a return writes. */
export const SALE_RETURN_REF_TYPE = 'SALE_RETURN';

const SALE_INCLUDE = {
  items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  invoice: true,
  warehouse: { select: { name: true } },
} satisfies Prisma.SaleInclude;
type LoadedSale = Prisma.SaleGetPayload<{ include: typeof SALE_INCLUDE }>;

const RETURN_APPLY_INCLUDE = {
  items: { include: { saleItem: { select: { productId: true } } } },
  sale: { include: { invoice: true, warehouse: { select: { name: true } } } },
} satisfies Prisma.SaleReturnInclude;
type ReturnToApply = Prisma.SaleReturnGetPayload<{ include: typeof RETURN_APPLY_INCLUDE }>;

const asTx = (tx: TenantTransaction) => tx as unknown as Prisma.TransactionClient;
const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Prisma `P2002` on the `(company_id, idempotency_key)` unique index of the returns. */
function isIdempotencyKeyConflict(err: unknown): boolean {
  const known = err as { code?: string; meta?: { target?: unknown } };
  return known?.code === 'P2002' && JSON.stringify(known.meta?.target ?? '').includes('idempotency_key');
}

/**
 * Returns of a sale (HU-VEN-21). Under the approval limit (`sales.returnApprovalLimit`, decision #15) a return is approved at
 * once: the pieces marked "A stock" go back to the sale's warehouse, the refund is paid or recorded, and the credit and debit
 * note of the original invoice is created, all in one transaction. Above the limit the return waits as `PENDING_APPROVAL` with
 * an `ApprovalRequest` and nothing else changes until Management decides.
 *
 * Lock order (the POS's and the cancellation's): the cash shift `FOR SHARE`, then the sale row `FOR UPDATE`, then the return,
 * then the products by id. The sale lock serialises two returns of one sale and a return against a cancellation request.
 */
@Injectable()
export class SaleReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly membership: MembershipService,
    private readonly stock: StockMovementService,
    private readonly shifts: CashShiftsService,
    private readonly queries: SaleReturnsQueryService,
  ) {}

  /** Registers a return. A repeated `idempotencyKey` of the same sale returns the return the first call made. */
  async create(input: CreateSaleReturnInput, idempotencyKey: string): Promise<SaleReturnDetail> {
    const headerErrors = validateReturnHeader(input);
    if (headerErrors.length > 0) throw returnErrors.invalid(headerErrors);
    // a cash refund leaves the register of the caller, so the caller needs an open shift even if Management pays later
    const shift = input.refundMethod === 'CASH' ? await this.shifts.requireOpenShift() : null;
    const companyId = this.requireCompany();
    const userId = this.requireUser();

    let returnId: string;
    try {
      returnId = await this.prisma.tenant.$transaction((tx) => this.runCreate(tx, input, idempotencyKey, { companyId, userId, shift }));
    } catch (err) {
      // two requests with one key for two different sales both pass the lookup; the unique index stops the second
      if (isIdempotencyKeyConflict(err)) throw returnErrors.idempotencyKeyReused();
      throw err;
    }
    return this.queries.detail(returnId);
  }

  private async runCreate(
    tx: TenantTransaction,
    input: CreateSaleReturnInput,
    idempotencyKey: string,
    caller: { companyId: string; userId: string; shift: { id: string; register: { id: string; name: string } } | null },
  ): Promise<string> {
    const { companyId, userId, shift } = caller;
    if (shift) await this.lockOpenShift(tx, shift.id, companyId);

    const earlierId = await this.findReplayableReturn(tx, idempotencyKey, input.saleId);
    if (earlierId) return earlierId;

    await this.lockSaleOfOperableBranch(tx, input.saleId, companyId);
    // a concurrent request with the same key may have committed while this one waited for the sale lock: replay it
    const concurrentId = await this.findReplayableReturn(tx, idempotencyKey, input.saleId);
    if (concurrentId) return concurrentId;
    const sale = await tx.sale.findFirstOrThrow({ where: { id: input.saleId }, include: SALE_INCLUDE });
    if (!isReturnableSaleStatus(sale.status as SaleStatus) || !sale.invoice) throw returnErrors.saleNotReturnable(sale.status);
    const [windowDays, approvalLimit] = await Promise.all([
      this.settings.get('sales.returnWindowDays', tx),
      this.settings.get('sales.returnApprovalLimit', tx),
    ]);
    if (!isWithinReturnWindow(sale.createdAt, new Date(), windowDays)) {
      throw returnErrors.windowExpired((cancellationWindowEndsAt(sale.createdAt, windowDays) as Date).toISOString());
    }

    const returned = await this.returnedQuantities(tx, sale.id, companyId);
    const issues = validateReturnLines(
      sale.items.map((item) => ({ saleItemId: item.id, quantity: item.quantity, returnedQuantity: returned.get(item.id) ?? 0 })),
      input.items,
    );
    if (issues.length > 0) throw returnIssueError(issues);
    if (input.refundMethod === 'STORE_CREDIT' && !sale.customerId) throw returnErrors.storeCreditNeedsCustomer();

    const lines = normalizeReturnLines(input.items);
    const itemById = new Map(sale.items.map((item) => [item.id, item]));
    const previous = await tx.saleReturn.aggregate({ where: { saleId: sale.id, companyId, status: { not: 'REJECTED' } }, _sum: { total: true } });
    const asked = new Map<string, number>();
    for (const line of lines) asked.set(line.saleItemId, (asked.get(line.saleItemId) ?? 0) + line.quantity);
    const completesSale = sale.items.every((item) => returnableQuantity(item.quantity, returned.get(item.id) ?? 0) - (asked.get(item.id) ?? 0) === 0);
    const totals = returnTotals({
      sale: { subtotal: Decimal.of(sale.subtotal.toFixed(2)), total: Decimal.of(sale.total.toFixed(2)) },
      previousRefunded: Decimal.of((previous._sum.total ?? new Prisma.Decimal(0)).toFixed(2)),
      lines: lines.map((line) => ({ unitPrice: (itemById.get(line.saleItemId) as LoadedSale['items'][number]).unitPrice.toFixed(2), quantity: line.quantity })),
      completesSale,
    });
    // what is left for the return that completes the sale can only be negative if earlier roundings drifted: stop, do not refund it
    if (totals.total.isNegative() || totals.lines.some((amount) => amount.isNegative())) throw returnErrors.totalInvalid();

    const pending = needsReturnApproval(totals.total, approvalLimit);
    const number = await nextDocumentNumber(tx, companyId, 'return');
    const comment = input.comment?.trim() || null;
    const created = await tx.saleReturn.create({
      data: {
        companyId,
        saleId: sale.id,
        number,
        status: pending ? 'PENDING_APPROVAL' : 'APPROVED',
        reason: input.reason,
        comment,
        refundMethod: input.refundMethod as 'CASH' | 'STORE_CREDIT' | 'TRANSFER',
        refundReference: input.refundReference?.trim() || null,
        total: totals.total.toString(),
        registerId: shift?.register.id ?? null,
        idempotencyKey,
        createdById: userId,
        items: {
          create: lines.map((line, index) => ({
            companyId,
            saleItemId: line.saleItemId,
            quantity: line.quantity,
            condition: line.condition,
            refundAmount: totals.lines[index].toString(),
          })),
        },
      },
      select: { id: true },
    });

    if (pending) {
      await this.requestApproval(tx, { returnId: created.id, number, saleNumber: sale.number, total: totals.total.toString(), reason: input.reason, comment, companyId, userId });
      return created.id;
    }
    const ret = await tx.saleReturn.findFirstOrThrow({ where: { id: created.id }, include: RETURN_APPLY_INCLUDE });
    await this.applyApproved(tx, ret, { companyId, userId, shiftId: shift?.id ?? null, action: 'sales.return.create' });
    return created.id;
  }

  /** The id of the return an earlier call made with this key; fails when that call was for another sale. */
  private async findReplayableReturn(tx: TenantTransaction, idempotencyKey: string, saleId: string): Promise<string | null> {
    const existing = await tx.saleReturn.findFirst({ where: { idempotencyKey }, select: { id: true, saleId: true } });
    if (!existing) return null;
    if (existing.saleId !== saleId) throw returnErrors.idempotencyKeyReused();
    return existing.id;
  }

  /** `PENDING_APPROVAL → APPROVED`: the stock, the refund and the credit note happen now, in one transaction. */
  async approve(returnId: string, input: ReturnDecisionInput): Promise<SaleReturnDetail> {
    const comment = this.reply('APPROVE', input);
    const companyId = this.requireCompany();
    const userId = this.requireUser();

    await this.prisma.tenant.$transaction(async (tx) => {
      const head = await tx.saleReturn.findFirst({
        where: { id: returnId },
        select: { saleId: true, registerId: true, refundMethod: true, sale: { select: { branchId: true } } },
      });
      if (!head) throw returnErrors.returnNotFound();
      await this.requireOperableBranch(head.sale.branchId);

      // the refund leaves the register that asked for it, in a shift that is still open: a closed shift has its totals frozen
      const shiftId = head.refundMethod === 'CASH' ? await this.lockRefundShift(tx, companyId, head.registerId) : null;
      await this.lockSaleRow(tx, head.saleId, companyId);
      const pending = await this.lockPendingReturn(tx, returnId, companyId);

      const ret = await tx.saleReturn.findFirstOrThrow({ where: { id: returnId }, include: RETURN_APPLY_INCLUDE });
      await this.applyApproved(tx, ret, { companyId, userId, shiftId, action: 'sales.return.approve', requestId: pending.requestId });
      await tx.approvalRequest.update({
        where: { id: pending.requestId },
        data: { status: approvalRequestMachine.next('PENDING', 'approve'), decidedById: userId, decidedAt: new Date(), comment },
      });
    });
    return this.queries.detail(returnId);
  }

  /** `PENDING_APPROVAL → REJECTED`: nothing else is written; the requester gets the reply. */
  async reject(returnId: string, input: ReturnDecisionInput): Promise<SaleReturnDetail> {
    const comment = this.reply('REJECT', input);
    const companyId = this.requireCompany();
    const userId = this.requireUser();

    await this.prisma.tenant.$transaction(async (tx) => {
      const head = await tx.saleReturn.findFirst({ where: { id: returnId }, select: { saleId: true, sale: { select: { branchId: true } } } });
      if (!head) throw returnErrors.returnNotFound();
      await this.requireOperableBranch(head.sale.branchId);

      await this.lockSaleRow(tx, head.saleId, companyId);
      const pending = await this.lockPendingReturn(tx, returnId, companyId);
      const next = this.nextStatus(pending.status, 'reject');
      await tx.saleReturn.update({ where: { id: returnId }, data: { status: next } });
      await tx.approvalRequest.update({
        where: { id: pending.requestId },
        data: { status: approvalRequestMachine.next('PENDING', 'reject'), decidedById: userId, decidedAt: new Date(), comment },
      });

      await this.audit.log(
        { action: 'sales.return.reject', entity: 'SaleReturn', entityId: returnId, before: { status: pending.status }, after: { status: next, requestId: pending.requestId } },
        asTx(tx),
      );
      await this.outbox.publish(
        'sales.return.rejected',
        { returnId, number: pending.number, saleId: head.saleId, requestId: pending.requestId, requestedById: pending.createdById, decidedById: userId, comment },
        { tx, idempotencyKey: `return-rejected:${returnId}` },
      );
    });
    return this.queries.detail(returnId);
  }

  /** The approval request of a return above the limit, with its audit entry and event. */
  private async requestApproval(
    tx: TenantTransaction,
    d: { returnId: string; number: string; saleNumber: string; total: string; reason: string; comment: string | null; companyId: string; userId: string },
  ): Promise<void> {
    const request = await tx.approvalRequest.create({
      data: { companyId: d.companyId, type: 'RETURN', subjectId: d.returnId, requestedById: d.userId, reason: d.reason, requesterComment: d.comment },
      select: { id: true },
    });
    await this.audit.log(
      {
        action: 'sales.return.request',
        entity: 'SaleReturn',
        entityId: d.returnId,
        after: { status: 'PENDING_APPROVAL', number: d.number, saleNumber: d.saleNumber, total: d.total, requestId: request.id },
      },
      asTx(tx),
    );
    await this.outbox.publish(
      'sales.return.requested',
      { returnId: d.returnId, number: d.number, saleNumber: d.saleNumber, total: d.total, requestId: request.id, requestedById: d.userId },
      { tx, idempotencyKey: `return-requested:${d.returnId}` },
    );
  }

  /**
   * Everything an approved return does, in the caller's transaction: the "A stock" pieces go back to the warehouse of the sale
   * (products in id order, so two returns never lock them in opposite order), a cash refund leaves the shift, the credit note
   * of the original invoice is created, and the return becomes `APPROVED`.
   */
  private async applyApproved(
    tx: TenantTransaction,
    ret: ReturnToApply,
    ctx: { companyId: string; userId: string; shiftId: string | null; action: 'sales.return.create' | 'sales.return.approve'; requestId?: string },
  ): Promise<void> {
    const { sale } = ret;
    if (!sale.invoice) throw returnErrors.saleNotReturnable(sale.status);
    const next = ret.status === 'APPROVED' ? 'APPROVED' : this.nextStatus(ret.status, 'approve');

    const restock = new Map<string, number>();
    for (const item of ret.items) {
      if (item.condition === 'RESTOCK') restock.set(item.saleItem.productId, (restock.get(item.saleItem.productId) ?? 0) + item.quantity);
    }
    for (const [productId, quantity] of [...restock].sort(([a], [b]) => byId(a, b))) {
      await this.stock
        .apply(tx, {
          productId,
          warehouseId: sale.warehouseId,
          type: 'RETURN',
          quantity,
          reason: `Devolución ${ret.number} · venta ${sale.number}`,
          refType: SALE_RETURN_REF_TYPE,
          refId: ret.id,
          refNumber: ret.number,
        })
        .catch((err: unknown) => {
          if (err instanceof UnprocessableEntityException && (err.getResponse() as { code?: string }).code === 'WAREHOUSE_INACTIVE') {
            throw returnErrors.warehouseInactive(sale.warehouse.name);
          }
          throw err;
        });
    }

    if (ret.refundMethod === 'CASH' && ctx.shiftId) {
      await tx.cashMovement.create({
        data: {
          companyId: ctx.companyId,
          shiftId: ctx.shiftId,
          type: 'REFUND',
          amount: ret.total.toFixed(2),
          reason: `Devolución ${ret.number} · venta ${sale.number}`,
          refType: SALE_RETURN_REF_TYPE,
          refId: ret.id,
          userId: ctx.userId,
        },
      });
    }

    const creditNote = await tx.creditNote.create({
      data: {
        companyId: ctx.companyId,
        returnId: ret.id,
        invoiceId: sale.invoice.id,
        status: 'PENDING',
        total: ret.total.toFixed(2),
        customerTaxName: sale.invoice.customerTaxName,
        customerDocumentType: sale.invoice.customerDocumentType,
        customerDocumentNumber: sale.invoice.customerDocumentNumber,
      },
      select: { id: true },
    });
    await tx.saleReturn.update({ where: { id: ret.id }, data: { status: next, approvedAt: new Date(), shiftId: ctx.shiftId } });

    const pieces = ret.items.reduce((acc, item) => acc + item.quantity, 0);
    const scrapPieces = ret.items.filter((item) => item.condition === 'SCRAP').reduce((acc, item) => acc + item.quantity, 0);
    await this.audit.log(
      {
        action: ctx.action,
        entity: 'SaleReturn',
        entityId: ret.id,
        // a return approved at creation had no earlier status
        before: ctx.action === 'sales.return.create' ? null : { status: ret.status },
        after: {
          status: next,
          number: ret.number,
          saleNumber: sale.number,
          total: ret.total.toFixed(2),
          refundMethod: ret.refundMethod,
          pieces,
          scrapPieces,
          creditNoteId: creditNote.id,
          requestId: ctx.requestId ?? null,
        },
      },
      asTx(tx),
    );
    await this.outbox.publish(
      'sales.return.completed',
      {
        returnId: ret.id,
        number: ret.number,
        creditNoteId: creditNote.id,
        invoiceId: sale.invoice.id,
        saleId: sale.id,
        saleNumber: sale.number,
        total: ret.total.toFixed(2),
        refundMethod: ret.refundMethod,
        customerId: sale.customerId,
        branchId: sale.branchId,
        shiftId: ctx.shiftId,
      },
      { tx, idempotencyKey: `return-completed:${ret.id}` },
    );
  }

  /** Units each sale line has already given back in returns that are not rejected. */
  private async returnedQuantities(tx: TenantTransaction, saleId: string, companyId: string): Promise<Map<string, number>> {
    const rows = await tx.saleReturnItem.groupBy({
      by: ['saleItemId'],
      where: { companyId, saleItem: { saleId }, return: { status: { not: 'REJECTED' } } },
      _sum: { quantity: true },
    });
    return new Map(rows.map((row) => [row.saleItemId, row._sum.quantity ?? 0]));
  }

  /** The return locked with its open approval request; fails when it is not waiting for a decision. */
  private async lockPendingReturn(tx: TenantTransaction, returnId: string, companyId: string) {
    const rows = await tx.$queryRaw<{ status: string; number: string; created_by_id: string }[]>`
      SELECT status::text AS status, number, created_by_id FROM sale_returns WHERE id = ${returnId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    const [row] = rows;
    if (!row) throw returnErrors.returnNotFound();
    const request = await tx.approvalRequest.findFirst({ where: { type: 'RETURN', subjectId: returnId, status: 'PENDING' }, select: { id: true } });
    if (row.status !== 'PENDING_APPROVAL' || !request) throw returnErrors.notPending();
    return { status: row.status as 'PENDING_APPROVAL', number: row.number, createdById: row.created_by_id, requestId: request.id };
  }

  private nextStatus(status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED', event: 'approve' | 'reject'): 'APPROVED' | 'REJECTED' {
    try {
      return saleReturnMachine.next(status, event) as 'APPROVED' | 'REJECTED';
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw returnErrors.notPending();
      throw err;
    }
  }

  /** The sale row locked, hiding a sale of a branch the caller does not operate. */
  private async lockSaleOfOperableBranch(tx: TenantTransaction, saleId: string, companyId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ branch_id: string }[]>`
      SELECT branch_id FROM sales WHERE id = ${saleId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw returnErrors.saleNotFound();
    try {
      await this.requireOperableBranch(rows[0].branch_id);
    } catch {
      throw returnErrors.saleNotFound();
    }
  }

  private async lockSaleRow(tx: TenantTransaction, saleId: string, companyId: string): Promise<void> {
    await tx.$queryRaw`SELECT id FROM sales WHERE id = ${saleId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
  }

  /** A branch the caller does not operate: the return does not exist for them. */
  private async requireOperableBranch(branchId: string): Promise<void> {
    const membershipId = this.cls.get('membershipId');
    const branchIds = membershipId ? await this.membership.operableBranchIds(membershipId) : [];
    if (branchIds && !branchIds.includes(branchId)) throw returnErrors.returnNotFound();
  }

  /** The caller's shift must still be open when the money goes out; `FOR SHARE` makes a close of it wait for this return. */
  private async lockOpenShift(tx: TenantTransaction, shiftId: string, companyId: string): Promise<void> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM cash_shifts WHERE id = ${shiftId}::uuid AND company_id = ${companyId}::uuid FOR SHARE`;
    if (rows[0]?.status !== 'OPEN') throw cashErrors.shiftNotOpen();
  }

  /** The open shift of the register that asked for the return, locked `FOR SHARE`; without one the refund has nowhere to go. */
  private async lockRefundShift(tx: TenantTransaction, companyId: string, registerId: string | null): Promise<string> {
    const register = registerId ? await tx.cashRegister.findFirst({ where: { id: registerId }, select: { name: true } }) : null;
    const name = register?.name ?? '';
    const shift = registerId ? await tx.cashShift.findFirst({ where: { registerId, status: 'OPEN' }, select: { id: true } }) : null;
    if (!shift) throw returnErrors.refundShiftNotOpen(name);
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM cash_shifts WHERE id = ${shift.id}::uuid AND company_id = ${companyId}::uuid FOR SHARE`;
    if (rows[0]?.status !== 'OPEN') throw returnErrors.refundShiftNotOpen(name);
    return shift.id;
  }

  /** The reply of a decision, trimmed; `null` when there is none. Rejecting must have one. */
  private reply(decision: 'APPROVE' | 'REJECT', input: ReturnDecisionInput): string | null {
    const errors = validateReturnDecision(decision, input.comment);
    if (errors.length > 0) throw returnErrors.invalidDecision(errors);
    const comment = input.comment?.trim() ?? '';
    return comment === '' ? null : comment;
  }

  private requireCompany(): string {
    const id = this.cls.get('companyId');
    if (!id) throw returnErrors.saleNotFound();
    return id;
  }

  private requireUser(): string {
    const id = this.cls.get('userId');
    if (!id) throw returnErrors.saleNotFound();
    return id;
  }
}
