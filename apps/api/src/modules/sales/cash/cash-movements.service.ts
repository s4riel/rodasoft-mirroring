import { Injectable } from '@nestjs/common';
import {
  approvalRequestMachine,
  cashMovementMachine,
  checkUpload,
  Decimal,
  expenseExceedsCash,
  InvalidTransitionError,
  needsExpenseApproval,
  validateCashMovement,
  type CashMovementDecisionInput,
  type CashMovementDetail,
  type CashMovementStatus,
  type CreateCashMovementInput,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService, type TenantTransaction } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { StorageService } from '../../../common/storage/storage.service';
import { MembershipService } from '../../access/membership.service';
import { cashErrors, cashMovementErrors, cashRuleError, isCashMovementKeyConflict } from './cash.errors';
import { asTx, loadShiftCash, lockShiftForUpdate } from './cash-ledger';
import { CashShiftSummaryService } from './cash-shift-summary.service';

/** `entity` of the audit entries and `refType` of the outbox payloads of a manual cash movement. */
export const CASH_MOVEMENT_ENTITY = 'CashMovement';

type Decision = 'approve' | 'reject' | 'withdraw';
const DECISION_RESULT: Record<Decision, 'APPROVED' | 'REJECTED' | 'WITHDRAWN'> = { approve: 'APPROVED', reject: 'REJECTED', withdraw: 'WITHDRAWN' };

/**
 * Manual cash income and expenses of an open shift (HU-VEN-22). An expense above `sales.cashExpenseApprovalLimit` (decision #16)
 * is created `PENDING` with an `ApprovalRequest` of type `CASH_EXPENSE` and does not count in the expected cash until Management
 * approves it; with no limit, or when the requester already holds `sales.cash-expenses.approve`, it is posted at once.
 *
 * Every write takes the shift row `FOR UPDATE` first (the POS and the returns take it `FOR SHARE`), then the movement and its
 * request. That serialises an expense against the closing, against another expense (so two of them cannot overdraw the drawer) and
 * an approval against a withdrawal.
 */
