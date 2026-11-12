import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CASH_SHIFT_PAGE_SIZE_DEFAULT,
  cashShiftDisplayStatus,
  laPazToday,
  type CashShiftDisplayStatus,
  type CashShiftListQuery,
  type CashShiftListResponse,
  type CashShiftStatus,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../../common/cls';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MembershipService } from '../../access/membership.service';
import { cashReviewErrors } from './cash.errors';

const LA_PAZ_OFFSET = '-04:00';
const DAY_MS = 86_400_000;
const ZERO = new Prisma.Decimal(0);

/** How each pill of the history is stored: an approved shift nobody reviewed closed without a difference to review. */
const STATUS_WHERE: Record<CashShiftDisplayStatus, Prisma.CashShiftWhereInput> = {
  OPEN: { status: 'OPEN' },
  PENDING_REVIEW: { status: 'CLOSED' },
  CLOSED_CLEAN: { status: 'APPROVED', reviewedAt: null },
  DIFFERENCE_APPROVED: { status: 'APPROVED', reviewedAt: { not: null } },
  OBSERVED: { status: 'OBSERVED' },
};

/** Some payment method of the closing differs, cash included. */
const WITH_DIFFERENCE: Prisma.CashShiftWhereInput = {
  OR: [{ differenceAmount: { not: 0 } }, { methodTotals: { some: { differenceAmount: { not: 0 } } } }],
};

/** The first instant of a La Paz day, or null when the text is not a real day. */
function dayStart(day: string): Date | null {
  const date = new Date(`${day}T00:00:00${LA_PAZ_OFFSET}`);
  return Number.isNaN(date.getTime()) || laPazToday(date) !== day ? null : date;
}

/**
 * The shift history (HU-VEN-25, Figma VP-23): openings and closings with their sales, difference and review status. Who holds
 * `sales.cash-register.review` sees every cashier's shifts of the branches they operate; a cashier sees only their own, and
 * the cashier filter is ignored for them. Reads only.
 */
