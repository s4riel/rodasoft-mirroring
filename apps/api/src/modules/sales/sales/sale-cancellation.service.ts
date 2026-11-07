import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  approvalRequestMachine,
  cancellationWindowEndsAt,
  type CancellationReason,
  type CancellationRequestInput,
  InvalidTransitionError,
  isCancellableStatus,
  isWithinCancellationWindow,
  saleMachine,
  validateCancellationRequest,
  type SaleCancellationResponse,
  type SaleCancellationState,
  type SaleStatus,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { MembershipService } from '../../access/membership.service';
import { posErrors } from '../pos/pos.errors';
import { cancellationErrors } from './sale-cancellation.errors';
import { SaleVisibilityService } from './sale-visibility.service';

/** What `stateOf` needs from a sale: the detail query already reads all of it. */
export interface CancellationSale {
  id: string;
  status: SaleStatus;
  createdAt: Date;
  warehouse: { name: string };
  shift: { register: { name: string } };
}

/**
 * Asking for the cancellation of a sale and taking the request back (HU-VEN-14). Asking creates a `CANCELLATION` approval
 * request and moves the sale to `CANCELLATION_PENDING`; nothing else changes: the invoice stays valid and no stock or cash
 * moves until Management approves (HU-VEN-15). Both actions lock the sale row, so two calls on the same sale run one after
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
      const locked = await this.lockSale(tx, saleId, companyId);
      const pending = await tx.approvalRequest.findFirst({
        where: { type: 'CANCELLATION', subjectId: saleId, status: 'PENDING' },
        select: { id: true, requestedById: true },
      });
      if (!pending || locked.status !== 'CANCELLATION_PENDING') throw cancellationErrors.notPending();
      if (pending.requestedById !== userId && !granted.has('sales.cancellations.approve')) throw cancellationErrors.withdrawForbidden();

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

  /** What the sale detail says about cancelling (VP-15): the open request, whether another may be asked, and what an approval undoes. */
  async stateOf(sale: CancellationSale): Promise<SaleCancellationState> {
    const [days, granted] = await Promise.all([this.settings.get('sales.cancellationWindowDays'), this.granted()]);
    const windowEndsAt = cancellationWindowEndsAt(sale.createdAt, days);
    const row =
      sale.status === 'CANCELLATION_PENDING'
        ? await this.prisma.tenant.approvalRequest.findFirst({ where: { type: 'CANCELLATION', subjectId: sale.id, status: 'PENDING' } })
        : null;
    const requester = row ? await this.prisma.user.findUnique({ where: { id: row.requestedById }, select: { name: true } }) : null;

    return {
      canRequest: isCancellableStatus(sale.status) && isWithinCancellationWindow(new Date(), sale.createdAt, days),
      windowEndsAt: windowEndsAt?.toISOString() ?? null,
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
      impact: { warehouseName: sale.warehouse.name, registerName: sale.shift.register.name },
    };
  }

  /**
   * The sale as the caller may see it, locked until the transaction ends. A sale the caller cannot see is a sale that does not
   * exist (the same rule as the history), and the status is read after the lock so a concurrent decision is never missed.
   */
  private async lockSale(
    tx: Parameters<Parameters<PrismaService['tenant']['$transaction']>[0]>[0],
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
