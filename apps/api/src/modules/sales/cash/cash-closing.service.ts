import { Injectable } from '@nestjs/common';
import {
  cashShiftMachine,
  CASH_SHIFT_REF_TYPE,
  planClosing,
  posCheckoutMachine,
  normalizeTolerance,
  type CloseCashShiftInput,
  type CloseCashShiftResponse,
  type PosCheckoutStatus,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { cashErrors, cashMovementErrors, cashRuleError } from './cash.errors';
import { asTx, declaredMethodSystemTotals, loadShiftCash, loadShiftSales, lockShiftForUpdate } from './cash-ledger';

/**
 * Closing a cash shift (HU-VEN-23). The cashier counts the cash by denomination and types what the terminals and the bank say for
 * QR, card and transfer; the server recomputes everything the system holds under the shift lock and ignores any total from the
 * client. A shift with nothing to review goes `OPEN → CLOSED → APPROVED` in the same transaction; with a difference beyond
 * `sales.cashDifferenceTolerance` (decision #17) it stays `CLOSED` with an `ApprovalRequest` of type `CASH_DIFFERENCE` for HU-VEN-24.
 *
 * The shift row is taken `FOR UPDATE`; the POS holds it `FOR SHARE` while it sells, so a sale in flight finishes before the count
 * starts and one queued behind the closing finds the shift closed and fails with `CASH_SHIFT_NOT_OPEN`: no sale is ever lost.
 */
@Injectable()
export class CashClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
  ) {}

  async close(shiftId: string, input: CloseCashShiftInput): Promise<CloseCashShiftResponse> {
    const companyId = this.companyId();
    const userId = this.userId();
    return this.prisma.tenant.$transaction(async (tx) => {
      const shift = await lockShiftForUpdate(tx, shiftId, companyId);
      if (!shift) throw cashMovementErrors.shiftNotFound();
      if (shift.openedById !== userId) throw cashMovementErrors.shiftNotOwned();
      if (shift.status !== 'OPEN') throw cashErrors.shiftNotOpen();

      const pendingExpenses = await tx.cashMovement.count({ where: { shiftId: shift.id, type: 'EXPENSE', status: 'PENDING' } });
      if (pendingExpenses > 0) throw cashMovementErrors.hasPendingExpenses(pendingExpenses);
      const pendingPayments = await tx.posCheckoutPayment.count({
        where: {
          method: { in: ['QR', 'CARD'] },
          status: { in: ['PENDING', 'CONFIRMED'] },
          checkout: { shiftId: shift.id, status: { in: ['OPEN', 'PAYING', 'ON_HOLD'] } },
        },
      });
      if (pendingPayments > 0) throw cashMovementErrors.hasPendingPayments(pendingPayments);

      // what the system holds now, under the lock
      const [cash, sales, tolerance] = await Promise.all([
        loadShiftCash(tx, shift.id, shift.openingFloat),
        loadShiftSales(tx, shift.id),
        this.tolerance(tx),
      ]);
      const planned = planClosing(input, { expectedCash: cash.expected, methods: declaredMethodSystemTotals(sales.methods) }, tolerance);
      if (!planned.ok) throw cashRuleError(planned.error);
      const { plan } = planned;

      const abandoned = await this.abandonCheckouts(tx, shift.id, companyId);

      await tx.cashCount.createMany({
        data: plan.counts.map((count) => ({ companyId, shiftId: shift.id, denomination: count.denomination, quantity: count.quantity })),
      });
      await tx.cashShiftMethodTotal.createMany({
        data: plan.differences.map((row) => ({
          companyId,
          shiftId: shift.id,
          method: row.method,
          systemAmount: row.system,
          declaredAmount: row.declared,
          differenceAmount: row.difference,
        })),
      });

      const closed = cashShiftMachine.next('OPEN', 'close');
      const closedAt = new Date();
      await tx.cashShift.update({
        where: { id: shift.id },
        data: {
          status: closed,
          closedById: userId,
          closedAt,
          expectedAmount: plan.expected,
          countedAmount: plan.counted,
          differenceAmount: plan.difference,
          closingFloat: plan.closingFloat,
          closingComment: plan.comment,
        },
      });
      const snapshot = {
        registerId: shift.registerId,
        expectedAmount: plan.expected,
        countedAmount: plan.counted,
        differenceAmount: plan.difference,
        closingFloat: plan.closingFloat,
        methods: plan.differences,
        comment: plan.comment,
        needsReview: plan.needsReview,
        abandonedCheckouts: abandoned,
      };
      await this.audit.log(
        { action: 'sales.cash-shift.close', entity: 'CashShift', entityId: shift.id, before: { status: shift.status }, after: { status: closed, ...snapshot } },
        asTx(tx),
      );

      let status = closed;
      if (plan.needsReview) {
        const request = await tx.approvalRequest.create({
          data: {
            companyId,
            type: 'CASH_DIFFERENCE',
            subjectId: shift.id,
            requestedById: userId,
            reason: 'CASH_DIFFERENCE',
            requesterComment: plan.comment,
          },
          select: { id: true },
        });
        await this.outbox.publish(
          'sales.cash-shift.difference',
          { shiftId: shift.id, refType: CASH_SHIFT_REF_TYPE, requestId: request.id, closedById: userId, ...snapshot },
          { tx, idempotencyKey: `cash-shift-difference:${shift.id}` },
        );
      } else {
        // nothing to review: the shift is approved by the system in the same transaction
        status = cashShiftMachine.next(closed, 'approve');
        await tx.cashShift.update({ where: { id: shift.id }, data: { status } });
        await this.audit.log(
          { action: 'sales.cash-shift.approve', entity: 'CashShift', entityId: shift.id, before: { status: closed }, after: { status, automatic: true } },
          asTx(tx),
        );
      }
      await this.outbox.publish(
        'sales.cash-shift.closed',
        { shiftId: shift.id, refType: CASH_SHIFT_REF_TYPE, closedById: userId, closedAt: closedAt.toISOString(), status, ...snapshot },
        { tx, idempotencyKey: `cash-shift-closed:${shift.id}` },
      );

      return {
        shiftId: shift.id,
        status,
        expectedAmount: plan.expected,
        countedAmount: plan.counted,
        differenceAmount: plan.difference,
        closingFloat: plan.closingFloat,
        needsReview: plan.needsReview,
        methods: plan.differences,
      };
    });
  }

  /**
   * The carts of the shift that never became a sale (open, on hold, or at the payment step with nothing taken yet) are abandoned:
   * the shift is closing and nobody can finish them. Each goes through `posCheckoutMachine` and is audited.
   */
  private async abandonCheckouts(tx: TenantTransaction, shiftId: string, companyId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id::text AS id, status::text AS status FROM pos_checkouts
      WHERE shift_id = ${shiftId}::uuid AND company_id = ${companyId}::uuid AND status IN ('OPEN', 'PAYING', 'ON_HOLD')
      ORDER BY id FOR UPDATE`;
    for (const row of rows) {
      let status = row.status as PosCheckoutStatus;
      // a cart at the payment step goes back to open before it is abandoned
      if (status === 'PAYING') status = posCheckoutMachine.next(status, 'back');
      const next = posCheckoutMachine.next(status, 'abandon');
      await tx.posCheckout.update({ where: { id: row.id }, data: { status: next } });
      await this.audit.log(
        { action: 'sales.pos-checkout.abandon', entity: 'PosCheckout', entityId: row.id, before: { status: row.status }, after: { status: next, reason: 'CASH_SHIFT_CLOSED', shiftId } },
        asTx(tx),
      );
    }
    return rows.map((row) => row.id);
  }

  /** The tolerance setting; a stored value that is not an amount falls back to "any difference needs review". */
  private async tolerance(tx: TenantTransaction): Promise<string> {
    return normalizeTolerance(await this.settings.get('sales.cashDifferenceTolerance', tx));
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Cash closing outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('Cash closing outside a user context');
    return userId;
  }
}