@Injectable()
export class CashMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsService,
    private readonly membership: MembershipService,
    private readonly storage: StorageService,
    private readonly summary: CashShiftSummaryService,
  ) {}

  /** Registers an income or an expense. A repeated `idempotencyKey` returns the movement the first call made. */
  async create(
    shiftId: string,
    input: CreateCashMovementInput,
    file: { buffer: Buffer } | undefined,
    idempotencyKey: string,
  ): Promise<CashMovementDetail> {
    const valid = validateCashMovement(input);
    if (!valid.ok) throw cashRuleError(valid.errors[0], valid.errors);
    // the file is checked by its content before any lock is taken
    const checked = file ? checkUpload('cash-receipt', file.buffer) : null;
    if (checked && 'rejection' in checked) throw checked.rejection === 'FILE_TOO_LARGE' ? cashMovementErrors.receiptTooLarge() : cashMovementErrors.invalidReceipt();
    const companyId = this.companyId();
    const userId = this.userId();
    // read before the transaction: it would take another connection while the transaction holds one
    const canApprove = (await this.membership.permissions(this.membershipId())).has('sales.cash-expenses.approve');

    let movementId: string;
    try {
      movementId = await this.prisma.tenant.$transaction((tx) =>
        this.runCreate(tx, shiftId, valid.value, file && checked && 'type' in checked ? { buffer: file.buffer, type: checked.type } : null, idempotencyKey, {
          companyId,
          userId,
          canApprove,
        }),
      );
    } catch (err) {
      // two requests with one key for two different shifts both pass the lookup; the unique index stops the second
      if (isCashMovementKeyConflict(err)) throw cashMovementErrors.idempotencyKeyReused();
      throw err;
    }
    return this.summary.movementDetail(movementId);
  }

  private async runCreate(
    tx: TenantTransaction,
    shiftId: string,
    movement: { type: 'INCOME' | 'EXPENSE'; amount: Decimal; concept: string; detail: string | null },
    receipt: { buffer: Buffer; type: 'jpeg' | 'png' | 'webp' | 'pdf' } | null,
    idempotencyKey: string,
    caller: { companyId: string; userId: string; canApprove: boolean },
  ): Promise<string> {
    const { companyId, userId, canApprove } = caller;
    const earlier = await this.findReplayable(tx, idempotencyKey, shiftId, userId);
    if (earlier) return earlier;

    const shift = await lockShiftForUpdate(tx, shiftId, companyId);
    if (!shift) throw cashMovementErrors.shiftNotFound();
    if (shift.openedById !== userId) throw cashMovementErrors.shiftNotOwned();
    if (shift.status !== 'OPEN') throw cashErrors.shiftNotOpen();
    // a concurrent request with the same key may have committed while this one waited for the shift lock: replay it
    const concurrent = await this.findReplayable(tx, idempotencyKey, shiftId, userId);
    if (concurrent) return concurrent;

    const amount = movement.amount.toString();
    if (movement.type === 'EXPENSE') {
      const cash = await loadShiftCash(tx, shift.id, shift.openingFloat);
      if (expenseExceedsCash(cash.expected, movement.amount)) throw cashMovementErrors.expenseExceedsCash(cash.expected, amount);
    }
    const limit = movement.type === 'EXPENSE' ? await this.settings.get('sales.cashExpenseApprovalLimit', tx) : null;
    const pending = movement.type === 'EXPENSE' && !canApprove && needsExpenseApproval(movement.amount, limit);
    const status: CashMovementStatus = pending ? 'PENDING' : 'POSTED';

    const created = await tx.cashMovement.create({
      data: {
        companyId,
        shiftId: shift.id,
        type: movement.type,
        amount,
        reason: movement.detail,
        concept: movement.concept,
        status,
        idempotencyKey,
        userId,
      },
      select: { id: true },
    });
    if (receipt) {
      const receiptKey = await this.storage.save(companyId, 'cash-receipt', receipt.buffer, receipt.type, created.id);
      await tx.cashMovement.update({ where: { id: created.id }, data: { receiptKey } });
    }

    const snapshot = {
      shiftId: shift.id,
      type: movement.type,
      amount,
      concept: movement.concept,
      detail: movement.detail,
      status,
      hasReceipt: receipt !== null,
    };
    await this.audit.log({ action: 'sales.cash-movement.create', entity: CASH_MOVEMENT_ENTITY, entityId: created.id, after: snapshot }, asTx(tx));

    if (pending) {
      const request = await tx.approvalRequest.create({
        data: { companyId, type: 'CASH_EXPENSE', subjectId: created.id, requestedById: userId, reason: movement.concept, requesterComment: movement.detail },
        select: { id: true },
      });
      await this.outbox.publish(
        'sales.cash-expense.requested',
        { movementId: created.id, requestId: request.id, requestedById: userId, limit, ...snapshot },
        { tx, idempotencyKey: `cash-expense-requested:${created.id}` },
      );
    } else {
      await this.outbox.publish('sales.cash-movement.created', { movementId: created.id, userId, ...snapshot }, { tx, idempotencyKey: `cash-movement-created:${created.id}` });
    }
    return created.id;
  }

  /** The id of the movement an earlier call made with this key; fails when that call was for another shift or cashier. */
  private async findReplayable(tx: TenantTransaction, idempotencyKey: string, shiftId: string, userId: string): Promise<string | null> {
    const existing = await tx.cashMovement.findFirst({ where: { idempotencyKey }, select: { id: true, shiftId: true, userId: true } });
    if (!existing) return null;
    if (existing.shiftId !== shiftId || existing.userId !== userId) throw cashMovementErrors.idempotencyKeyReused();
    return existing.id;
  }

  /** `PENDING → POSTED`: the expense now leaves the drawer, as long as the drawer still holds that much. */
  approve(movementId: string, input: CashMovementDecisionInput): Promise<CashMovementDetail> {
    return this.decide(movementId, 'approve', input.comment?.trim() || null);
  }

  /** `PENDING → REJECTED`: the reply is required, the cashier reads it. */
  async reject(movementId: string, input: CashMovementDecisionInput): Promise<CashMovementDetail> {
    const comment = input.comment?.trim() ?? '';
    if (comment === '') throw cashMovementErrors.decisionCommentRequired();
    return this.decide(movementId, 'reject', comment);
  }

  /** `PENDING → WITHDRAWN`: the cashier takes the request back. */
  withdraw(movementId: string): Promise<CashMovementDetail> {
    return this.decide(movementId, 'withdraw', null);
  }

  private async decide(movementId: string, event: Decision, comment: string | null): Promise<CashMovementDetail> {
    const companyId = this.companyId();
    const userId = this.userId();
    const head = await this.prisma.tenant.cashMovement.findFirst({
      where: { id: movementId, type: 'EXPENSE' },
      select: { shiftId: true, userId: true, shift: { select: { register: { select: { branchId: true } } } } },
    });
    if (!head) throw cashMovementErrors.movementNotFound();
    if (event === 'withdraw') {
      if (head.userId !== userId) throw cashMovementErrors.movementNotOwned();
    } else {
      const allowed = await this.membership.operableBranchIds(this.membershipId());
      if (allowed && !allowed.includes(head.shift.register.branchId)) throw cashMovementErrors.movementNotFound();
    }

    await this.prisma.tenant.$transaction(async (tx) => {
      const shift = await lockShiftForUpdate(tx, head.shiftId, companyId);
      if (!shift) throw cashMovementErrors.shiftNotFound();
      const rows = await tx.$queryRaw<{ status: string; amount: string; user_id: string }[]>`
        SELECT status::text AS status, amount::text AS amount, user_id::text AS user_id
        FROM cash_movements WHERE id = ${movementId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
      const row = rows[0];
      if (!row) throw cashMovementErrors.movementNotFound();
      const next = this.nextStatus(row.status as CashMovementStatus, event);
      const requests = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM approval_requests
        WHERE type = 'CASH_EXPENSE' AND subject_id = ${movementId}::uuid AND status = 'PENDING' AND company_id = ${companyId}::uuid FOR UPDATE`;
      const request = requests[0];
      if (!request) throw cashMovementErrors.movementNotPending();

      if (event === 'approve') {
        // the drawer may have emptied since the request was made: the same rule as when the expense is registered
        if (shift.status !== 'OPEN') throw cashErrors.shiftNotOpen();
        const cash = await loadShiftCash(tx, shift.id, shift.openingFloat);
        if (expenseExceedsCash(cash.expected, Decimal.of(row.amount))) throw cashMovementErrors.expenseExceedsCash(cash.expected, row.amount);
      }

      await tx.cashMovement.update({ where: { id: movementId }, data: { status: next } });
      await tx.approvalRequest.update({
        where: { id: request.id },
        data: { status: approvalRequestMachine.next('PENDING', event), decidedById: userId, decidedAt: new Date(), comment },
      });
      await this.audit.log(
        {
          action: `sales.cash-expense.${event}`,
          entity: CASH_MOVEMENT_ENTITY,
          entityId: movementId,
          before: { status: row.status },
          after: { status: next, shiftId: shift.id, amount: row.amount, requestId: request.id, comment },
        },
        asTx(tx),
      );
      await this.outbox.publish(
        'sales.cash-expense.decided',
        { movementId, shiftId: shift.id, requestId: request.id, decision: DECISION_RESULT[event], amount: row.amount, requestedById: row.user_id, decidedById: userId, comment },
        { tx, idempotencyKey: `cash-expense-decided:${movementId}` },
      );
    });
    return this.summary.movementDetail(movementId);
  }

  private nextStatus(status: CashMovementStatus, event: Decision): CashMovementStatus {
    try {
      return cashMovementMachine.next(status, event);
    } catch (err) {
      if (err instanceof InvalidTransitionError) throw cashMovementErrors.movementNotPending();
      throw err;
    }
  }

  private membershipId(): string {
    return this.cls.get('membershipId') ?? '';
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Cash movements outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('Cash movements outside a user context');
    return userId;
  }
}
