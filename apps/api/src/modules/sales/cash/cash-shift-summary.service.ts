import { Injectable, StreamableFile } from '@nestjs/common';
import {
  CASH_DENOMINATIONS,
  normalizeTolerance,
  type CashMovementDetail,
  type CashMovementRow,
  type CashMovementStatus,
  type CashMovementType,
  type CashShiftDetail,
  type CashShiftStatus,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../../common/cls';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SettingsService } from '../../../common/settings/settings.service';
import { StorageService } from '../../../common/storage/storage.service';
import { MembershipService } from '../../access/membership.service';
import { cashMovementErrors } from './cash.errors';
import { loadShiftCash, loadShiftSales } from './cash-ledger';

const RECEIPT_CONTENT_TYPE: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' };

/**
 * What the cash register screens read (HU-VEN-22, HU-VEN-23): the shift with its sales per payment method and the cash it should
 * hold, and a manual movement with how its approval went. Reads only; the writes are `CashMovementsService` and `CashClosingService`.
 */
@Injectable()
export class CashShiftSummaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly settings: SettingsService,
    private readonly membership: MembershipService,
    private readonly storage: StorageService,
  ) {}

  /** The shift of the caller, or any shift for who reviews cash differences. */
  async shiftDetail(shiftId: string): Promise<CashShiftDetail> {
    const shift = await this.prisma.tenant.cashShift.findFirst({
      where: { id: shiftId },
      include: { register: { select: { id: true, name: true, branch: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } } } } },
    });
    if (!shift) throw cashMovementErrors.shiftNotFound();
    if (shift.openedById !== this.userId() && !(await this.can('sales.cash-register.review'))) throw cashMovementErrors.shiftNotOwned();

    const [cash, sales, limit, tolerance, rows, pending] = await Promise.all([
      loadShiftCash(this.prisma.tenant, shift.id, shift.openingFloat.toFixed(2)),
      loadShiftSales(this.prisma.tenant, shift.id),
      this.settings.get('sales.cashExpenseApprovalLimit'),
      this.settings.get('sales.cashDifferenceTolerance'),
      this.prisma.tenant.cashMovement.findMany({
        where: { shiftId: shift.id, type: { in: ['INCOME', 'EXPENSE', 'REFUND'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.tenant.cashMovement.count({ where: { shiftId: shift.id, type: 'EXPENSE', status: 'PENDING' } }),
    ]);
    const names = await this.userNames([shift.openedById, ...rows.map((r) => r.userId)]);
    return {
      id: shift.id,
      status: shift.status as CashShiftStatus,
      openingFloat: shift.openingFloat.toFixed(2),
      openedAt: shift.openedAt.toISOString(),
      openedBy: { id: shift.openedById, name: names.get(shift.openedById) ?? '' },
      closedAt: shift.closedAt?.toISOString() ?? null,
      register: { id: shift.register.id, name: shift.register.name },
      branch: shift.register.branch,
      warehouse: shift.register.warehouse,
      expenseApprovalLimit: limit,
      differenceTolerance: normalizeTolerance(tolerance),
      denominations: [...CASH_DENOMINATIONS],
      sales: { total: sales.total, count: sales.count },
      methods: sales.methods,
      cash,
      pendingExpenses: pending,
      movements: rows.map((row) => toRow(row, names)),
    };
  }

  /** A manual movement for who registered it or who approves expenses; anyone else gets "not found". */
  async movementDetail(movementId: string): Promise<CashMovementDetail> {
    const movement = await this.findVisibleMovement(movementId);
    const [approve, request] = await Promise.all([
      this.can('sales.cash-expenses.approve'),
      movement.type === 'EXPENSE'
        ? this.prisma.tenant.approvalRequest.findFirst({ where: { type: 'CASH_EXPENSE', subjectId: movement.id }, orderBy: { createdAt: 'desc' } })
        : null,
    ]);
    const shift = await this.prisma.tenant.cashShift.findFirstOrThrow({
      where: { id: movement.shiftId },
      select: { id: true, status: true, register: { select: { id: true, name: true } } },
    });
    const names = await this.userNames([movement.userId, ...(request ? [request.requestedById, ...(request.decidedById ? [request.decidedById] : [])] : [])]);
    const pending = movement.status === 'PENDING';
    return {
      ...toRow(movement, names),
      shift: { id: shift.id, status: shift.status as CashShiftStatus, register: shift.register },
      approval: request
        ? {
            requestId: request.id,
            requestedBy: { id: request.requestedById, name: names.get(request.requestedById) ?? '' },
            decidedBy: request.decidedById ? { id: request.decidedById, name: names.get(request.decidedById) ?? '' } : null,
            decidedAt: request.decidedAt?.toISOString() ?? null,
            comment: request.comment,
          }
        : null,
      canDecide: pending && approve && shift.status === 'OPEN',
      canWithdraw: pending && movement.userId === this.userId(),
    };
  }

  /** The receipt file of a movement, with the same visibility as the movement. */
  async receipt(movementId: string): Promise<StreamableFile> {
    const movement = await this.findVisibleMovement(movementId);
    if (!movement.receiptKey) throw cashMovementErrors.receiptNotFound();
    const bytes = await this.storage.read(movement.receiptKey);
    if (!bytes) throw cashMovementErrors.receiptNotFound();
    const type = RECEIPT_CONTENT_TYPE[movement.receiptKey.slice(movement.receiptKey.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
    return new StreamableFile(bytes, { type });
  }

  private async findVisibleMovement(movementId: string) {
    const movement = await this.prisma.tenant.cashMovement.findFirst({ where: { id: movementId, type: { in: ['INCOME', 'EXPENSE'] } } });
    if (!movement) throw cashMovementErrors.movementNotFound();
    if (movement.userId !== this.userId() && !(await this.can('sales.cash-expenses.approve'))) throw cashMovementErrors.movementNotFound();
    return movement;
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private async can(permission: 'sales.cash-register.review' | 'sales.cash-expenses.approve'): Promise<boolean> {
    return (await this.membership.permissions(this.cls.get('membershipId') ?? '')).has(permission);
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('Cash register outside a user context');
    return userId;
  }
}

function toRow(
  row: { id: string; type: string; status: string; concept: string | null; reason: string | null; amount: { toFixed(digits: number): string }; userId: string; createdAt: Date; receiptKey: string | null },
  names: Map<string, string>,
): CashMovementRow {
  return {
    id: row.id,
    type: row.type as CashMovementType,
    status: row.status as CashMovementStatus,
    concept: row.concept,
    detail: row.reason,
    amount: row.amount.toFixed(2),
    by: { id: row.userId, name: names.get(row.userId) ?? '' },
    createdAt: row.createdAt.toISOString(),
    hasReceipt: row.receiptKey !== null,
  };
}
