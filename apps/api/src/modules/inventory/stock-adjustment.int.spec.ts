/**
 * Integration test of the quick stock adjustment (HU-INV-16) against the real Postgres (DATABASE_URL): the movement,
 * level, audit entry and outbox event are written together, and parallel adjustments never leave negative stock.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { QuickAdjustmentInput } from '@rodasoft/domain';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import { StockAdjustmentService } from './stock-adjustment.service';
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
const settings = new SettingsService(prisma);
const service = new StockAdjustmentService(
  prisma,
  cls,
  new StockMovementService(cls, settings),
  settings,
  new AuditService(prisma, cls),
  new OutboxService(prisma, cls),
);

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

describe('StockAdjustmentService.quickAdjust (integration, real Postgres)', () => {
  let companyId: string;
  let otherCompanyId: string;
  let warehouseId: string;
  let otherBranchWarehouseId: string;
  let brandId: string;
  let categoryId: string;
  let userId: string;
  let membershipId: string;
  let restrictedMembershipId: string;
  let seq = 0;

  const adjust = (productId: string, input: Partial<QuickAdjustmentInput> & Pick<QuickAdjustmentInput, 'kind' | 'quantity'>) =>
    service.quickAdjust(productId, { warehouseId, reason: 'SHRINKAGE', ...input });

  /** A product with a known stock in the main warehouse, created through the same service path as real stock. */
  async function productWithStock(stock: number, cost: string | null = '5.0000') {
    seq += 1;
    const product = await base.product.create({
      data: { companyId, sku: `ADJ-${run}-${seq}`, manufacturerCode: `ADJ-${run}-${seq}`, brandId, categoryId, name: 'Adjust test', salePrice: '10.00', cost },
    });
    if (stock > 0) {
      await base.tenant.$transaction((tx) =>
        new StockMovementService(cls, settings).apply(tx, {
          productId: product.id,
          warehouseId,
          type: 'INITIAL',
          quantity: stock,
          reason: 'Initial load',
        }),
      );
    }
    return product.id;
  }

  /** A refused adjustment leaves no movement, audit entry or outbox event behind. */
  async function expectNothingWritten(productId: string) {
    expect(await base.stockMovement.count({ where: { productId, type: { in: ['ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] } } })).toBe(0);
    expect(await base.auditLog.count({ where: { companyId, action: 'inventory.stock.adjust', after: { path: ['productId'], equals: productId } } })).toBe(0);
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
    const company = await base.company.create({ data: { slug: `adj-${run}`, legalName: 'adj', tradeName: 'adj', nit: `A${run}`.slice(0, 20) } });
    const other = await base.company.create({ data: { slug: `adj2-${run}`, legalName: 'adj2', tradeName: 'adj2', nit: `B${run}`.slice(0, 20) } });
    companyId = company.id;
    otherCompanyId = other.id;
    current = companyId;
    const branch = await base.branch.create({ data: { companyId, code: 0, name: 'B0' } });
    const branch2 = await base.branch.create({ data: { companyId, code: 1, name: 'B1' } });
    warehouseId = (await base.warehouse.create({ data: { companyId, branchId: branch.id, code: `A-${run}`, name: 'W', isMain: true } })).id;
    otherBranchWarehouseId = (await base.warehouse.create({ data: { companyId, branchId: branch2.id, code: `B-${run}`, name: 'W2' } })).id;
    const country = await base.country.create({ data: { companyId, code: 'SE', name: 'Suecia' } });
    brandId = (await base.brand.create({ data: { companyId, name: `Marca ${run}`, countryId: country.id } })).id;
    categoryId = (await base.category.create({ data: { companyId, name: `Cat ${run}` } })).id;

    const role = await base.role.create({ data: { companyId, key: 'warehouse', name: 'Almacén' } });
    userId = (await base.user.create({ data: { email: `adj-${run}@example.com`, name: 'Adjuster' } })).id;
    const user2 = await base.user.create({ data: { email: `adj2-${run}@example.com`, name: 'Restricted' } });
    membershipId = (await base.membership.create({ data: { companyId, userId, roleId: role.id, allBranches: true } })).id;
    restrictedMembershipId = (
      await base.membership.create({ data: { companyId, userId: user2.id, roleId: role.id, branches: { create: { branchId: branch.id } } } })
    ).id;
    currentMembership = membershipId;
    currentUser = userId;
  });

  afterAll(async () => {
    await purgeMovements([companyId, otherCompanyId]);
    await base.outboxEvent.deleteMany({ where: { companyId } });
    await base.auditLog.deleteMany({ where: { companyId } });
    await base.companySetting.deleteMany({ where: { companyId } });
    await base.stockLevel.deleteMany({ where: { companyId } });
    await base.product.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await base.membership.deleteMany({ where: { companyId } });
    await base.user.deleteMany({ where: { email: { in: [`adj-${run}@example.com`, `adj2-${run}@example.com`] } } });
    await base.role.deleteMany({ where: { companyId } });
    await base.category.deleteMany({ where: { companyId } });
    await base.brand.deleteMany({ where: { companyId } });
    await base.warehouse.deleteMany({ where: { companyId } });
    await base.branch.deleteMany({ where: { companyId } });
    await base.country.deleteMany({ where: { companyId } });
    await base.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await base.$disconnect();
  });

  it('records an outward adjustment in the kardex, the level, the audit log and the outbox', async () => {
    const productId = await productWithStock(12);
    const result = await adjust(productId, { kind: 'OUT', quantity: 2, reason: 'SHRINKAGE', note: 'caja mojada' });

    expect(result).toMatchObject({ balanceAfter: 10, totalStock: 10 });
    expect(result.refNumber).toMatch(/^AJ-\d{6}$/);

    const movement = await base.stockMovement.findFirstOrThrow({ where: { id: result.movementId } });
    expect(movement).toMatchObject({
      productId,
      warehouseId,
      type: 'ADJUSTMENT_OUT',
      quantity: -2,
      balanceAfter: 10,
      reason: 'Merma: caja mojada',
      refType: 'ADJUSTMENT',
      refNumber: result.refNumber,
      userId,
    });
    expect(await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } })).toMatchObject({ quantity: 10 });

    const audit = await base.auditLog.findFirstOrThrow({ where: { companyId, action: 'inventory.stock.adjust', entityId: result.movementId } });
    expect(audit).toMatchObject({ entity: 'StockMovement', userId });
    const event = await base.outboxEvent.findFirstOrThrow({ where: { companyId, type: 'inventory.stock.changed', idempotencyKey: `inventory.stock.changed:${result.movementId}` } });
    expect(event.payload).toMatchObject({ productId, warehouseId, quantity: -2, balanceAfter: 10 });
  });

  it('records an inward adjustment and sums the stock of every warehouse in totalStock', async () => {
    const productId = await productWithStock(4);
    await service.quickAdjust(productId, { warehouseId: otherBranchWarehouseId, kind: 'IN', quantity: 6, reason: 'COUNT_ERROR' });
    const result = await adjust(productId, { kind: 'IN', quantity: 1, reason: 'COUNT_ERROR' });

    expect(result).toMatchObject({ balanceAfter: 5, totalStock: 11 });
    const movement = await base.stockMovement.findFirstOrThrow({ where: { id: result.movementId } });
    expect(movement).toMatchObject({ type: 'ADJUSTMENT_IN', quantity: 1, reason: 'Error de conteo' });
  });

  it('keeps the level equal to the last balanceAfter of the kardex', async () => {
    const productId = await productWithStock(20);
    await adjust(productId, { kind: 'OUT', quantity: 5 });
    await adjust(productId, { kind: 'IN', quantity: 2, reason: 'DAMAGE' });
    const movements = await base.stockMovement.findMany({ where: { productId, warehouseId }, orderBy: [{ createdAt: 'asc' }] });
    const level = await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } });
    expect(movements.reduce((sum, m) => sum + m.quantity, 0)).toBe(level.quantity);
    expect(level.quantity).toBe(17);
  });

  it('corrects the stock to a counted quantity, down and up, recording the difference', async () => {
    const productId = await productWithStock(24);
    const down = await adjust(productId, { kind: 'COUNT', quantity: 21, reason: 'COUNT_ERROR' });
    expect(down).toMatchObject({ balanceAfter: 21 });
    expect(await base.stockMovement.findFirstOrThrow({ where: { id: down.movementId } })).toMatchObject({
      type: 'ADJUSTMENT_OUT',
      quantity: -3,
      balanceAfter: 21,
      reason: 'Error de conteo',
    });
    const up = await adjust(productId, { kind: 'COUNT', quantity: 30, reason: 'COUNT_ERROR', expectedBalance: 21 });
    expect(up).toMatchObject({ balanceAfter: 30 });
    expect(await base.stockMovement.findFirstOrThrow({ where: { id: up.movementId } })).toMatchObject({ type: 'ADJUSTMENT_IN', quantity: 9 });
  });

  it('counts down to zero, and refuses a count equal to the stock without writing anything', async () => {
    const productId = await productWithStock(4);
    expect(await codeOf(adjust(productId, { kind: 'COUNT', quantity: 4, reason: 'COUNT_ERROR' }))).toBe('NO_STOCK_CHANGE');
    await expectNothingWritten(productId);
    expect(await adjust(productId, { kind: 'COUNT', quantity: 0, reason: 'COUNT_ERROR' })).toMatchObject({ balanceAfter: 0 });
  });

  it('values a count by the pieces it moves when checking the approval limit', async () => {
    const productId = await productWithStock(100); // cost 5.0000
    await setThreshold('50.00');
    try {
      expect(await codeOf(adjust(productId, { kind: 'COUNT', quantity: 80, reason: 'COUNT_ERROR' }))).toBe('ADJUSTMENT_NEEDS_APPROVAL');
      expect(await adjust(productId, { kind: 'COUNT', quantity: 90, reason: 'COUNT_ERROR' })).toMatchObject({ balanceAfter: 90 });
    } finally {
      await setThreshold(null);
    }
  });

  it('rejects an IN or OUT without at least one piece', async () => {
    const productId = await productWithStock(4);
    expect(await codeOf(adjust(productId, { kind: 'OUT', quantity: 0 }))).toBe('VALIDATION_FAILED');
    expect(await codeOf(adjust(productId, { kind: 'IN', quantity: 0 }))).toBe('VALIDATION_FAILED');
  });

  it('validates the reason: it is required, and "Otro" needs a note', async () => {
    const productId = await productWithStock(5);
    expect(await codeOf(service.quickAdjust(productId, { warehouseId, kind: 'OUT', quantity: 1 } as never))).toBe('REASON_REQUIRED');
    expect(await codeOf(adjust(productId, { kind: 'OUT', quantity: 1, reason: 'OTHER' }))).toBe('REASON_NOTE_REQUIRED');
    expect(await codeOf(adjust(productId, { kind: 'OUT', quantity: 1, reason: 'OTHER', note: '  ' }))).toBe('REASON_NOTE_REQUIRED');
    expect(await base.stockMovement.count({ where: { productId, type: 'ADJUSTMENT_OUT' } })).toBe(0);
  });

  it('refuses to take more than the warehouse holds and writes nothing', async () => {
    const productId = await productWithStock(3);
    expect(await codeOf(adjust(productId, { kind: 'OUT', quantity: 4 }))).toBe('INSUFFICIENT_STOCK');
    expect(await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } })).toMatchObject({ quantity: 3 });
    expect(await base.stockMovement.count({ where: { productId, type: 'ADJUSTMENT_OUT' } })).toBe(0);
    expect(await base.auditLog.count({ where: { companyId, action: 'inventory.stock.adjust', after: { path: ['productId'], equals: productId } } })).toBe(0);
  });

  it('refuses an inactive warehouse, and a warehouse or product that does not exist', async () => {
    const productId = await productWithStock(3);
    const branch = await base.branch.findFirstOrThrow({ where: { companyId, code: 0 } });
    const closed = await base.warehouse.create({ data: { companyId, branchId: branch.id, code: `X-${run}`, name: 'Cerrado', status: 'INACTIVE' } });
    expect(await codeOf(adjust(productId, { kind: 'IN', quantity: 1, warehouseId: closed.id }))).toBe('WAREHOUSE_INACTIVE');
    expect(await codeOf(adjust(productId, { kind: 'IN', quantity: 1, warehouseId: randomUUID() }))).toBe('WAREHOUSE_NOT_FOUND');
    expect(await codeOf(adjust(randomUUID(), { kind: 'IN', quantity: 1 }))).toBe('PRODUCT_NOT_FOUND');
    await base.warehouse.delete({ where: { id: closed.id } });
  });

  it('answers STOCK_CHANGED, not INSUFFICIENT_STOCK, when a stale outward adjustment would also exceed the stock', async () => {
    const productId = await productWithStock(2);
    expect(await codeOf(adjust(productId, { kind: 'OUT', quantity: 5, expectedBalance: 10 }))).toBe('STOCK_CHANGED');
  });

  it('lets exactly one of two parallel adjustments with the same expected balance through', async () => {
    const productId = await productWithStock(10);
    const results = await Promise.allSettled([
      adjust(productId, { kind: 'OUT', quantity: 1, expectedBalance: 10 }),
      adjust(productId, { kind: 'OUT', quantity: 1, expectedBalance: 10 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect((rejected?.reason as { getResponse(): { code: string } }).getResponse().code).toBe('STOCK_CHANGED');
    expect(await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } })).toMatchObject({ quantity: 9 });
  });

  it('answers STOCK_CHANGED when the balance moved since it was read, and leaves the stock untouched', async () => {
    const productId = await productWithStock(10);
    expect(await codeOf(adjust(productId, { kind: 'OUT', quantity: 1, expectedBalance: 9 }))).toBe('STOCK_CHANGED');
    await expectNothingWritten(productId);
    expect(await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } })).toMatchObject({ quantity: 10 });
    expect(await adjust(productId, { kind: 'OUT', quantity: 1, expectedBalance: 10 })).toMatchObject({ balanceAfter: 9 });
  });

  it('does not let a member adjust a warehouse of a branch they cannot operate', async () => {
    const productId = await productWithStock(5);
    currentMembership = restrictedMembershipId;
    try {
      expect(await codeOf(service.quickAdjust(productId, { warehouseId: otherBranchWarehouseId, kind: 'IN', quantity: 1, reason: 'DAMAGE' }))).toBe('WAREHOUSE_NOT_FOUND');
      expect(await adjust(productId, { kind: 'IN', quantity: 1, reason: 'DAMAGE' })).toMatchObject({ balanceAfter: 6 });
    } finally {
      currentMembership = membershipId;
    }
  });

  describe('approval limit (decision #37)', () => {
    afterEach(() => setThreshold(null));

    it('adjusts freely when no limit is set', async () => {
      const productId = await productWithStock(1_000);
      await setThreshold(null);
      expect(await adjust(productId, { kind: 'OUT', quantity: 900 })).toMatchObject({ balanceAfter: 100 });
    });

    it('refuses a value above the limit, and accepts one equal to it', async () => {
      const productId = await productWithStock(100); // cost 5.0000
      await setThreshold('50.00');
      expect(await codeOf(adjust(productId, { kind: 'OUT', quantity: 11 }))).toBe('ADJUSTMENT_NEEDS_APPROVAL');
      expect(await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } })).toMatchObject({ quantity: 100 });
      await expectNothingWritten(productId);
      expect(await adjust(productId, { kind: 'OUT', quantity: 10 })).toMatchObject({ balanceAfter: 90 });
    });

    it('skips the check when the product has no cost', async () => {
      const productId = await productWithStock(100, null);
      await setThreshold('1.00');
      expect(await adjust(productId, { kind: 'OUT', quantity: 50 })).toMatchObject({ balanceAfter: 50 });
    });
  });

  it('does not touch a product of another company', async () => {
    const foreign = await base.product.create({
      data: { companyId: otherCompanyId, sku: `FOR-${run}`, manufacturerCode: `FOR-${run}`, brandId, categoryId, name: 'Foreign', salePrice: '1.00' },
    });
    expect(await codeOf(adjust(foreign.id, { kind: 'IN', quantity: 1 }))).toBe('PRODUCT_NOT_FOUND');
    expect(await base.stockMovement.count({ where: { productId: foreign.id } })).toBe(0);
  });

  it('numbers adjustments in sequence, with no duplicate under parallel calls', async () => {
    const productId = await productWithStock(0);
    const results = await Promise.all(Array.from({ length: 8 }, () => adjust(productId, { kind: 'IN', quantity: 1 })));
    const numbers = results.map((r) => Number(r.refNumber.slice(3))).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(8);
    expect(numbers[7] - numbers[0]).toBe(7);
    expect(await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } })).toMatchObject({ quantity: 8 });
  });

  it('continues after the highest existing number, even when an older one is shorter (AJ-0015)', async () => {
    const productId = await productWithStock(10);
    await base.tenant.$transaction((tx) =>
      new StockMovementService(cls, settings).apply(tx, {
        productId,
        warehouseId,
        type: 'ADJUSTMENT_OUT',
        quantity: -1,
        reason: 'Merma',
        refType: 'ADJUSTMENT',
        refNumber: 'AJ-0900000',
      }),
    );
    expect((await adjust(productId, { kind: 'OUT', quantity: 1 })).refNumber).toBe('AJ-900001');
  });

  it('serializes two parallel outward adjustments that together exceed the stock: one wins, none goes negative', async () => {
    const productId = await productWithStock(5);
    const results = await Promise.allSettled([
      adjust(productId, { kind: 'OUT', quantity: 3 }),
      adjust(productId, { kind: 'OUT', quantity: 3 }),
    ]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0].reason as { getResponse(): { code: string } }).getResponse().code).toBe('INSUFFICIENT_STOCK');

    const level = await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } });
    expect(level.quantity).toBe(2);
    const movements = await base.stockMovement.findMany({ where: { productId, warehouseId } });
    expect(movements.reduce((sum, m) => sum + m.quantity, 0)).toBe(level.quantity);
  });

  it('keeps the movements equal to the level when many mixed adjustments run in parallel', async () => {
    const productId = await productWithStock(10);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => adjust(productId, { kind: i % 3 === 0 ? 'IN' : 'OUT', quantity: 2 })),
    );
    expect(outcomes.some((o) => o.status === 'fulfilled')).toBe(true);
    const level = await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } });
    expect(level.quantity).toBeGreaterThanOrEqual(0);
    const movements = await base.stockMovement.findMany({ where: { productId, warehouseId } });
    expect(movements.reduce((sum, m) => sum + m.quantity, 0)).toBe(level.quantity);
  });
});
