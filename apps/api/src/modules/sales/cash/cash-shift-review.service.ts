import { Injectable } from '@nestjs/common';
import {
  approvalRequestMachine,
  CASH_SHIFT_REF_TYPE,
  cashShiftDisplayStatus,
  cashShiftMachine,
  PAYMENT_METHODS,
  shiftDeposit,
  validateShiftReview,
  type CashShiftReview,
  type CashShiftReviewDecision,
  type CashShiftReviewInput,
  type CashShiftStatus,
  type CashShiftTimelineAction,
  type CashShiftTimelineEntry,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MembershipService } from '../../access/membership.service';
import { cashMovementErrors, cashReviewErrors } from './cash.errors';
import { asTx, loadShiftSales, lockShiftForUpdate } from './cash-ledger';

/** `entity` of the audit entries of a cash shift. */
export const CASH_SHIFT_ENTITY = 'CashShift';

const TIMELINE_ACTIONS: Record<string, CashShiftTimelineAction> = {
  'sales.cash-shift.open': 'OPEN',
  'sales.cash-shift.close': 'CLOSE',
  'sales.cash-shift.approve': 'APPROVE',
  'sales.cash-shift.observe': 'OBSERVE',
};

/** The request of a closing follows the shift: approved with it, rejected when the shift is observed. */
const REQUEST_EVENT = { approve: 'approve', observe: 'reject' } as const;

/**
 * Accounting's review of a closing with a difference (HU-VEN-24, decision #17). A shift that closed with something beyond the
 * tolerance waits `CLOSED` with an `ApprovalRequest` of type `CASH_DIFFERENCE`; the reviewer approves it (`APPROVED`) or asks for a
 * recount (`OBSERVED`, with a required comment). Both are final and go through `cashShiftMachine`.
 *
 * The decision takes the shift row `FOR UPDATE`, like everything that changes a shift, so two reviewers deciding at once run one
 * after the other and the second finds the shift already decided. Nobody reviews their own shift.
 */
