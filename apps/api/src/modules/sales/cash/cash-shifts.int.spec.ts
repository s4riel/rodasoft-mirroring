/**
 * Integration test of opening the cash register (HU-VEN-01) against the real Postgres (DATABASE_URL): the opening with
 * its audit and outbox rows, the one-open-shift rules (also under concurrency), branch scoping, the float mismatch
 * notice, the caller's current shift and tenant isolation.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../../common/audit/audit.service';
import { OutboxService } from '../../../common/outbox/outbox.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import { tenantExtension } from '../../../common/prisma/tenant.extension';
import { MembershipService } from '../../access/membership.service';
import { mapCashUniqueViolation } from './cash.errors';
import { CashRegistersService } from './cash-registers.service';
import { CashShiftsService } from './cash-shifts.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;
const membership = new MembershipService(prisma);

/** Services as one caller sees them (each caller has its own request context). */
function as(userId: string, membershipId: string) {
  const cls = { get: (k: string) => (k === 'companyId' ? current : k === 'membershipId' ? membershipId : k === 'userId' ? userId : null) } as never;
  return {
    shifts: new CashShiftsService(prisma, cls, new AuditService(prisma, cls), new OutboxService(prisma, cls), membership),
    registers: new CashRegistersService(prisma, cls, membership),
  };
}

/** The error code of a rejected call, or null when it succeeds. */
async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    const known = err as { getResponse?: () => { code: string } };
    if (!known.getResponse) throw err;
    return known.getResponse().code;
  }
}

