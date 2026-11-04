import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CASH_SHIFT_REF_TYPE,
  Decimal,
  floatMatchesLastClose,
  validateOpeningFloat,
  type CurrentCashShift,
  type CurrentCashShiftResponse,
  type OpenCashShiftResponse,
} from '@rodasoft/domain';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../../common/audit/audit.service';
import type { AppClsStore } from '../../../common/cls';
import { OutboxService } from '../../../common/outbox/outbox.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MembershipService } from '../../access/membership.service';
import type { OpenCashShiftDto } from './cash.dto';
import { cashErrors, mapCashUniqueViolation } from './cash.errors';
import { SHIFT_WITH_PLACE, toCurrentShift } from './cash-shift.mapper';

/**
 * Opening a cash shift (HU-VEN-01). A shift is created already `OPEN` (so `cashShiftMachine` has no transition here),
 * for the logged-in user only. Two partial unique indexes are the safety net behind the checks: one `OPEN` shift per
 * register and one per cashier.
 */
@Injectable()
export class CashShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly membership: MembershipService,
  ) {}

  /** The caller's `OPEN` shift, or `null`. */
  async current(): Promise<CurrentCashShiftResponse> {
    return { shift: await this.findCurrent() };
  }

  /** For the POS stories: the caller's open shift, or `CASH_SHIFT_NOT_OPEN`. */
  async requireOpenShift(): Promise<CurrentCashShift> {
    const shift = await this.findCurrent();
    if (!shift) throw cashErrors.shiftNotOpen();
    return shift;
  }

  async open(dto: OpenCashShiftDto): Promise<OpenCashShiftResponse> {
    const parsed = validateOpeningFloat(dto.openingFloat);
    if (!parsed.ok) throw cashErrors.invalidOpeningFloat(parsed.error);
    const openingFloat = parsed.value;
    const companyId = this.companyId();
    const userId = this.userId();
    // read before the transaction: each would take another connection while the transaction holds one, which starves
    // the pool under concurrent openings
    const allowed = await this.membership.operableBranchIds(this.membershipId());
    const openedByName = await this.userName(userId);

    try {
      return await this.prisma.tenant.$transaction(async (tx) => {
        const register = await tx.cashRegister.findFirst({
          where: { id: dto.registerId },
          select: { id: true, branchId: true, status: true },
        });
        if (!register) throw cashErrors.registerNotFound();
        if (allowed && !allowed.includes(register.branchId)) throw cashErrors.branchForbidden();
        if (register.status !== 'ACTIVE') throw cashErrors.registerInactive();

        // serializes concurrent openings of one register: the checks below then always see the winner
        await tx.$queryRaw`SELECT id FROM cash_registers WHERE id = ${register.id}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;

        if (await tx.cashShift.findFirst({ where: { registerId: register.id, status: 'OPEN' }, select: { id: true } })) {
          throw cashErrors.registerAlreadyOpen();
        }
        if (await tx.cashShift.findFirst({ where: { openedById: userId, status: 'OPEN' }, select: { id: true } })) {
          throw cashErrors.alreadyOpenForUser();
        }

        const last = await tx.cashShift.findFirst({
          where: { registerId: register.id, status: { not: 'OPEN' }, closedAt: { not: null } },
          orderBy: { closedAt: 'desc' },
          select: { closingFloat: true },
        });
        // a previous close without `closingFloat` (HU-VEN-23 fills it) counts as no previous close: nothing to compare
        const lastClosingFloat = last?.closingFloat ? Decimal.of(last.closingFloat.toFixed(2)) : null;
        const matches = floatMatchesLastClose(openingFloat, lastClosingFloat);

        const created = await tx.cashShift.create({
          data: { companyId, registerId: register.id, openingFloat: new Prisma.Decimal(openingFloat.toString()), openedById: userId },
          include: SHIFT_WITH_PLACE,
        });

        const snapshot = {
          registerId: created.registerId,
          openingFloat: created.openingFloat.toFixed(2),
          openedById: created.openedById,
          openedAt: created.openedAt.toISOString(),
        };
        await this.audit.log(
          { action: 'sales.cash-shift.open', entity: 'CashShift', entityId: created.id, after: snapshot },
          tx as unknown as Prisma.TransactionClient,
        );
        await this.outbox.publish(
          'sales.cash-shift.opened',
          { shiftId: created.id, refType: CASH_SHIFT_REF_TYPE, ...snapshot },
          { tx, idempotencyKey: `cash-shift-opened:${created.id}` },
        );
        if (!matches) {
          // decision #17: a difference never blocks the opening, it only notifies Accounting
          await this.outbox.publish(
            'sales.cash-shift.float-mismatch',
            {
              shiftId: created.id,
              registerId: created.registerId,
              openingFloat: snapshot.openingFloat,
              lastClosingFloat: lastClosingFloat?.toString() ?? null,
            },
            { tx, idempotencyKey: `cash-shift-float-mismatch:${created.id}` },
          );
        }

        return { shift: toCurrentShift(created, openedByName), floatMismatch: !matches };
      });
    } catch (err) {
      throw mapCashUniqueViolation(err);
    }
  }

  private async findCurrent(): Promise<CurrentCashShift | null> {
    const userId = this.userId();
    if (!(await this.canSeeShift())) throw this.noPermission();
    const shift = await this.prisma.tenant.cashShift.findFirst({
      where: { openedById: userId, status: 'OPEN' },
      include: SHIFT_WITH_PLACE,
    });
    return shift ? toCurrentShift(shift, await this.userName(userId)) : null;
  }

  /** `sales.pos.use` or `sales.cash-register.open` (the permission guard only supports "all of"). */
  private async canSeeShift(): Promise<boolean> {
    const granted = await this.membership.permissions(this.membershipId());
    return granted.has('sales.pos.use') || granted.has('sales.cash-register.open');
  }

  private noPermission() {
    return new ForbiddenException({
      code: 'NO_PERMISSION',
      message: 'You do not have permission for this action',
      details: { missing: ['sales.pos.use', 'sales.cash-register.open'], anyOf: true },
    });
  }

  private async userName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return user?.name ?? '';
  }

  private membershipId(): string {
    return this.cls.get('membershipId') ?? '';
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Cash shifts outside a company context');
    return companyId;
  }

  private userId(): string {
    const userId = this.cls.get('userId');
    if (!userId) throw new Error('Cash shifts outside a user context');
    return userId;
  }
}
