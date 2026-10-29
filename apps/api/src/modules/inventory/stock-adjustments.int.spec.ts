/**
 * Integration test of the manual adjustment document (HU-INV-22) against the real Postgres (DATABASE_URL): the document,
 * its lines, the movements, the audit entry and the outbox events are written together, a manual adjustment is applied
 * and approved on creation whatever its value, and parallel adjustments never leave negative stock or a repeated number.
 */
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import type { CreateAdjustmentDto } from './stock-adjustments.dto';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import { StockAdjustmentService } from './stock-adjustment.service';
import { StockAdjustmentsService } from './stock-adjustments.service';
import { StockMovementService } from './stock-movement.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
let currentMembership: string | null = null;
let currentUser: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;
const cls = {
  get: (k: string) => (k === 'companyId' ? current : k === 'membershipId' ? currentMembership : k === 'userId' ? currentUser : null),
} as never;

const FULL = ['inventory.adjustments.create', 'inventory.costs.view'];
let granted = new Set<string>(FULL);
let restrictedMembershipId = '';
let restrictedBranchId = '';
const membership = {
  permissions: async () => granted,
  operableBranchIds: async (id: string) => (id === restrictedMembershipId ? [restrictedBranchId] : null),
} as never;

const settings = new SettingsService(prisma);
const movements = new StockMovementService(cls, settings);
const audit = new AuditService(prisma, cls);
const outbox = new OutboxService(prisma, cls);
const service = new StockAdjustmentsService(prisma, cls, movements, audit, outbox, membership);
const quick = new StockAdjustmentService(prisma, cls, movements, settings, audit, outbox);

/** The immutability trigger blocks DELETE on stock_movements; test cleanup bypasses it inside its own transaction. */
async function purgeMovements(companyIds: string[]) {
  await base.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.stockMovement.deleteMany({ where: { companyId: { in: companyIds } } });
  });
}

/** The error code of a rejected call, or null when it succeeds. */
async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (err) {
    return (err as { getResponse(): { code: string } }).getResponse().code;
  }
}