@Injectable()
export class CashShiftHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly membership: MembershipService,
  ) {}

  async list(query: CashShiftListQuery): Promise<CashShiftListResponse> {
    const userId = this.userId();
    const membershipId = this.cls.get('membershipId') ?? '';
    const [granted, allowed] = await Promise.all([this.membership.permissions(membershipId), this.membership.operableBranchIds(membershipId)]);
    const canReview = granted.has('sales.cash-register.review');

    /** Everything the caller may see, before any filter. */
    const scope: Prisma.CashShiftWhereInput = canReview ? (allowed ? { register: { branchId: { in: allowed } } } : {}) : { openedById: userId };
    const where: Prisma.CashShiftWhereInput = { AND: [scope, ...this.filters(query, canReview)] };
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? CASH_SHIFT_PAGE_SIZE_DEFAULT;
    const monthStart = new Date(`${laPazToday(new Date()).slice(0, 7)}-01T00:00:00${LA_PAZ_OFFSET}`);
    const inMonth: Prisma.CashShiftWhereInput = { AND: [scope, { openedAt: { gte: monthStart } }] };
    const db = this.prisma.tenant;

    const [rows, total, differenceSum, salesSum, monthShifts, monthWithDifference, pendingReview, monthDifference] = await Promise.all([
      db.cashShift.findMany({
        where,
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          register: { select: { id: true, name: true, branch: { select: { id: true, name: true } } } },
          methodTotals: { select: { differenceAmount: true } },
        },
      }),
      db.cashShift.count({ where }),
      db.cashShift.aggregate({ where, _sum: { differenceAmount: true } }),
      db.sale.aggregate({ where: { status: { not: 'CANCELLED' }, shift: where }, _sum: { total: true }, _count: { _all: true } }),
      db.cashShift.count({ where: inMonth }),
      db.cashShift.count({ where: { AND: [inMonth, WITH_DIFFERENCE] } }),
      db.cashShift.count({ where: { AND: [scope, STATUS_WHERE.PENDING_REVIEW] } }),
      db.cashShift.aggregate({ where: inMonth, _sum: { differenceAmount: true } }),
    ]);

    // one grouped query for the page, never one per shift
    const [salesByShift, options] = await Promise.all([
      db.sale.groupBy({
        by: ['shiftId'],
        where: { shiftId: { in: rows.map((r) => r.id) }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
        _count: { _all: true },
      }),
      canReview ? this.filterOptions(scope, allowed) : Promise.resolve({ cashierIds: [], registers: [] }),
    ]);
    const sales = new Map(salesByShift.map((s) => [s.shiftId, { total: (s._sum.total ?? ZERO).toFixed(2), count: s._count._all }]));
    const names = await this.userNames([...rows.map((r) => r.openedById), ...options.cashierIds]);

    return {
      items: rows.map((row) => {
        const status = row.status as CashShiftStatus;
        return {
          id: row.id,
          number: row.number,
          status,
          displayStatus: cashShiftDisplayStatus(status, row.reviewedAt !== null),
          cashier: { id: row.openedById, name: names.get(row.openedById) ?? '' },
          register: { id: row.register.id, name: row.register.name },
          branch: row.register.branch,
          openedAt: row.openedAt.toISOString(),
          closedAt: row.closedAt?.toISOString() ?? null,
          sales: sales.get(row.id) ?? { total: '0.00', count: 0 },
          difference: row.differenceAmount?.toFixed(2) ?? null,
          hasDifference: !(row.differenceAmount ?? ZERO).isZero() || row.methodTotals.some((t) => !t.differenceAmount.isZero()),
        };
      }),
      total,
      page,
      pageSize,
      totals: {
        shifts: total,
        salesCount: salesSum._count._all,
        salesTotal: (salesSum._sum.total ?? ZERO).toFixed(2),
        difference: (differenceSum._sum.differenceAmount ?? ZERO).toFixed(2),
      },
      month: {
        shifts: monthShifts,
        withDifference: monthWithDifference,
        pendingReview,
        accumulatedDifference: (monthDifference._sum.differenceAmount ?? ZERO).toFixed(2),
      },
      canReview,
      cashiers: options.cashierIds.map((id) => ({ id, name: names.get(id) ?? '' })).sort((a, b) => a.name.localeCompare(b.name)),
      registers: options.registers,
    };
  }

  private filters(query: CashShiftListQuery, canReview: boolean): Prisma.CashShiftWhereInput[] {
    const filters: Prisma.CashShiftWhereInput[] = [];
    const from = query.from ? dayStart(query.from) : null;
    const to = query.to ? dayStart(query.to) : null;
    if (query.from && !from) throw cashReviewErrors.invalidFilter('from');
    if (query.to && !to) throw cashReviewErrors.invalidFilter('to');
    if (from && to && from.getTime() > to.getTime()) throw cashReviewErrors.invalidFilter('to');
    if (from) filters.push({ openedAt: { gte: from } });
    if (to) filters.push({ openedAt: { lt: new Date(to.getTime() + DAY_MS) } });
    // a cashier only ever sees their own shifts: the filter is ignored instead of answered with an error
    if (query.cashierId && canReview) filters.push({ openedById: query.cashierId });
    if (query.registerId) filters.push({ registerId: query.registerId });
    if (query.status) filters.push(STATUS_WHERE[query.status]);
    return filters;
  }

  /** The cashiers that ever opened a shift and the registers, within what the reviewer may see. */
  private async filterOptions(
    scope: Prisma.CashShiftWhereInput,
    allowed: string[] | null,
  ): Promise<{ cashierIds: string[]; registers: { id: string; name: string }[] }> {
    const [cashiers, registers] = await Promise.all([
      this.prisma.tenant.cashShift.findMany({ where: scope, distinct: ['openedById'], select: { openedById: true } }),
      this.prisma.tenant.cashRegister.findMany({
        where: allowed ? { branchId: { in: allowed } } : {},
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      }),
    ]);
    return { cashierIds: cashiers.map((c) => c.openedById), registers };
  }

  private async userNames(ids: string[]): Promise<Map<string, string>> {
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('Cash shift history outside a user context');
    return userId;
  }
}
