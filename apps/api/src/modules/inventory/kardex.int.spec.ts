/**
 * HU-INV-24 · integration test of the kardex against the real Postgres (DATABASE_URL). Creates throw-away companies and
 * removes them at the end, so it is safe to run against the dev database.
 */
import { PrismaClient } from '@prisma/client';
import { defaultKardexRange, laPazToday, STOCK_MOVEMENT_TYPE_LABELS } from '@rodasoft/domain';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import type { MembershipService } from '../access/membership.service';
import { KardexLedgerService } from './kardex-ledger.service';
import { KardexService } from './kardex.service';
import { StockMovementService } from './stock-movement.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;

let membershipId: string | null = null;
const cls = { get: (k: string) => (k === 'companyId' ? current : k === 'membershipId' ? membershipId : null) } as never;

/** Grants and branch scope per membership id, set up by the fixture. */
const grants = new Map<string, string[]>();
const scopes = new Map<string, string[] | null>();
const membership = {
  permissions: async (id: string) => new Set(grants.get(id) ?? []),
  operableBranchIds: async (id: string) => (scopes.has(id) ? scopes.get(id) : []),
} as unknown as MembershipService;

const kardex = new KardexService(prisma, cls, membership);
const ledger = new KardexLedgerService(prisma, kardex);
const stock = new StockMovementService(cls, new SettingsService(prisma));

const VIEW = 'inventory.kardex.view';
const COSTS = 'inventory.costs.view';

/** La Paz calendar day `n` days ago, and instants on it (noon and one hour later), so a movement never straddles midnight. */
const laPazDay = (n: number) => laPazToday(new Date(Date.now() - n * 24 * 3_600_000));
const noon = (n: number) => new Date(`${laPazDay(n)}T12:00:00-04:00`);
const afternoon = (n: number) => new Date(`${laPazDay(n)}T13:00:00-04:00`);

async function purgeMovements(companyId: string) {
  await base.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.stockMovement.deleteMany({ where: { companyId } });
  });
}

interface Fixture {
  companyId: string;
  branchA: string;
  branchB: string;
  whA: string;
  whA2: string;
  whB: string;
  productId: string;
  brandId: string;
  categoryId: string;
  userId: string;
  full: string;
  withCost: string;
  limited: string;
  noKardex: string;
}

async function createProduct(f: { companyId: string; brandId: string; categoryId: string }, code: string) {
  return (
    await base.product.create({
      data: { companyId: f.companyId, sku: `RL-${code}`, manufacturerCode: code, brandId: f.brandId, categoryId: f.categoryId, name: code, salePrice: '10.00' },
    })
  ).id;
}