describe('StockAdjustmentsService (integration, real Postgres)', () => {
  let companyId: string;
  let otherCompanyId: string;
  let warehouseId: string;
  let otherBranchWarehouseId: string;
  let brandId: string;
  let categoryId: string;
  let userId: string;
  let membershipId: string;
  let seq = 0;

  const create = (lines: CreateAdjustmentDto['lines'], extra: Partial<CreateAdjustmentDto> = {}) =>
    service.create({ warehouseId, reason: 'SHRINKAGE', lines, ...extra });

  /** A product with a known stock in the main warehouse, created through the same service path as real stock. */
  async function productWithStock(stock: number, cost: string | null = '5.0000') {
    seq += 1;
    const product = await base.product.create({
      data: { companyId, sku: `MA-${run}-${seq}`, manufacturerCode: `MA-${run}-${seq}`, brandId, categoryId, name: `Manual test ${seq}`, salePrice: '10.00', cost },
    });
    if (stock > 0) {
      await base.tenant.$transaction((tx) =>
        movements.apply(tx, { productId: product.id, warehouseId, type: 'INITIAL', quantity: stock, reason: 'Initial load' }),
      );
    }
    return product.id;
  }

  const levelOf = async (productId: string) => (await base.stockLevel.findFirst({ where: { productId, warehouseId } }))?.quantity ?? 0;

  /** A refused adjustment leaves no document, movement, audit entry or outbox event for the product. */
  async function expectNothingWritten(productId: string) {
    expect(await base.stockAdjustmentItem.count({ where: { productId } })).toBe(0);
    expect(await base.stockMovement.count({ where: { productId, type: { in: ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] } } })).toBe(0);
    expect(await base.outboxEvent.count({ where: { companyId, type: 'inventory.stock.changed', payload: { path: ['productId'], equals: productId } } })).toBe(0);
  }

  const setThreshold = (value: string | null) =>
    value === null
      ? base.companySetting.deleteMany({ where: { companyId, key: 'adjustments.approvalThresholdValue' } })
      : base.companySetting.upsert({
          where: { companyId_key: { companyId, key: 'adjustments.approvalThresholdValue' } },
          create: { companyId, key: 'adjustments.approvalThresholdValue', value },
          update: { value },
        });

  beforeAll(async () => {
    const company = await base.company.create({ data: { slug: `man-${run}`, legalName: 'man', tradeName: 'man', nit: `M${run}`.slice(0, 20) } });
    const other = await base.company.create({ data: { slug: `man2-${run}`, legalName: 'man2', tradeName: 'man2', nit: `N${run}`.slice(0, 20) } });
    companyId = company.id;
    otherCompanyId = other.id;
    current = companyId;
    const branch = await base.branch.create({ data: { companyId, code: 0, name: 'B0' } });
    const branch2 = await base.branch.create({ data: { companyId, code: 1, name: 'B1' } });
    restrictedBranchId = branch.id;
    warehouseId = (await base.warehouse.create({ data: { companyId, branchId: branch.id, code: `A-${run}`, name: 'W', isMain: true } })).id;
    otherBranchWarehouseId = (await base.warehouse.create({ data: { companyId, branchId: branch2.id, code: `B-${run}`, name: 'W2' } })).id;
    const country = await base.country.create({ data: { companyId, code: 'SE', name: 'Suecia' } });
    brandId = (await base.brand.create({ data: { companyId, name: `Marca ${run}`, countryId: country.id } })).id;
    categoryId = (await base.category.create({ data: { companyId, name: `Cat ${run}` } })).id;

    const role = await base.role.create({ data: { companyId, key: 'warehouse', name: 'Almacén' } });
    userId = (await base.user.create({ data: { email: `man-${run}@example.com`, name: 'Adjuster' } })).id;
    const user2 = await base.user.create({ data: { email: `man2-${run}@example.com`, name: 'Restricted' } });
    membershipId = (await base.membership.create({ data: { companyId, userId, roleId: role.id, allBranches: true } })).id;
    restrictedMembershipId = (
      await base.membership.create({ data: { companyId, userId: user2.id, roleId: role.id, branches: { create: { branchId: branch.id } } } })
    ).id;
    currentMembership = membershipId;
    currentUser = userId;
  });

  beforeEach(() => {
    granted = new Set(FULL);
    currentMembership = membershipId;
    current = companyId;
  });

  afterAll(async () => {
    await purgeMovements([companyId, otherCompanyId]);
    await base.outboxEvent.deleteMany({ where: { companyId } });
    await base.auditLog.deleteMany({ where: { companyId } });
    await base.companySetting.deleteMany({ where: { companyId } });
    await base.stockAdjustmentItem.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await base.stockAdjustment.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await base.stockLevel.deleteMany({ where: { companyId } });
    await base.product.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await base.membership.deleteMany({ where: { companyId } });
    await base.user.deleteMany({ where: { email: { in: [`man-${run}@example.com`, `man2-${run}@example.com`] } } });
    await base.role.deleteMany({ where: { companyId } });
    await base.category.deleteMany({ where: { companyId } });
    await base.brand.deleteMany({ where: { companyId } });
    await base.warehouse.deleteMany({ where: { companyId } });
    await base.branch.deleteMany({ where: { companyId } });
    await base.country.deleteMany({ where: { companyId } });
    await base.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await base.$disconnect();
  });

  describe('create', () => {
    it('applies a 3-line adjustment (IN, OUT, COUNT) on creation: approved by nobody, one movement per line', async () => {
      const [a, b, c] = [await productWithStock(10), await productWithStock(10), await productWithStock(10)];
      const result = await create(
        [
          { productId: a, kind: 'IN', quantity: 4 },
          { productId: b, kind: 'OUT', quantity: 3 },
          { productId: c, kind: 'COUNT', quantity: 6 },
        ],
        { reason: 'COUNT_ERROR' },
      );

      expect(result).toMatchObject({ status: 'APPROVED', movements: 3, totalValue: '55.00' });
      expect(result.number).toMatch(/^AJ-\d{6}$/);
      expect(await levelOf(a)).toBe(14);
      expect(await levelOf(b)).toBe(7);
      expect(await levelOf(c)).toBe(6);

      const doc = await base.stockAdjustment.findUniqueOrThrow({ where: { id: result.id }, include: { items: true } });
      expect(doc).toMatchObject({ status: 'APPROVED', source: 'MANUAL', reason: 'COUNT_ERROR', approvedById: null, createdById: userId, number: result.number });
      expect(doc.approvedAt).not.toBeNull();
      expect(doc.totalValue.toFixed(2)).toBe('55.00');
      const itemOf = (id: string) => doc.items.find((i) => i.productId === id);
      expect(itemOf(a)).toMatchObject({ kind: 'IN', quantity: 4, enteredQuantity: 4 });
      expect(itemOf(b)).toMatchObject({ kind: 'OUT', quantity: -3, enteredQuantity: 3 });
      expect(itemOf(c)).toMatchObject({ kind: 'COUNT', quantity: -4, enteredQuantity: 6 });

      const rows = await base.stockMovement.findMany({ where: { companyId, refId: result.id } });
      expect(rows).toHaveLength(3);
      expect(rows.every((m) => m.refType === 'ADJUSTMENT' && m.refNumber === result.number)).toBe(true);
      expect(rows.find((m) => m.productId === a)).toMatchObject({ type: 'ADJUSTMENT_IN', quantity: 4 });
      expect(rows.find((m) => m.productId === b)).toMatchObject({ type: 'ADJUSTMENT_OUT', quantity: -3 });
      expect(rows.find((m) => m.productId === c)).toMatchObject({ type: 'ADJUSTMENT_OUT', quantity: -4 });

      expect(await base.auditLog.count({ where: { companyId, action: 'inventory.adjustment.create', entityId: result.id } })).toBe(1);
      expect(await base.outboxEvent.count({ where: { companyId, type: 'inventory.stock.changed', payload: { path: ['productId'], equals: a } } })).toBe(1);
    });

    it('stores the reason code and the note, and writes the label on the movement', async () => {
      const p = await productWithStock(5);
      const result = await create([{ productId: p, kind: 'OUT', quantity: 1 }], { reason: 'OTHER', note: ' broken in transit ' });
      expect(await base.stockAdjustment.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({ reason: 'OTHER', note: 'broken in transit' });
      expect((await base.stockMovement.findFirstOrThrow({ where: { refId: result.id } })).reason).toBe('Otro: broken in transit');
    });

    it('applies it at once whatever its value: there is no approval threshold', async () => {
      await setThreshold('1.00');
      try {
        const p = await productWithStock(100, '50.0000');
        const result = await create([{ productId: p, kind: 'OUT', quantity: 90 }]);
        expect(result).toMatchObject({ status: 'APPROVED', totalValue: '4500.00' });
        expect(await levelOf(p)).toBe(10);
      } finally {
        await setThreshold(null);
      }
    });

    it('moves nothing for a count equal to the stock when another line changes it', async () => {
      const [same, other] = [await productWithStock(5), await productWithStock(5)];
      const result = await create([
        { productId: same, kind: 'COUNT', quantity: 5 },
        { productId: other, kind: 'IN', quantity: 2 },
      ]);
      expect(result.movements).toBe(1);
      expect(await base.stockMovement.count({ where: { productId: same, type: 'ADJUSTMENT_IN' } })).toBe(0);
      expect(await base.stockAdjustmentItem.findFirstOrThrow({ where: { adjustmentId: result.id, productId: same } })).toMatchObject({ quantity: 0, enteredQuantity: 5 });
    });

    it('refuses an adjustment where nothing changes, and writes nothing', async () => {
      const p = await productWithStock(5);
      expect(await codeOf(create([{ productId: p, kind: 'COUNT', quantity: 5 }]))).toBe('NO_STOCK_CHANGE');
      await expectNothingWritten(p);
    });

    it('validates the reason, the note, the lines and the quantities before touching anything', async () => {
      const p = await productWithStock(5);
      const line = { productId: p, kind: 'IN' as const, quantity: 1 };
      expect(await codeOf(create([line], { reason: undefined }))).toBe('REASON_REQUIRED');
      expect(await codeOf(create([line], { reason: 'OTHER' }))).toBe('REASON_NOTE_REQUIRED');
      expect(await codeOf(create([line], { reason: 'OTHER', note: '   ' }))).toBe('REASON_NOTE_REQUIRED');
      expect(await codeOf(create([]))).toBe('ADJUSTMENT_EMPTY');
      expect(await codeOf(create([line, { ...line, kind: 'OUT' }]))).toBe('DUPLICATE_LINE');
      expect(await codeOf(create([{ ...line, quantity: 0 }]))).toBe('VALIDATION_FAILED');
      await expectNothingWritten(p);
    });

    it('refuses to take more than the warehouse holds and rolls the whole document back', async () => {
      const [ok, short] = [await productWithStock(5), await productWithStock(2)];
      const before = await base.stockAdjustment.count({ where: { companyId } });
      expect(
        await codeOf(
          create([
            { productId: ok, kind: 'IN', quantity: 3 },
            { productId: short, kind: 'OUT', quantity: 3 },
          ]),
        ),
      ).toBe('INSUFFICIENT_STOCK');
      expect(await levelOf(ok)).toBe(5);
      expect(await levelOf(short)).toBe(2);
      expect(await base.stockAdjustment.count({ where: { companyId } })).toBe(before);
      await expectNothingWritten(ok);
    });

    it('refuses an inactive warehouse and writes nothing, not even the audit entry', async () => {
      const p = await productWithStock(5);
      await base.warehouse.update({ where: { id: otherBranchWarehouseId }, data: { status: 'INACTIVE' } });
      try {
        const audits = await base.auditLog.count({ where: { companyId, action: 'inventory.adjustment.create' } });
        expect(await codeOf(service.create({ warehouseId: otherBranchWarehouseId, reason: 'DAMAGE', lines: [{ productId: p, kind: 'IN', quantity: 1 }] }))).toBe(
          'WAREHOUSE_INACTIVE',
        );
        await expectNothingWritten(p);
        expect(await base.auditLog.count({ where: { companyId, action: 'inventory.adjustment.create' } })).toBe(audits);
      } finally {
        await base.warehouse.update({ where: { id: otherBranchWarehouseId }, data: { status: 'ACTIVE' } });
      }
    });

    it('checks expectedBalance on a count line, and treats a missing level as 0', async () => {
      const [counted, empty] = [await productWithStock(5), await productWithStock(0)];
      expect(await codeOf(create([{ productId: counted, kind: 'COUNT', quantity: 2, expectedBalance: 4 }]))).toBe('STOCK_CHANGED');
      const result = await create([
        { productId: counted, kind: 'COUNT', quantity: 2, expectedBalance: 5 },
        { productId: empty, kind: 'IN', quantity: 1, expectedBalance: 0 },
      ]);
      expect(result.movements).toBe(2);
      expect(await levelOf(counted)).toBe(2);
    });

    it('answers STOCK_CHANGED when a line was read at another balance, and writes nothing', async () => {
      const p = await productWithStock(5);
      const err = await create([{ productId: p, kind: 'OUT', quantity: 1, expectedBalance: 9 }]).catch((e: { getResponse(): { code: string; details: { currentBalance: number } } }) => e.getResponse());
      expect(err).toMatchObject({ code: 'STOCK_CHANGED', details: { productId: p, currentBalance: 5 } });
      await expectNothingWritten(p);
    });

    it('does not find a warehouse of another branch for a member who cannot operate it', async () => {
      const p = await productWithStock(5);
      currentMembership = restrictedMembershipId;
      expect(await codeOf(service.create({ warehouseId: otherBranchWarehouseId, reason: 'DAMAGE', lines: [{ productId: p, kind: 'IN', quantity: 1 }] }))).toBe('WAREHOUSE_NOT_FOUND');
      expect(await codeOf(service.create({ warehouseId: randomUUID(), reason: 'DAMAGE', lines: [{ productId: p, kind: 'IN', quantity: 1 }] }))).toBe('WAREHOUSE_NOT_FOUND');
      expect(await create([{ productId: p, kind: 'IN', quantity: 1 }])).toMatchObject({ status: 'APPROVED' });
    });

    it('does not find a product of another company', async () => {
      const foreign = await base.product.create({
        data: { companyId: otherCompanyId, sku: `FOR-${run}`, manufacturerCode: `FOR-${run}`, brandId, categoryId, name: 'Foreign', salePrice: '1.00' },
      });
      expect(await codeOf(create([{ productId: foreign.id, kind: 'IN', quantity: 1 }]))).toBe('PRODUCT_NOT_FOUND');
      expect(await codeOf(create([{ productId: randomUUID(), kind: 'IN', quantity: 1 }]))).toBe('PRODUCT_NOT_FOUND');
    });

    it('is forbidden without inventory.adjustments.create', async () => {
      const p = await productWithStock(5);
      granted = new Set(['inventory.adjustments.approve']);
      expect(await codeOf(create([{ productId: p, kind: 'IN', quantity: 1 }]))).toBe('NO_PERMISSION');
      await expectNothingWritten(p);
    });

    it('hides the value from a member without inventory.costs.view', async () => {
      const p = await productWithStock(5);
      granted = new Set(['inventory.adjustments.create']);
      const result = await create([{ productId: p, kind: 'IN', quantity: 1 }]);
      expect(result.totalValue).toBeNull();
    });

    it('counts a product without cost as worth 0', async () => {
      const p = await productWithStock(5, null);
      const result = await create([{ productId: p, kind: 'IN', quantity: 2 }]);
      expect(result.totalValue).toBe('0.00');
      expect(await base.stockAdjustmentItem.findFirstOrThrow({ where: { adjustmentId: result.id } })).toMatchObject({ unitCost: null });
    });
  });

  describe('concurrency', () => {
    it('serializes two adjustments taking out the same last pieces: one wins, none goes negative', async () => {
      const p = await productWithStock(3);
      const results = await Promise.allSettled([
        create([{ productId: p, kind: 'OUT', quantity: 3 }]),
        create([{ productId: p, kind: 'OUT', quantity: 3 }]),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((rejected.reason as { getResponse(): { code: string } }).getResponse().code).toBe('INSUFFICIENT_STOCK');
      expect(await levelOf(p)).toBe(0);
    });

    it('numbers a quick adjustment and document adjustments in parallel without repeating a number', async () => {
      const p = await productWithStock(50);
      const docs = await Promise.all(Array.from({ length: 4 }, () => create([{ productId: p, kind: 'IN', quantity: 1 }])));
      const quicks = await Promise.all(Array.from({ length: 4 }, () => quick.quickAdjust(p, { warehouseId, kind: 'IN', quantity: 1, reason: 'SHRINKAGE' })));
      const mixed = await Promise.all([
        create([{ productId: p, kind: 'IN', quantity: 1 }]),
        quick.quickAdjust(p, { warehouseId, kind: 'IN', quantity: 1, reason: 'SHRINKAGE' }),
        create([{ productId: p, kind: 'IN', quantity: 1 }]),
        quick.quickAdjust(p, { warehouseId, kind: 'IN', quantity: 1, reason: 'SHRINKAGE' }),
      ]);
      const numbers = [...docs.map((d) => d.number), ...quicks.map((q) => q.refNumber), ...mixed.map((m) => ('number' in m ? m.number : m.refNumber))];
      expect(new Set(numbers).size).toBe(numbers.length);
      const sequence = numbers.map((n) => Number(n.slice(3))).sort((x, y) => x - y);
      expect(sequence[sequence.length - 1] - sequence[0]).toBe(numbers.length - 1);
    });

    it('keeps the kardex equal to the level when many mixed adjustments run in parallel', async () => {
      const p = await productWithStock(20);
      const q = await productWithStock(20);
      await Promise.allSettled([
        ...Array.from({ length: 6 }, (_, i) =>
          create([
            { productId: p, kind: i % 2 ? 'IN' : 'OUT', quantity: 3 },
            { productId: q, kind: i % 2 ? 'OUT' : 'IN', quantity: 2 },
          ]),
        ),
        create([
          { productId: q, kind: 'COUNT', quantity: 15 },
          { productId: p, kind: 'IN', quantity: 1 },
        ]),
      ]);
      for (const id of [p, q]) {
        const sum = await base.stockMovement.aggregate({ where: { productId: id, warehouseId }, _sum: { quantity: true } });
        expect(sum._sum.quantity).toBe(await levelOf(id));
        expect(await levelOf(id)).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('list and detail', () => {
    let aId: string;
    let bId: string;
    let transferDifferenceId: string;
    let productCode: string;

    beforeAll(async () => {
      current = companyId;
      const p = await productWithStock(10);
      productCode = (await base.product.findUniqueOrThrow({ where: { id: p } })).manufacturerCode;
      const first = await create([{ productId: p, kind: 'OUT', quantity: 2 }], { reason: 'DAMAGE' });
      aId = first.id;
      // a second warehouse's adjustment, backdated, to filter by warehouse and by date
      const q = await productWithStock(0);
      await base.tenant.$transaction((tx) =>
        movements.apply(tx, { productId: q, warehouseId: otherBranchWarehouseId, type: 'INITIAL', quantity: 4, reason: 'Initial load' }),
      );
      const second = await service.create({ warehouseId: otherBranchWarehouseId, reason: 'SHRINKAGE', lines: [{ productId: q, kind: 'OUT', quantity: 1 }] });
      bId = second.id;
      await base.stockAdjustment.update({ where: { id: bId }, data: { createdAt: new Date('2026-01-15T16:00:00Z') } });
      const diff = await base.stockAdjustment.create({
        data: { companyId, number: 'AJ-900001', status: 'PENDING_APPROVAL', source: 'TRANSFER', warehouseId, reason: 'Diferencia en transferencia', totalValue: '10.00' },
      });
      transferDifferenceId = diff.id;
      await base.stockAdjustment.create({
        data: { companyId: otherCompanyId, number: 'AJ-900002', status: 'APPROVED', source: 'MANUAL', warehouseId, reason: 'DAMAGE', totalValue: '1.00' },
      });
    });

    it('lists manual and transfer-difference adjustments, newest first, with the reason label and the value', async () => {
      const page = await service.list({});
      const ids = page.items.map((i) => i.id);
      expect(ids).toEqual(expect.arrayContaining([aId, bId, transferDifferenceId]));
      expect(page.total).toBeGreaterThanOrEqual(3);
      const a = page.items.find((i) => i.id === aId);
      expect(a).toMatchObject({ reason: 'Daño', lines: 1, value: '10.00', status: 'APPROVED', source: 'MANUAL', createdBy: 'Adjuster' });
      expect(page.items.find((i) => i.id === transferDifferenceId)).toMatchObject({ status: 'PENDING_APPROVAL', reason: 'Diferencia en transferencia' });
      const times = page.items.map((i) => i.createdAt);
      expect([...times].sort().reverse()).toEqual(times);
    });

    it('filters by status, warehouse, reason, date range and search, and paginates', async () => {
      expect((await service.list({ status: 'PENDING_APPROVAL' })).items.map((i) => i.id)).toEqual([transferDifferenceId]);
      expect((await service.list({ warehouseId: otherBranchWarehouseId })).items.map((i) => i.id)).toEqual([bId]);
      expect((await service.list({ reason: 'DAMAGE' })).items.map((i) => i.id)).toEqual([aId]);
      expect((await service.list({ from: '2026-01-15', to: '2026-01-15' })).items.map((i) => i.id)).toEqual([bId]);
      expect((await service.list({ from: '2026-01-16', to: '2026-01-16' })).items).toHaveLength(0);
      expect((await service.list({ q: productCode })).items.map((i) => i.id)).toEqual([aId]);
      const a = await service.get(aId);
      expect((await service.list({ q: a.number.toLowerCase() })).items.map((i) => i.id)).toEqual([aId]);
      const first = await service.list({ pageSize: 1 });
      const second = await service.list({ pageSize: 1, page: 2 });
      expect(first.items).toHaveLength(1);
      expect(second.items[0].id).not.toBe(first.items[0].id);
      expect(first.pageSize).toBe(1);
      expect(await codeOf(service.list({ from: '2026-02-01', to: '2026-01-01' }))).toBe('INVALID_FILTER');
    });

    it('limits the list to the branches the member operates', async () => {
      currentMembership = restrictedMembershipId;
      const ids = (await service.list({})).items.map((i) => i.id);
      expect(ids).toContain(aId);
      expect(ids).not.toContain(bId);
      expect(await codeOf(service.get(bId))).toBe('ADJUSTMENT_NOT_FOUND');
    });

    it('isolates tenants: another company sees none of these and cannot open them', async () => {
      current = otherCompanyId;
      expect((await service.list({})).items.map((i) => i.id)).not.toContain(aId);
      expect(await codeOf(service.get(aId))).toBe('ADJUSTMENT_NOT_FOUND');
    });

    it('is open to those who create or approve, and forbidden to everyone else', async () => {
      granted = new Set(['inventory.adjustments.approve']);
      expect((await service.list({})).total).toBeGreaterThan(0);
      granted = new Set(['inventory.products.view']);
      expect(await codeOf(service.list({}))).toBe('NO_PERMISSION');
      expect(await codeOf(service.get(aId))).toBe('NO_PERMISSION');
    });

    it('hides values and costs without inventory.costs.view', async () => {
      granted = new Set(['inventory.adjustments.create']);
      expect((await service.list({})).items.every((i) => i.value === null)).toBe(true);
      const detail = await service.get(aId);
      expect(detail.items.every((i) => i.unitCost === null && i.value === null)).toBe(true);
    });

    it('opens the detail with the header, the note and the lines', async () => {
      const detail = await service.get(aId);
      expect(detail).toMatchObject({ id: aId, status: 'APPROVED', reason: 'Daño', approvedBy: null, note: null, value: '10.00' });
      expect(detail.items).toEqual([
        expect.objectContaining({ manufacturerCode: productCode, kind: 'OUT', enteredQuantity: 2, delta: -2, unitCost: '5.0000', value: '10.00', brand: expect.any(String) }),
      ]);
      expect(await codeOf(service.get(randomUUID()))).toBe('ADJUSTMENT_NOT_FOUND');
    });
  });

  describe('productSearch', () => {
    it('finds active products by code or name with the stock of the warehouse, the exact code first', async () => {
      const p = await productWithStock(7);
      const code = (await base.product.findUniqueOrThrow({ where: { id: p } })).manufacturerCode;
      const found = await service.productSearch({ warehouseId, q: code });
      expect(found.items[0]).toMatchObject({ id: p, available: 7, unitCost: '5.0000' });
      expect((await service.productSearch({ warehouseId, q: '   ' })).items).toEqual([]);
    });

    it('needs the permission and a warehouse the member can see', async () => {
      granted = new Set(['inventory.adjustments.approve']);
      expect(await codeOf(service.productSearch({ warehouseId, q: 'x' }))).toBe('NO_PERMISSION');
      granted = new Set(FULL);
      currentMembership = restrictedMembershipId;
      expect(await codeOf(service.productSearch({ warehouseId: otherBranchWarehouseId, q: 'x' }))).toBe('WAREHOUSE_NOT_FOUND');
    });
  });

  describe('resolveLines', () => {
    const codeOfProduct = async (id: string) => (await base.product.findUniqueOrThrow({ where: { id } })).manufacturerCode;

    it('classifies a pasted list with kinds before anything is added, and writes nothing', async () => {
      const ok = await productWithStock(10);
      const low = await productWithStock(1);
      const counted = await productWithStock(4);
      const off = await productWithStock(10);
      await base.product.update({ where: { id: off }, data: { status: 'INACTIVE' } });
      const text = [
        `${await codeOfProduct(ok)}, 3`,
        `${await codeOfProduct(low)}\t5`,
        `${await codeOfProduct(counted)};9;Conteo`,
        `${await codeOfProduct(off)}, 1, Entrada`,
        'NOPE-123,2',
        'bad line',
      ].join('\n');

      const result = await service.resolveLines({ warehouseId, text }, undefined);
      expect(result.counts).toEqual({ RECOGNIZED: 2, INSUFFICIENT_STOCK: 1, INACTIVE: 1, NOT_FOUND: 1 });
      expect(result.errors).toEqual([expect.objectContaining({ line: 6, reason: 'MISSING_QUANTITY' })]);
      expect(result.lines.find((l) => l.group === 'INSUFFICIENT_STOCK')).toMatchObject({ kind: 'OUT', available: 1 });
      expect(result.lines.find((l) => l.kind === 'COUNT')).toMatchObject({ group: 'RECOGNIZED', quantity: 9, available: 4, unitCost: '5.0000' });
      expect(result.lines.find((l) => l.group === 'NOT_FOUND')?.product).toBeNull();
      // only an outward line is checked against the stock: an entry or a count may go past it
      expect(await levelOf(ok)).toBe(10);
      await expectNothingWritten(ok);
    });

    it('turns the manufacturer code and the SKU of one product into one line and reports the second', async () => {
      const id = await productWithStock(5);
      const p = await base.product.findUniqueOrThrow({ where: { id } });
      await base.product.update({ where: { id }, data: { sku: `SKU-${p.manufacturerCode}` } });
      const result = await service.resolveLines({ warehouseId, text: `${p.manufacturerCode}, 3\nSKU-${p.manufacturerCode}, 1` }, undefined);
      expect(result.lines).toHaveLength(1);
      expect(result.errors).toEqual([expect.objectContaining({ line: 2, reason: 'DUPLICATE_CODE' })]);
    });

    it('hides the cost without inventory.costs.view', async () => {
      const id = await productWithStock(5);
      granted = new Set(['inventory.adjustments.create']);
      const result = await service.resolveLines({ warehouseId, text: `${await codeOfProduct(id)}, 1` }, undefined);
      expect(result.lines[0].unitCost).toBeNull();
    });

    it('reads an uploaded .xlsx with the optional kind column, and a .csv, and refuses other files', async () => {
      const a = await productWithStock(10);
      const b = await productWithStock(10);
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Lista');
      sheet.addRow(['Código', 'Cantidad', 'Tipo']);
      sheet.addRow([await codeOfProduct(a), 4]);
      sheet.addRow([await codeOfProduct(b), 12, 'Entrada']);
      const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());

      const fromXlsx = await service.resolveLines({ warehouseId }, { buffer: xlsx, size: xlsx.length, originalname: 'lista.xlsx' });
      expect(fromXlsx.lines.map((l) => [l.quantity, l.kind, l.group])).toEqual([
        [4, 'OUT', 'RECOGNIZED'],
        [12, 'IN', 'RECOGNIZED'],
      ]);

      const csv = Buffer.from(`code,quantity\r\n${await codeOfProduct(a)},2\r\n`);
      const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv]);
      const fromBom = await service.resolveLines({ warehouseId }, { buffer: withBom, size: withBom.length, originalname: 'excel.csv' });
      expect(fromBom.lines).toEqual([expect.objectContaining({ group: 'RECOGNIZED', quantity: 2 })]);

      const binary = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]);
      expect(await codeOf(service.resolveLines({ warehouseId }, { buffer: binary, size: binary.length, originalname: 'x.pdf' }))).toBe('FILE_INVALID');
      const huge = Buffer.alloc(1024 * 1024 + 1, 'a');
      expect(await codeOf(service.resolveLines({ warehouseId }, { buffer: huge, size: huge.length, originalname: 'x.csv' }))).toBe('FILE_TOO_LARGE');
      expect(await codeOf(service.resolveLines({ warehouseId }, undefined))).toBe('VALIDATION_FAILED');
    });

    it('refuses a list longer than an adjustment can carry', async () => {
      const text = Array.from({ length: 201 }, (_, i) => `CODE-${i}, 1`).join('\n');
      expect(await codeOf(service.resolveLines({ warehouseId, text }, undefined))).toBe('TOO_MANY_LINES');
    });

    it('needs the permission and a warehouse the member can see', async () => {
      granted = new Set(['inventory.adjustments.approve']);
      expect(await codeOf(service.resolveLines({ warehouseId, text: 'A, 1' }, undefined))).toBe('NO_PERMISSION');
      granted = new Set(FULL);
      currentMembership = restrictedMembershipId;
      expect(await codeOf(service.resolveLines({ warehouseId: otherBranchWarehouseId, text: 'A, 1' }, undefined))).toBe('WAREHOUSE_NOT_FOUND');
    });
  });
});