@Injectable()
export class CashShiftReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly membership: MembershipService,
  ) {}

  /** VP-06b · the closing as the reviewer reads it. The cashier of the shift may read it too, without deciding. */
  async review(shiftId: string): Promise<CashShiftReview> {
    const userId = this.userId();
    const shift = await this.prisma.tenant.cashShift.findFirst({
      where: { id: shiftId },
      include: {
        register: { select: { id: true, name: true, branchId: true, branch: { select: { id: true, name: true } } } },
        methodTotals: { select: { method: true, systemAmount: true, declaredAmount: true, differenceAmount: true } },
      },
    });
    if (!shift) throw cashMovementErrors.shiftNotFound();
    const own = shift.openedById === userId;
    const canReview = await this.canReviewBranch(shift.register.branchId);
    if (!own && !canReview) {
      // without the permission the shift exists but is someone else's; with it, a branch the reviewer cannot operate is hidden
      throw (await this.hasReviewPermission()) ? cashMovementErrors.shiftNotFound() : cashMovementErrors.shiftNotOwned();
    }

    const [sales, audits] = await Promise.all([
      loadShiftSales(this.prisma.tenant, shift.id),
      this.prisma.tenant.auditLog.findMany({
        where: { entity: CASH_SHIFT_ENTITY, entityId: shift.id, action: { in: Object.keys(TIMELINE_ACTIONS) } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { action: true, userId: true, createdAt: true, after: true },
      }),
    ]);
    const names = await this.userNames([shift.openedById, shift.reviewedById, ...audits.map((a) => a.userId)]);
    const person = (id: string) => ({ id, name: names.get(id) ?? '' });
    const status = shift.status as CashShiftStatus;
    const counted = shift.countedAmount?.toFixed(2) ?? null;
    const closingFloat = shift.closingFloat?.toFixed(2) ?? null;
    const timeline: CashShiftTimelineEntry[] = audits.map((entry) => ({
      at: entry.createdAt.toISOString(),
      action: TIMELINE_ACTIONS[entry.action],
      by: entry.userId ? person(entry.userId) : null,
      automatic: (entry.after as { automatic?: unknown } | null)?.automatic === true,
    }));

    return {
      id: shift.id,
      number: shift.number,
      status,
      displayStatus: cashShiftDisplayStatus(status, shift.reviewedAt !== null),
      register: { id: shift.register.id, name: shift.register.name },
      branch: shift.register.branch,
      cashier: person(shift.openedById),
      openedAt: shift.openedAt.toISOString(),
      closedAt: shift.closedAt?.toISOString() ?? null,
      expected: shift.expectedAmount?.toFixed(2) ?? null,
      counted,
      difference: shift.differenceAmount?.toFixed(2) ?? null,
      sales: { total: sales.total, count: sales.count },
      closingComment: shift.closingComment,
      closingFloat,
      deposit: counted !== null && closingFloat !== null ? shiftDeposit(counted, closingFloat) : null,
      methods: PAYMENT_METHODS.flatMap((method) => {
        const row = shift.methodTotals.find((t) => t.method === method);
        return row
          ? [{ method, system: row.systemAmount.toFixed(2), declared: row.declaredAmount.toFixed(2), difference: row.differenceAmount.toFixed(2) }]
          : [];
      }),
      review:
        shift.reviewedById && shift.reviewedAt
          ? { by: person(shift.reviewedById), at: shift.reviewedAt.toISOString(), note: shift.reviewNote }
          : null,
      timeline,
      canDecide: canReview && !own && status === 'CLOSED',
    };
  }

  /** `CLOSED → APPROVED`: the difference is accepted. The answer is optional. */
  approve(shiftId: string, input: CashShiftReviewInput): Promise<CashShiftReview> {
    return this.decide(shiftId, 'approve', input);
  }

  /** `CLOSED → OBSERVED` ("Pedir recuento"): the answer is required, the cashier reads it. */
  observe(shiftId: string, input: CashShiftReviewInput): Promise<CashShiftReview> {
    return this.decide(shiftId, 'observe', input);
  }

  private async decide(shiftId: string, decision: CashShiftReviewDecision, input: CashShiftReviewInput): Promise<CashShiftReview> {
    const valid = validateShiftReview(decision, input.comment);
    if (!valid.ok) throw valid.error === 'REVIEW_COMMENT_REQUIRED' ? cashReviewErrors.commentRequired() : cashReviewErrors.commentTooLong();
    const comment = valid.comment;
    const companyId = this.companyId();
    const userId = this.userId();
    // read before the transaction: each would take another connection while the transaction holds one
    const head = await this.prisma.tenant.cashShift.findFirst({ where: { id: shiftId }, select: { register: { select: { branchId: true } } } });
    if (!head) throw cashMovementErrors.shiftNotFound();
    const allowed = await this.membership.operableBranchIds(this.membershipId());
    if (allowed && !allowed.includes(head.register.branchId)) throw cashMovementErrors.shiftNotFound();

    await this.prisma.tenant.$transaction(async (tx) => {
      const shift = await lockShiftForUpdate(tx, shiftId, companyId);
      if (!shift) throw cashMovementErrors.shiftNotFound();
      if (shift.status !== 'CLOSED') throw cashReviewErrors.shiftNotClosed(shift.status);
      if (shift.openedById === userId) throw cashReviewErrors.selfReview();

      const status = cashShiftMachine.next('CLOSED', decision);
      const reviewedAt = new Date();
      const updated = await tx.cashShift.update({
        where: { id: shift.id },
        data: { status, reviewedById: userId, reviewedAt, reviewNote: comment },
        select: { differenceAmount: true },
      });

      // a shift closed before HU-VEN-23 may have no request: the decision stands on the shift alone
      const requests = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM approval_requests
        WHERE type = 'CASH_DIFFERENCE' AND subject_id = ${shift.id}::uuid AND status = 'PENDING' AND company_id = ${companyId}::uuid FOR UPDATE`;
      const requestId = requests[0]?.id ?? null;
      if (requestId) {
        await tx.approvalRequest.update({
          where: { id: requestId },
          data: { status: approvalRequestMachine.next('PENDING', REQUEST_EVENT[decision]), decidedById: userId, decidedAt: reviewedAt, comment },
        });
      }

      const differenceAmount = updated.differenceAmount?.toFixed(2) ?? null;
      await this.audit.log(
        {
          action: `sales.cash-shift.${decision}`,
          entity: CASH_SHIFT_ENTITY,
          entityId: shift.id,
          before: { status: shift.status },
          after: { status, reviewedById: userId, reviewNote: comment, differenceAmount, requestId },
        },
        asTx(tx),
      );
      await this.outbox.publish(
        'sales.cash-shift.reviewed',
        {
          shiftId: shift.id,
          refType: CASH_SHIFT_REF_TYPE,
          status,
          cashierId: shift.openedById,
          reviewedById: userId,
          reviewedAt: reviewedAt.toISOString(),
          comment,
          differenceAmount,
          requestId,
        },
        { tx, idempotencyKey: `cash-shift-reviewed:${shift.id}` },
      );
    });
    return this.review(shiftId);
  }

  private async hasReviewPermission(): Promise<boolean> {
    return (await this.membership.permissions(this.membershipId())).has('sales.cash-register.review');
  }

  /** The caller reviews differences and may operate the branch of the shift. */
  private async canReviewBranch(branchId: string): Promise<boolean> {
    if (!(await this.hasReviewPermission())) return false;
    const allowed = await this.membership.operableBranchIds(this.membershipId());
    return !allowed || allowed.includes(branchId);
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private membershipId(): string {
    return this.cls.get('membershipId') ?? '';
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Cash shift review outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('Cash shift review outside a user context');
    return userId;
  }
}