async function createCompany(tag: string): Promise<Fixture> {
  const company = await base.company.create({ data: { slug: `kx-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `${tag}${run}`.slice(0, 20) } });
  const companyId = company.id;
  const [a, b] = await Promise.all([0, 1].map((code) => base.branch.create({ data: { companyId, code, name: `Branch ${tag}${code}` } })));
  const [whA, whA2, whB] = await Promise.all([
    base.warehouse.create({ data: { companyId, branchId: a.id, code: `A-01-${run}`, name: `WH A ${tag}`, isMain: true } }),
    base.warehouse.create({ data: { companyId, branchId: a.id, code: `A-02-${run}`, name: `WH A2 ${tag}` } }),
    base.warehouse.create({ data: { companyId, branchId: b.id, code: `B-01-${run}`, name: `WH B ${tag}`, isMain: true } }),
  ]);
  const role = await base.role.create({ data: { companyId, key: 'it', name: 'it' } });
  const user = await base.user.create({ data: { email: `kx-${tag}-${run}@test.local`, name: `User ${tag}` } });
  const membershipOf = async (n: number, allBranches: boolean, branchIds: string[] = []) => {
    const u = n === 0 ? user : await base.user.create({ data: { email: `kx${n}-${tag}-${run}@test.local`, name: `U${n}` } });
    return (
      await base.membership.create({
        data: { companyId, userId: u.id, roleId: role.id, allBranches, branches: { create: branchIds.map((branchId) => ({ branchId })) } },
      })
    ).id;
  };
  const full = await membershipOf(0, true);
  const withCost = await membershipOf(1, true);
  const limited = await membershipOf(2, false, [a.id]);
  const noKardex = await membershipOf(3, true);
  grants.set(full, [VIEW]);
  grants.set(withCost, [VIEW, COSTS]);
  grants.set(limited, [VIEW]);
  grants.set(noKardex, []);
  scopes.set(full, null);
  scopes.set(withCost, null);
  scopes.set(limited, [a.id]);
  scopes.set(noKardex, null);

  const brand = await base.brand.create({ data: { companyId, name: `Brand ${tag}` } });
  const category = await base.category.create({ data: { companyId, name: `Cat ${tag}` } });
  const ids = { companyId, brandId: brand.id, categoryId: category.id };
  const productId = await createProduct(ids, `P-${tag}-${run}`);
  return { ...ids, branchA: a.id, branchB: b.id, whA: whA.id, whA2: whA2.id, whB: whB.id, productId, userId: user.id, full, withCost, limited, noKardex };
}

async function removeCompany(companyId: string) {
  await purgeMovements(companyId);
  await base.stockLevel.deleteMany({ where: { companyId } });
  await base.stockAdjustment.deleteMany({ where: { companyId } });
  await base.transfer.deleteMany({ where: { companyId } });
  await base.product.deleteMany({ where: { companyId } });
  await base.category.deleteMany({ where: { companyId } });
  await base.brand.deleteMany({ where: { companyId } });
  const memberships = await base.membership.findMany({ where: { companyId }, select: { id: true, userId: true } });
  await base.membershipBranch.deleteMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  await base.membership.deleteMany({ where: { companyId } });
  await base.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
  await base.role.deleteMany({ where: { companyId } });
  await base.warehouse.deleteMany({ where: { companyId } });
  await base.branch.deleteMany({ where: { companyId } });
  await base.company.delete({ where: { id: companyId } });
}

/** The error body of a rejected call, or null when it succeeds. */
async function failureOf(promise: Promise<unknown>): Promise<{ status: number; code: string } | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    const e = err as { getStatus(): number; getResponse(): { code: string } };
    return { status: e.getStatus(), code: e.getResponse().code };
  }
}

describe('KardexService (integration, real Postgres)', () => {
  let a: Fixture;
  let b: Fixture;
  const as = (m: string) => {
    membershipId = m;
  };

  beforeAll(async () => {
    a = await createCompany('a');
    b = await createCompany('b');

    // Product of company A, days ago (La Paz days), each warehouse's balance_after chained:
    //   60 whA INITIAL +20 → 20            55 whB INITIAL +10 → 10
    //   40 whA PURCHASE_RECEIPT +30 → 50 (cost 5.0000)
    //   30 whA TRANSFER_OUT -15 → 35, then whB TRANSFER_IN +15 → 25 an hour later
    //   20 whA ADJUSTMENT_OUT -5 → 30
    //   10 whB SALE -5 → 20 (no unit cost)
    // Levels: whA 30, whB 20 → 50 in total.
    const movement = (warehouseId: string, type: 'INITIAL' | 'PURCHASE_RECEIPT' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUSTMENT_OUT' | 'SALE', quantity: number, balanceAfter: number, createdAt: Date, extra: object = {}) => ({
      companyId: a.companyId,
      productId: a.productId,
      warehouseId,
      type,
      quantity,
      balanceAfter,
      createdAt,
      userId: a.userId,
      ...extra,
    });
    await base.stockMovement.createMany({
      data: [
        movement(a.whA, 'INITIAL', 20, 20, noon(60)),
        movement(a.whB, 'INITIAL', 10, 10, noon(55)),
        movement(a.whA, 'PURCHASE_RECEIPT', 30, 50, noon(40), { unitCost: '5.0000', refType: 'PURCHASE', refNumber: 'C-0001' }),
        movement(a.whA, 'TRANSFER_OUT', -15, 35, noon(30), { unitCost: '5.0000', refType: 'TRANSFER', refNumber: 'TR-0045' }),
        movement(a.whB, 'TRANSFER_IN', 15, 25, afternoon(30), { unitCost: '5.0000', refType: 'TRANSFER', refNumber: 'TR-0045' }),
        movement(a.whA, 'ADJUSTMENT_OUT', -5, 30, noon(20), { refType: 'ADJUSTMENT', refNumber: 'AJ-000001', unitCost: '5.0000' }),
        movement(a.whB, 'SALE', -5, 20, noon(10), { refType: 'SALE', refNumber: 'V-00231' }),
      ],
    });
    await base.stockLevel.createMany({
      data: [
        { companyId: a.companyId, productId: a.productId, warehouseId: a.whA, quantity: 30 },
        { companyId: a.companyId, productId: a.productId, warehouseId: a.whB, quantity: 20 },
      ],
    });

    // Company B has its own product with a movement the other company must never see
    await base.stockMovement.create({
      data: { companyId: b.companyId, productId: b.productId, warehouseId: b.whA, type: 'INITIAL', quantity: 99, balanceAfter: 99, createdAt: noon(30) },
    });
    await base.stockLevel.create({ data: { companyId: b.companyId, productId: b.productId, warehouseId: b.whA, quantity: 99 } });
  });

  afterAll(async () => {
    current = null;
    await removeCompany(a.companyId);
    await removeCompany(b.companyId);
    await base.$disconnect();
  });

  beforeEach(() => {
    current = a.companyId;
    as(a.full);
  });

  const middle = () => ({ from: laPazDay(35), to: laPazDay(15) });

  describe('all warehouses', () => {
    it('lists the movements oldest first with date, type, document, warehouse, user, in, out and a running balance', async () => {
      const res = await kardex.kardex({ productId: a.productId, ...middle() });

      expect(res.items.map((r) => r.type)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT_OUT']);
      expect(res.items.map((r) => r.typeLabel)).toEqual(['Salida por transferencia', 'Entrada por transferencia', 'Ajuste (−)']);
      expect(res.items.map((r) => [r.quantityIn, r.quantityOut])).toEqual([[0, 15], [15, 0], [0, 5]]);
      // opening 30 + 50... = whA 50 + whB 10 = 60, then 45, 60, 55
      expect(res.openingBalance).toBe(60);
      expect(res.items.map((r) => r.balance)).toEqual([45, 60, 55]);
      expect(res.items.map((r) => r.warehouseBalance)).toEqual([35, 25, 30]);
      expect(res.items[0]).toMatchObject({
        date: noon(30).toISOString(),
        document: { refType: 'TRANSFER', refNumber: 'TR-0045' },
        warehouse: { id: a.whA },
        branch: { id: a.branchA },
        user: 'User a',
      });
      expect(res.totals).toMatchObject({ quantityIn: 15, quantityOut: 20, closingBalance: 55 });
      expect(res.total).toBe(3);
      expect(res.filters).toEqual({ warehouseId: null, from: middle().from, to: middle().to });
      expect(res.product).toMatchObject({ id: a.productId, manufacturerCode: `P-a-${run}`, brand: 'Brand a', currentStock: 50 });
    });

    it('opens with the stock just before `from`, and a range with no movements keeps it', async () => {
      const quiet = await kardex.kardex({ productId: a.productId, from: laPazDay(5), to: laPazDay(1) });
      expect(quiet.items).toEqual([]);
      expect(quiet.total).toBe(0);
      expect(quiet.openingBalance).toBe(50);
      expect(quiet.totals).toMatchObject({ quantityIn: 0, quantityOut: 0, closingBalance: 50 });

      const beforeAny = await kardex.kardex({ productId: a.productId, from: laPazDay(100), to: laPazDay(70) });
      expect(beforeAny.openingBalance).toBe(0);
      expect(beforeAny.items).toEqual([]);
    });

    it('includes the movements of the first and the last day of the range (La Paz days)', async () => {
      const res = await kardex.kardex({ productId: a.productId, from: laPazDay(30), to: laPazDay(30) });
      expect(res.items.map((r) => r.type)).toEqual(['TRANSFER_OUT', 'TRANSFER_IN']);
      expect(res.openingBalance).toBe(60);
    });

    it('carries the running balance over to the next page', async () => {
      const page1 = await kardex.kardex({ productId: a.productId, ...middle(), page: 1, pageSize: 2 });
      const page2 = await kardex.kardex({ productId: a.productId, ...middle(), page: 2, pageSize: 2 });
      expect(page1.items.map((r) => r.balance)).toEqual([45, 60]);
      expect(page2.items.map((r) => r.balance)).toEqual([55]);
      expect(page2.items[0]?.type).toBe('ADJUSTMENT_OUT');
      expect([page1.total, page2.total]).toEqual([3, 3]);
      // the totals describe the whole range, not the page
      expect(page2.totals).toMatchObject({ quantityIn: 15, quantityOut: 20, closingBalance: 55 });
    });

    it('closes at the sum of stock_levels when the range reaches today', async () => {
      const res = await kardex.kardex({ productId: a.productId, from: laPazDay(61), to: laPazToday(new Date()) });
      expect(res.openingBalance).toBe(0);
      expect(res.total).toBe(7);
      expect(res.totals.closingBalance).toBe(50);
      expect(res.items.at(-1)?.balance).toBe(50);
      const levels = await base.stockLevel.aggregate({ where: { productId: a.productId }, _sum: { quantity: true } });
      expect(res.totals.closingBalance).toBe(levels._sum.quantity);
    });

    it('uses the current La Paz month when no dates are given', async () => {
      const res = await kardex.kardex({ productId: a.productId });
      expect(res.filters).toEqual({ warehouseId: null, ...defaultKardexRange(new Date()) });
      expect(res.totals.closingBalance).toBe(50); // the month reaches today, so it closes at the current stock
    });
  });

  describe('one warehouse', () => {
    it('shows that warehouse balance_after and opens with its own last balance', async () => {
      const res = await kardex.kardex({ productId: a.productId, warehouseId: a.whA, ...middle() });
      expect(res.openingBalance).toBe(50);
      expect(res.items.map((r) => r.balance)).toEqual([35, 30]);
      expect(res.items.map((r) => r.warehouseBalance)).toEqual([35, 30]);
      expect(res.totals).toMatchObject({ quantityIn: 0, quantityOut: 20, closingBalance: 30 });
      expect(res.filters.warehouseId).toBe(a.whA);
      expect(res.product.currentStock).toBe(30);
    });

    it('a warehouse that has not moved yet opens at 0', async () => {
      const res = await kardex.kardex({ productId: a.productId, warehouseId: a.whB, from: laPazDay(58), to: laPazDay(50) });
      expect(res.openingBalance).toBe(0);
      expect(res.items.map((r) => r.balance)).toEqual([10]);
    });

    it('a warehouse with no movements at all gives an empty kardex', async () => {
      const res = await kardex.kardex({ productId: a.productId, warehouseId: a.whA2, from: laPazDay(61), to: laPazToday(new Date()) });
      expect(res).toMatchObject({ openingBalance: 0, total: 0, items: [], totals: { closingBalance: 0 } });
    });

    it('filters by branch', async () => {
      const res = await kardex.kardex({ productId: a.productId, branchId: a.branchB, ...middle() });
      expect(res.items.map((r) => r.type)).toEqual(['TRANSFER_IN']);
      expect(res.openingBalance).toBe(10);
      expect(res.items[0]?.balance).toBe(25);
    });
  });

  describe('costs', () => {
    it('adds unit cost and values only with inventory.costs.view', async () => {
      as(a.withCost);
      const res = await kardex.kardex({ productId: a.productId, from: laPazDay(61), to: laPazToday(new Date()) });
      expect(res.includesCost).toBe(true);
      const purchase = res.items.find((r) => r.type === 'PURCHASE_RECEIPT');
      expect(purchase).toMatchObject({ unitCost: '5.0000', valueIn: '150.00', valueOut: null, balanceValue: '300.00' });
      const out = res.items.find((r) => r.type === 'TRANSFER_OUT');
      expect(out).toMatchObject({ valueIn: null, valueOut: '75.00' });
      // no unit cost: no value, not a zero
      expect(res.items.find((r) => r.type === 'SALE')).toMatchObject({ unitCost: null, valueOut: null, balanceValue: null });
      // inflows with a cost: 150 + 75 (the transfer in); outflows: 75 + 25
      expect(res.totals).toMatchObject({ valueIn: '225.00', valueOut: '100.00' });
    });

    it('leaves the valued fields out of the response without the permission', async () => {
      const res = await kardex.kardex({ productId: a.productId, from: laPazDay(61), to: laPazToday(new Date()) });
      expect(res.includesCost).toBe(false);
      for (const row of res.items) {
        for (const key of ['unitCost', 'valueIn', 'valueOut', 'balanceValue']) expect(row).not.toHaveProperty(key);
      }
      expect(res.totals).not.toHaveProperty('valueIn');
      expect(res.totals).not.toHaveProperty('valueOut');
      expect(JSON.stringify(res)).not.toContain('5.0000');
    });
  });

  describe('scope, isolation and filters', () => {
    it('limits a member to the branches they operate', async () => {
      as(a.limited);
      const res = await kardex.kardex({ productId: a.productId, ...middle() });
      expect(res.openingBalance).toBe(50);
      expect(res.items.map((r) => r.type)).toEqual(['TRANSFER_OUT', 'ADJUSTMENT_OUT']);
      expect(res.items.map((r) => r.balance)).toEqual([35, 30]);
      expect(res.product.currentStock).toBe(30);
    });

    it('treats a warehouse of a branch the member cannot operate as not existing', async () => {
      as(a.limited);
      expect(await failureOf(kardex.kardex({ productId: a.productId, warehouseId: a.whB }))).toEqual({ status: 404, code: 'WAREHOUSE_NOT_FOUND' });
      expect(await failureOf(kardex.kardex({ productId: a.productId, branchId: a.branchB }))).toEqual({ status: 403, code: 'BRANCH_NOT_ALLOWED' });
      expect(await failureOf(kardex.export({ productId: a.productId, warehouseId: a.whB }))).toEqual({ status: 404, code: 'WAREHOUSE_NOT_FOUND' });
    });

    it('never shows another company: its product, its warehouse and its branch do not exist', async () => {
      expect(await failureOf(kardex.kardex({ productId: b.productId }))).toEqual({ status: 404, code: 'PRODUCT_NOT_FOUND' });
      expect(await failureOf(kardex.kardex({ productId: a.productId, warehouseId: b.whA }))).toEqual({ status: 404, code: 'WAREHOUSE_NOT_FOUND' });
      expect(await failureOf(kardex.kardex({ productId: a.productId, branchId: b.branchA }))).toEqual({ status: 404, code: 'BRANCH_NOT_FOUND' });

      current = b.companyId;
      as(b.full);
      const own = await kardex.kardex({ productId: b.productId, from: laPazDay(61), to: laPazToday(new Date()) });
      expect(own.items.map((r) => r.quantityIn)).toEqual([99]);
      expect(await failureOf(kardex.kardex({ productId: a.productId }))).toEqual({ status: 404, code: 'PRODUCT_NOT_FOUND' });
    });

    it('refuses a range that is reversed or longer than 366 days', async () => {
      expect(await failureOf(kardex.kardex({ productId: a.productId, from: '2026-10-31', to: '2026-10-01' }))).toEqual({ status: 400, code: 'INVALID_FILTER' });
      expect(await failureOf(kardex.kardex({ productId: a.productId, from: '2025-01-01', to: '2026-10-01' }))).toEqual({ status: 400, code: 'INVALID_FILTER' });
      expect(await failureOf(kardex.kardex({ productId: a.productId, from: '2026-02-30', to: '2026-03-01' }))).toEqual({ status: 400, code: 'INVALID_FILTER' });
    });

    it('answers 404 PRODUCT_NOT_FOUND for an unknown product', async () => {
      expect(await failureOf(kardex.kardex({ productId: randomUUID() }))).toEqual({ status: 404, code: 'PRODUCT_NOT_FOUND' });
    });
  });

  describe('export', () => {
    it('writes the range as an .xlsx with the opening and closing rows', async () => {
      as(a.withCost);
      const { file, name } = await kardex.export({ productId: a.productId, ...middle() });
      expect(name).toBe(`kardex-P-a-${run}.xlsx`);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet('Kardex');
      const rows = (sheet?.getSheetValues() ?? []).filter(Array.isArray).map((r) => r.slice(1));
      const header = rows.find((r) => r[0] === 'Fecha');
      expect(header).toEqual(['Fecha', 'Tipo', 'Documento', 'Sucursal', 'Almacén', 'Usuario', 'Entrada', 'Salida', 'Saldo', 'Costo unit.', 'Valor entrada', 'Valor salida', 'Valor saldo']);
      expect(rows.find((r) => r[1] === 'Saldo inicial')?.[8]).toBe(60);
      const closing = rows.find((r) => r[1] === 'Saldo final');
      expect(closing?.slice(6, 9)).toEqual([15, 20, 55]);
      expect(rows.filter((r) => r[1] === STOCK_MOVEMENT_TYPE_LABELS.TRANSFER_OUT)).toHaveLength(1);
    });

    it('has no cost columns without the permission', async () => {
      const { file } = await kardex.export({ productId: a.productId, ...middle() });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
      const text = JSON.stringify(workbook.getWorksheet('Kardex')?.getSheetValues());
      expect(text).not.toContain('Costo unit.');
      expect(text).not.toContain('5.0000');
    });
  });

  describe('movements stamped out of lock order', () => {
    it('opens with the sum of what moved, not the balance_after of the latest created_at', async () => {
      const productId = await createProduct(a, `OO-${run}`);
      const at = (day: number, hour: string) => new Date(`${laPazDay(day)}T${hour}-04:00`);
      const m = (quantity: number, balanceAfter: number, createdAt: Date) => ({
        companyId: a.companyId, productId, warehouseId: a.whA, type: 'SALE' as const, quantity, balanceAfter, createdAt,
      });
      // 10 in; then two sales written in the opposite order to their created_at: -3 took the lock first (7), -2 second (5)
      await base.stockMovement.createMany({
        data: [
          { ...m(10, 10, at(50, '12:00:00')), type: 'INITIAL' },
          m(-3, 7, at(20, '12:00:00')),
          m(-2, 5, at(20, '11:00:00')),
        ],
      });
      const res = await kardex.kardex({ productId, from: laPazDay(19), to: laPazDay(10) });
      expect(res.openingBalance).toBe(5);
      expect(res.totals.closingBalance).toBe(5);
    });
  });

  describe('ledger of every movement', () => {
    let x: string;
    let y: string;
    let transferId: string;
    let adjustmentId: string;
    const window = () => ({ from: laPazDay(101), to: laPazDay(95) });

    beforeAll(async () => {
      x = await createProduct(a, `LX-${run}`);
      y = await createProduct(a, `LY-${run}`);
      transferId = (
        await base.transfer.create({
          data: { companyId: a.companyId, number: 'TR-LEDGER', status: 'IN_TRANSIT', originWarehouseId: a.whA, destinationWarehouseId: a.whB },
        })
      ).id;
      adjustmentId = (
        await base.stockAdjustment.create({
          data: { companyId: a.companyId, number: 'AJ-LEDGER', status: 'APPROVED', source: 'MANUAL', warehouseId: a.whA, reason: 'SHRINKAGE' },
        })
      ).id;
      const m = (productId: string, warehouseId: string, type: 'INITIAL' | 'TRANSFER_OUT' | 'ADJUSTMENT_OUT' | 'ADJUSTMENT_IN', quantity: number, balanceAfter: number, day: number, extra: object = {}) => ({
        companyId: a.companyId, productId, warehouseId, type, quantity, balanceAfter, createdAt: noon(day), userId: a.userId, ...extra,
      });
      await base.stockMovement.createMany({
        data: [
          m(x, a.whA, 'INITIAL', 10, 10, 100, { unitCost: '2.5000' }),
          m(y, a.whB, 'INITIAL', 5, 5, 99),
          m(x, a.whA, 'TRANSFER_OUT', -4, 6, 98, { refType: 'TRANSFER', refId: transferId, refNumber: 'TR-LEDGER' }),
          m(x, a.whA, 'ADJUSTMENT_OUT', -1, 5, 97, { refType: 'ADJUSTMENT', refId: adjustmentId, refNumber: 'AJ-LEDGER' }),
          m(y, a.whB, 'ADJUSTMENT_IN', 2, 7, 96, { refType: 'ADJUSTMENT', refNumber: 'AJ-QUICK' }),
        ],
      });
    });

    it('lists the movements of every product newest first with totals, pills and the balance of each warehouse', async () => {
      const res = await ledger.ledger(window());
      expect(res.items.map((r) => r.type)).toEqual(['ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'INITIAL', 'INITIAL']);
      expect(res.items.map((r) => r.quantity)).toEqual([2, -1, -4, 5, 10]);
      expect(res.items.map((r) => r.balance)).toEqual([7, 5, 6, 5, 10]);
      expect(res.items.map((r) => r.pill)).toEqual(['IN', 'OUT', 'TRANSFER', 'IN', 'IN']);
      expect(res.items[0]).toMatchObject({
        typeLabel: 'Ajuste (+)',
        product: { id: y, manufacturerCode: `LY-${run}`, brand: 'Brand a' },
        branch: { id: a.branchB },
        warehouse: { id: a.whB },
        user: 'User a',
        document: { refType: 'ADJUSTMENT', refNumber: 'AJ-QUICK' },
      });
      expect(res.total).toBe(5);
      expect(res.totals).toEqual({ quantityIn: 17, quantityOut: 5, net: 12 });
      expect(res.filters).toMatchObject({ type: null, q: null, from: window().from, to: window().to });
    });

    it('names no destination for pieces that come back to the origin of a cancelled transfer', async () => {
      const z = await createProduct(a, `LZ-${run}`);
      await base.stockMovement.create({
        data: { companyId: a.companyId, productId: z, warehouseId: a.whA, type: 'TRANSFER_IN', quantity: 4, balanceAfter: 4, createdAt: noon(90), refType: 'TRANSFER', refId: transferId, refNumber: 'TR-LEDGER' },
      });
      const res = await ledger.ledger({ from: laPazDay(91), to: laPazDay(89) });
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({ pill: 'TRANSFER', counterpart: null, documentLink: { kind: 'TRANSFER', id: transferId } });
    });

    it('names the other side of a transfer and whether it is still on the way', async () => {
      const res = await ledger.ledger({ ...window(), type: 'TRANSFER_OUT' });
      expect(res.items).toHaveLength(1);
      expect(res.items[0]?.counterpart).toEqual({ direction: 'TO', branch: 'Branch a1', warehouse: 'WH B a', inTransit: true });
      expect(res.items[0]?.documentLink).toEqual({ kind: 'TRANSFER', id: transferId });
    });

    it('links an adjustment document to itself and a quick adjustment to nothing', async () => {
      const res = await ledger.ledger({ ...window(), q: 'AJ-' });
      const byNumber = new Map(res.items.map((r) => [r.document.refNumber, r.documentLink]));
      expect(byNumber.get('AJ-LEDGER')).toEqual({ kind: 'ADJUSTMENT', id: adjustmentId });
      expect(byNumber.get('AJ-QUICK')).toBeNull();
    });

    it('filters by type, search text, branch and warehouse', async () => {
      expect((await ledger.ledger({ ...window(), type: 'ADJUSTMENT_OUT' })).total).toBe(1);
      expect((await ledger.ledger({ ...window(), q: 'tr-ledger' })).total).toBe(1);
      expect((await ledger.ledger({ ...window(), q: `lx-${run}` })).total).toBe(3);
      // a % in the search is text, not a wildcard
      expect((await ledger.ledger({ ...window(), q: '%' })).total).toBe(0);
      expect((await ledger.ledger({ ...window(), branchId: a.branchB })).items.map((r) => r.product.id)).toEqual([y, y]);
      expect((await ledger.ledger({ ...window(), warehouseId: a.whA })).total).toBe(3);
    });

    it('pages the ledger and keeps the totals of the whole range', async () => {
      const second = await ledger.ledger({ ...window(), page: 2, pageSize: 2 });
      expect(second.items.map((r) => r.type)).toEqual(['TRANSFER_OUT', 'INITIAL']);
      expect(second).toMatchObject({ total: 5, page: 2, pageSize: 2, totals: { quantityIn: 17, quantityOut: 5 } });
    });

    it('adds costs only with inventory.costs.view', async () => {
      as(a.withCost);
      const withCost = await ledger.ledger({ ...window(), q: `lx-${run}`, type: 'INITIAL' });
      expect(withCost.includesCost).toBe(true);
      expect(withCost.items[0]).toMatchObject({ unitCost: '2.5000', value: '25.00' });

      as(a.full);
      const plain = await ledger.ledger({ ...window(), q: `lx-${run}`, type: 'INITIAL' });
      expect(plain.includesCost).toBe(false);
      expect(plain.items[0]).not.toHaveProperty('unitCost');
      expect(plain.items[0]).not.toHaveProperty('value');
    });

    it('limits a member to their branches and keeps other companies out', async () => {
      as(a.limited);
      const limited = await ledger.ledger(window());
      expect(limited.items.every((r) => r.branch.id === a.branchA)).toBe(true);
      expect(limited.total).toBe(3);
      expect(limited.totals).toMatchObject({ quantityIn: 10, quantityOut: 5 });
      expect(await failureOf(ledger.ledger({ ...window(), branchId: a.branchB }))).toEqual({ status: 403, code: 'BRANCH_NOT_ALLOWED' });

      current = b.companyId;
      as(b.full);
      const other = await ledger.ledger({ from: laPazDay(31), to: laPazDay(29) });
      expect(other.items.map((r) => r.quantity)).toEqual([99]);
      expect((await ledger.ledger(window())).total).toBe(0);
    });

    it('refuses a bad range like the kardex does', async () => {
      expect(await failureOf(ledger.ledger({ from: '2026-10-31', to: '2026-10-01' }))).toEqual({ status: 400, code: 'INVALID_FILTER' });
    });

    it('exports the filtered ledger as an .xlsx', async () => {
      const { file, name } = await ledger.export({ ...window(), q: `lx-${run}` });
      expect(name).toBe('kardex-movimientos.xlsx');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
      const rows = (workbook.getWorksheet('Kardex')?.getSheetValues() ?? []).filter(Array.isArray).map((r) => r.slice(1));
      expect(rows.find((r) => r[0] === 'Fecha')).toEqual(['Fecha', 'Tipo', 'Movimiento', 'Documento', 'Producto', 'Sucursal', 'Almacén', 'Detalle', 'Usuario', 'Cantidad', 'Saldo']);
      expect(rows.filter((r) => String(r[4] ?? '').startsWith(`LX-${run}`))).toHaveLength(3);
      expect(rows.find((r) => r[2] === 'Salida por transferencia')?.[7]).toBe('Hacia Branch a1 · WH B a · en tránsito');
    });
  });

  describe('under concurrency', () => {
    it('keeps a gapless running balance that ends at stock_levels after 20 parallel movements', async () => {
      const productId = await createProduct(a, `CC-${run}`);
      const apply = (warehouseId: string, type: 'INITIAL' | 'SALE' | 'ADJUSTMENT_IN', quantity: number) =>
        base.tenant.$transaction((tx) => stock.apply(tx, { productId, warehouseId, type, quantity, reason: 'Concurrency test', refType: 'TEST', refNumber: 'CC' }));

      await apply(a.whA, 'INITIAL', 50);
      await apply(a.whB, 'INITIAL', 50);
      // 20 at once over two warehouses: sales and receipts interleave under the stock locks
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? apply(i % 2 ? a.whA : a.whB, 'ADJUSTMENT_IN', 3) : apply(i % 2 ? a.whA : a.whB, 'SALE', -2))),
      );
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

      const today = laPazToday(new Date());
      const res = await kardex.kardex({ productId, from: laPazDay(5), to: today, pageSize: 100 });
      expect(res.total).toBe(22);

      // the running total moves by exactly each movement's quantity: no gap, no duplicate
      let previous = res.openingBalance;
      for (const row of res.items) {
        expect(row.balance).toBe(previous + row.quantityIn - row.quantityOut);
        previous = row.balance;
      }
      // and so does each warehouse's own balance_after
      const lastOf = new Map<string, number>();
      for (const row of res.items) {
        const before = lastOf.get(row.warehouse.id) ?? 0;
        expect(row.warehouseBalance).toBe(before + row.quantityIn - row.quantityOut);
        lastOf.set(row.warehouse.id, row.warehouseBalance);
      }
      const levels = await base.stockLevel.aggregate({ where: { productId }, _sum: { quantity: true } });
      expect(previous).toBe(levels._sum.quantity);
      expect(res.totals.closingBalance).toBe(levels._sum.quantity);

      // the ledger holds each of the 22 movements once, and what it nets out is the stock
      const all = await ledger.ledger({ from: laPazDay(5), to: today, q: `CC-${run}`, pageSize: 100 });
      expect(all.total).toBe(22);
      expect(new Set(all.items.map((r) => r.id)).size).toBe(22);
      expect(all.totals.net).toBe(levels._sum.quantity);
    });
  });
});