describe('Cash shifts (integration, real Postgres)', () => {
  let companyId: string;
  let otherCompanyId: string;
  let branchA: string;
  let branchB: string;
  let otherBranch: string;
  let cashier: { userId: string; membershipId: string };
  let restricted: { userId: string; membershipId: string };
  let viewer: { userId: string; membershipId: string };
  let noPermission: { userId: string; membershipId: string };
  let other: { userId: string; membershipId: string };
  const extraUserIds: string[] = [];
  let seq = 0;

  async function newRegister(branchId: string, extra: { companyId?: string; status?: 'ACTIVE' | 'INACTIVE' } = {}): Promise<string> {
    seq += 1;
    const cid = extra.companyId ?? companyId;
    const warehouse = await base.warehouse.create({ data: { companyId: cid, branchId, code: `W${seq}`, name: `Warehouse ${seq}` } });
    const pos = await base.siatPointOfSale.create({ data: { companyId: cid, branchId, code: seq, name: `POS ${seq}` } });
    return (
      await base.cashRegister.create({
        data: { companyId: cid, branchId, pointOfSaleId: pos.id, warehouseId: warehouse.id, name: `Caja ${seq}`, status: extra.status ?? 'ACTIVE' },
      })
    ).id;
  }

  async function newMember(label: string, roleId: string, opts: { allBranches?: boolean; branchId?: string; companyId?: string } = {}) {
    const user = await base.user.create({ data: { email: `cash-${label}-${run}@example.com`, name: `User ${label}` } });
    extraUserIds.push(user.id);
    const m = await base.membership.create({
      data: {
        companyId: opts.companyId ?? companyId,
        userId: user.id,
        roleId,
        allBranches: opts.allBranches ?? false,
        ...(opts.branchId ? { branches: { create: { branchId: opts.branchId } } } : {}),
      },
    });
    return { userId: user.id, membershipId: m.id };
  }

  const closedShift = (registerId: string, closingFloat: string) =>
    base.cashShift.create({
      data: {
        companyId,
        registerId,
        status: 'CLOSED',
        openingFloat: '100.00',
        openedById: cashier.userId,
        closedById: cashier.userId,
        closedAt: new Date(),
        expectedAmount: '600.00',
        countedAmount: '600.00',
        differenceAmount: '0.00',
        closingFloat,
      },
    });

  beforeAll(async () => {
    const company = await base.company.create({ data: { slug: `cash-${run}`, legalName: 'cash', tradeName: 'cash', nit: `C${run}`.slice(0, 20) } });
    const otherCompany = await base.company.create({ data: { slug: `cash2-${run}`, legalName: 'cash2', tradeName: 'cash2', nit: `D${run}`.slice(0, 20) } });
    companyId = company.id;
    otherCompanyId = otherCompany.id;
    current = companyId;
    branchA = (await base.branch.create({ data: { companyId, code: 0, name: 'Branch A' } })).id;
    branchB = (await base.branch.create({ data: { companyId, code: 1, name: 'Branch B' } })).id;
    otherBranch = (await base.branch.create({ data: { companyId: otherCompanyId, code: 0, name: 'Other branch' } })).id;

    for (const [key, description] of [
      ['sales.pos.use', 'Vender en el punto de venta'],
      ['sales.cash-register.open', 'Abrir y cerrar caja'],
    ] as const) {
      await base.permission.upsert({ where: { key }, update: {}, create: { key, description, module: 'sales' } });
    }
    const cashierRole = await base.role.create({ data: { companyId, key: 'cashier', name: 'Cajero' } });
    await base.rolePermission.createMany({
      data: [
        { roleId: cashierRole.id, permissionKey: 'sales.pos.use' },
        { roleId: cashierRole.id, permissionKey: 'sales.cash-register.open' },
      ],
    });
    const viewerRole = await base.role.create({ data: { companyId, key: 'viewer', name: 'Solo POS' } });
    await base.rolePermission.create({ data: { roleId: viewerRole.id, permissionKey: 'sales.pos.use' } });
    const bareRole = await base.role.create({ data: { companyId, key: 'bare', name: 'Sin permisos' } });
    const otherRole = await base.role.create({ data: { companyId: otherCompanyId, key: 'cashier', name: 'Cajero' } });
    await base.rolePermission.create({ data: { roleId: otherRole.id, permissionKey: 'sales.cash-register.open' } });

    cashier = await newMember('cashier', cashierRole.id, { allBranches: true });
    restricted = await newMember('restricted', cashierRole.id, { branchId: branchA });
    viewer = await newMember('viewer', viewerRole.id, { allBranches: true });
    noPermission = await newMember('bare', bareRole.id, { allBranches: true });
    other = await newMember('other', otherRole.id, { allBranches: true, companyId: otherCompanyId });
  });

  afterAll(async () => {
    const companies = [companyId, otherCompanyId];
    await base.outboxEvent.deleteMany({ where: { companyId: { in: companies } } });
    await base.auditLog.deleteMany({ where: { companyId: { in: companies } } });
    await base.cashShift.deleteMany({ where: { companyId: { in: companies } } });
    await base.cashRegister.deleteMany({ where: { companyId: { in: companies } } });
    await base.siatPointOfSale.deleteMany({ where: { companyId: { in: companies } } });
    await base.warehouse.deleteMany({ where: { companyId: { in: companies } } });
    await base.membership.deleteMany({ where: { companyId: { in: companies } } });
    await base.user.deleteMany({ where: { id: { in: extraUserIds } } });
    await base.role.deleteMany({ where: { companyId: { in: companies } } });
    await base.branch.deleteMany({ where: { companyId: { in: companies } } });
    await base.company.deleteMany({ where: { id: { in: companies } } });
    await base.$disconnect();
  });

  beforeEach(() => {
    current = companyId;
  });

  /** Closes whatever the cashier left open so the next test starts clean. */
  afterEach(async () => {
    await base.cashShift.updateMany({ where: { companyId, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
  });

  describe('open', () => {
    it('opens an OPEN shift for the caller, with the audit row and the outbox event in the same transaction', async () => {
      const registerId = await newRegister(branchA);
      const before = Date.now();
      const { shift, floatMismatch } = await as(cashier.userId, cashier.membershipId).shifts.open({ registerId, openingFloat: '500.00' });

      expect(floatMismatch).toBe(false);
      expect(shift).toMatchObject({ openingFloat: '500.00', openedBy: { id: cashier.userId }, register: { id: registerId }, branch: { id: branchA } });
      expect(new Date(shift.openedAt).getTime()).toBeGreaterThanOrEqual(before - 5_000);

      const stored = await base.cashShift.findUniqueOrThrow({ where: { id: shift.id } });
      expect(stored).toMatchObject({ status: 'OPEN', openedById: cashier.userId, registerId });
      expect(stored.openingFloat.toFixed(2)).toBe('500.00');
      expect(stored.openedAt).toBeInstanceOf(Date);

      const audit = await base.auditLog.findFirstOrThrow({ where: { companyId, action: 'sales.cash-shift.open', entityId: shift.id } });
      expect(audit).toMatchObject({ entity: 'CashShift', userId: cashier.userId });
      expect(audit.after).toMatchObject({ registerId, openingFloat: '500.00', openedById: cashier.userId });
      expect(await base.outboxEvent.count({ where: { companyId, type: 'sales.cash-shift.opened', payload: { path: ['shiftId'], equals: shift.id } } })).toBe(1);
      expect(await base.outboxEvent.count({ where: { companyId, type: 'sales.cash-shift.float-mismatch', payload: { path: ['shiftId'], equals: shift.id } } })).toBe(0);
    });

    it('accepts a zero float and the Bolivian comma format', async () => {
      const registerId = await newRegister(branchA);
      const { shift } = await as(cashier.userId, cashier.membershipId).shifts.open({ registerId, openingFloat: '0' });
      expect(shift.openingFloat).toBe('0.00');
      await base.cashShift.update({ where: { id: shift.id }, data: { status: 'CLOSED', closedAt: new Date() } });

      const second = await newRegister(branchA);
      const { shift: next } = await as(cashier.userId, cashier.membershipId).shifts.open({ registerId: second, openingFloat: '1.250,50' });
      expect(next.openingFloat).toBe('1250.50');
    });

    it.each(['', 'abc', '-5', '10.123', '99999999999'])('rejects the float %j with INVALID_OPENING_FLOAT and creates nothing', async (openingFloat) => {
      const registerId = await newRegister(branchA);
      expect(await codeOf(as(cashier.userId, cashier.membershipId).shifts.open({ registerId, openingFloat }))).toBe('INVALID_OPENING_FLOAT');
      expect(await base.cashShift.count({ where: { registerId } })).toBe(0);
    });

    it('lets exactly one of 10 concurrent openings of a register win; the rest get CASH_REGISTER_ALREADY_OPEN', async () => {
      const registerId = await newRegister(branchA);
      const contenders = [];
      for (let i = 0; i < 10; i++) contenders.push(await newMember(`race${i}`, (await base.role.findFirstOrThrow({ where: { companyId, key: 'cashier' } })).id, { allBranches: true }));

      const results = await Promise.all(contenders.map((c) => codeOf(as(c.userId, c.membershipId).shifts.open({ registerId, openingFloat: '100.00' }))));

      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.filter((r) => r === 'CASH_REGISTER_ALREADY_OPEN')).toHaveLength(9);
      expect(await base.cashShift.count({ where: { registerId, status: 'OPEN' } })).toBe(1);
    });

    it('refuses a second shift for the same user on another register with CASH_SHIFT_ALREADY_OPEN_FOR_USER', async () => {
      const first = await newRegister(branchA);
      const second = await newRegister(branchA);
      const caller = as(cashier.userId, cashier.membershipId).shifts;
      await caller.open({ registerId: first, openingFloat: '100.00' });

      expect(await codeOf(caller.open({ registerId: second, openingFloat: '100.00' }))).toBe('CASH_SHIFT_ALREADY_OPEN_FOR_USER');
      expect(await base.cashShift.count({ where: { registerId: second } })).toBe(0);
    });

    it('maps the unique index violations (the safety net behind the pre-checks) to their error codes', async () => {
      const registerId = await newRegister(branchA);
      await as(cashier.userId, cashier.membershipId).shifts.open({ registerId, openingFloat: '100.00' });

      const sameRegister = await base.cashShift
        .create({ data: { companyId, registerId, openingFloat: '1.00', openedById: restricted.userId } })
        .catch((err: unknown) => err);
      const sameUser = await base.cashShift
        .create({ data: { companyId, registerId: await newRegister(branchA), openingFloat: '1.00', openedById: cashier.userId } })
        .catch((err: unknown) => err);

      expect(mapCashUniqueViolation(sameRegister)).toMatchObject({ response: { code: 'CASH_REGISTER_ALREADY_OPEN' } });
      expect(mapCashUniqueViolation(sameUser)).toMatchObject({ response: { code: 'CASH_SHIFT_ALREADY_OPEN_FOR_USER' } });
      const other = new Error('boom');
      expect(mapCashUniqueViolation(other)).toBe(other);
    });

    it('refuses a branch outside the membership with 403 CASH_REGISTER_BRANCH_FORBIDDEN', async () => {
      const registerId = await newRegister(branchB);
      const caller = as(restricted.userId, restricted.membershipId).shifts;
      expect(await codeOf(caller.open({ registerId, openingFloat: '100.00' }))).toBe('CASH_REGISTER_BRANCH_FORBIDDEN');
      expect(await base.cashShift.count({ where: { registerId } })).toBe(0);
    });

    it('refuses an inactive register with CASH_REGISTER_INACTIVE', async () => {
      const registerId = await newRegister(branchA, { status: 'INACTIVE' });
      expect(await codeOf(as(cashier.userId, cashier.membershipId).shifts.open({ registerId, openingFloat: '100.00' }))).toBe('CASH_REGISTER_INACTIVE');
    });

    it('answers CASH_REGISTER_NOT_FOUND for an unknown register and for one of another company (tenant isolation)', async () => {
      const foreign = await newRegister(otherBranch, { companyId: otherCompanyId });
      const caller = as(cashier.userId, cashier.membershipId).shifts;
      expect(await codeOf(caller.open({ registerId: randomUUID(), openingFloat: '100.00' }))).toBe('CASH_REGISTER_NOT_FOUND');
      expect(await codeOf(caller.open({ registerId: foreign, openingFloat: '100.00' }))).toBe('CASH_REGISTER_NOT_FOUND');
      expect(await base.cashShift.count({ where: { registerId: foreign } })).toBe(0);
    });

    it('publishes sales.cash-shift.float-mismatch when the float differs from the last close, and still opens', async () => {
      const registerId = await newRegister(branchA);
      await closedShift(registerId, '500.00');

      const { shift, floatMismatch } = await as(cashier.userId, cashier.membershipId).shifts.open({ registerId, openingFloat: '450.00' });

      expect(floatMismatch).toBe(true);
      expect(shift.openingFloat).toBe('450.00');
      const events = await base.outboxEvent.findMany({ where: { companyId, type: 'sales.cash-shift.float-mismatch', payload: { path: ['shiftId'], equals: shift.id } } });
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({ openingFloat: '450.00', lastClosingFloat: '500.00' });
    });

    it('does not publish the mismatch event when the float matches the last close', async () => {
      const registerId = await newRegister(branchA);
      await closedShift(registerId, '500.00');

      const { shift, floatMismatch } = await as(cashier.userId, cashier.membershipId).shifts.open({ registerId, openingFloat: '500,00' });

      expect(floatMismatch).toBe(false);
      expect(await base.outboxEvent.count({ where: { companyId, type: 'sales.cash-shift.float-mismatch', payload: { path: ['shiftId'], equals: shift.id } } })).toBe(0);
    });
  });

  describe('current and requireOpenShift', () => {
    it('returns the caller’s open shift and null for another user', async () => {
      const registerId = await newRegister(branchA);
      const { shift } = await as(cashier.userId, cashier.membershipId).shifts.open({ registerId, openingFloat: '100.00' });

      expect((await as(cashier.userId, cashier.membershipId).shifts.current()).shift).toMatchObject({ id: shift.id, register: { id: registerId } });
      expect((await as(restricted.userId, restricted.membershipId).shifts.current()).shift).toBeNull();
    });

    it('lets a user with only sales.pos.use read it, and refuses one with neither permission', async () => {
      expect((await as(viewer.userId, viewer.membershipId).shifts.current()).shift).toBeNull();
      expect(await codeOf(as(noPermission.userId, noPermission.membershipId).shifts.current())).toBe('NO_PERMISSION');
    });

    it('requireOpenShift throws CASH_SHIFT_NOT_OPEN without a shift and returns it with one', async () => {
      const caller = as(cashier.userId, cashier.membershipId).shifts;
      expect(await codeOf(caller.requireOpenShift())).toBe('CASH_SHIFT_NOT_OPEN');
      const { shift } = await caller.open({ registerId: await newRegister(branchA), openingFloat: '100.00' });
      expect((await caller.requireOpenShift()).id).toBe(shift.id);
    });

    it('does not see the shift of another company', async () => {
      expect((await as(other.userId, other.membershipId).shifts.current()).shift).toBeNull();
    });
  });

  describe('registers list', () => {
    it('shows each active register in the allowed branches with its open shift and last close', async () => {
      const free = await newRegister(branchA);
      const taken = await newRegister(branchA);
      const closed = await newRegister(branchA);
      const inactive = await newRegister(branchA, { status: 'INACTIVE' });
      const otherBranchRegister = await newRegister(branchB);
      await as(cashier.userId, cashier.membershipId).shifts.open({ registerId: taken, openingFloat: '100.00' });
      await closedShift(closed, '350.00');

      const { items } = await as(restricted.userId, restricted.membershipId).registers.list({});
      const byId = new Map(items.map((i) => [i.id, i]));

      expect(byId.get(free)).toMatchObject({ openShift: null, lastClose: null, branch: { id: branchA } });
      expect(byId.get(taken)?.openShift).toMatchObject({ openedByName: 'User cashier' });
      expect(byId.get(closed)?.lastClose).toMatchObject({ closingFloat: '350.00', differenceAmount: '0.00', closedByName: 'User cashier' });
      expect(byId.has(inactive)).toBe(false);
      expect(byId.has(otherBranchRegister)).toBe(false);
    });

    it('refuses a branch filter outside the membership and filters by branch otherwise', async () => {
      const inB = await newRegister(branchB);
      expect(await codeOf(as(restricted.userId, restricted.membershipId).registers.list({ branchId: branchB }))).toBe('CASH_REGISTER_BRANCH_FORBIDDEN');
      const { items } = await as(cashier.userId, cashier.membershipId).registers.list({ branchId: branchB });
      expect(items.map((i) => i.id)).toContain(inB);
      expect(items.every((i) => i.branch.id === branchB)).toBe(true);
    });

    it('does not list registers of another company', async () => {
      const foreign = await newRegister(otherBranch, { companyId: otherCompanyId });
      const { items } = await as(cashier.userId, cashier.membershipId).registers.list({});
      expect(items.map((i) => i.id)).not.toContain(foreign);
    });
  });
});
