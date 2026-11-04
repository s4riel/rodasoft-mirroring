import { Injectable } from '@nestjs/common';
import type { CashRegisterListResponse, CashRegisterOption } from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import type { AppClsStore } from '../../../common/cls';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MembershipService } from '../../access/membership.service';
import type { ListCashRegistersQueryDto } from './cash.dto';
import { cashErrors } from './cash.errors';

/** Registers the cashier can open (VP-05): free or taken, and what the last shift left in each one. */
@Injectable()
export class CashRegistersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly membership: MembershipService,
  ) {}

  async list(query: ListCashRegistersQueryDto): Promise<CashRegisterListResponse> {
    const allowed = await this.membership.operableBranchIds(this.cls.get('membershipId') ?? '');
    if (query.branchId && allowed && !allowed.includes(query.branchId)) throw cashErrors.branchForbidden();

    const registers = await this.prisma.tenant.cashRegister.findMany({
      where: {
        status: 'ACTIVE',
        ...(query.branchId ? { branchId: query.branchId } : allowed ? { branchId: { in: allowed } } : {}),
      },
      orderBy: [{ branch: { code: 'asc' } }, { name: 'asc' }],
      include: { branch: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } } },
    });
    if (registers.length === 0) return { items: [] };
    const ids = registers.map((r) => r.id);

    const [openShifts, closedShifts] = await Promise.all([
      this.prisma.tenant.cashShift.findMany({ where: { registerId: { in: ids }, status: 'OPEN' } }),
      // newest close first, so `distinct` keeps the last close of each register
      this.prisma.tenant.cashShift.findMany({
        where: { registerId: { in: ids }, status: { not: 'OPEN' }, closedAt: { not: null } },
        orderBy: { closedAt: 'desc' },
        distinct: ['registerId'],
      }),
    ]);

    const userIds = [
      ...new Set([...openShifts.map((s) => s.openedById), ...closedShifts.flatMap((s) => (s.closedById ? [s.closedById] : []))]),
    ];
    const users = await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const nameOf = new Map(users.map((u) => [u.id, u.name]));

    const items: CashRegisterOption[] = registers.map((r) => {
      const open = openShifts.find((s) => s.registerId === r.id);
      const closed = closedShifts.find((s) => s.registerId === r.id);
      return {
        id: r.id,
        name: r.name,
        branch: r.branch,
        warehouse: r.warehouse,
        openShift: open ? { id: open.id, openedAt: open.openedAt.toISOString(), openedByName: nameOf.get(open.openedById) ?? null } : null,
        lastClose:
          closed && closed.closedAt
            ? {
                shiftId: closed.id,
                closedAt: closed.closedAt.toISOString(),
                closedByName: closed.closedById ? (nameOf.get(closed.closedById) ?? null) : null,
                differenceAmount: closed.differenceAmount?.toFixed(2) ?? null,
                closingFloat: closed.closingFloat?.toFixed(2) ?? null,
              }
            : null,
      };
    });
    return { items };
  }
}
