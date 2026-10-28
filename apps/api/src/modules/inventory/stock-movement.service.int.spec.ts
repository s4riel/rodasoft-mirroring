/**
 * Integration test of the stock movements service against the real Postgres (DATABASE_URL), including the concurrency
 * rule of HU-INV-06: parallel deductions must never leave negative stock nor lose a movement.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import { StockMovementService } from './stock-movement.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;
const cls = { get: (k: string) => (k === 'companyId' ? current : null) } as never;
const settings = new SettingsService(prisma);
const stock = new StockMovementService(cls, settings);

/** The immutability trigger blocks DELETE on stock_movements; test cleanup bypasses it inside its own transaction. */
async function purgeMovements(companyId: string) {
  await base.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.stockMovement.deleteMany({ where: { companyId } });
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

/** Applies one movement in its own transaction, as the business services do. */
const move = (productId: string, warehouseId: string, quantity: number, type: 'INITIAL' | 'SALE' = 'SALE') =>
  base.tenant.$transaction((tx) => stock.apply(tx, { productId, warehouseId, type, quantity, reason: 'Test movement' }));

describe('StockMovementService (integration, real Postgres)', () => {
  let companyId: string;
  let warehouseId: string;
  let productId: string;
  let brandId: string;
  let categoryId: string;

  beforeAll(async () => {
    const company = await base.company.create({
      data: { slug: `stk-${run}`, legalName: 'stock', tradeName: 'stock', nit: `S${run}`.slice(0, 20) },
    });
    companyId = company.id;
    current = companyId;
    const branch = await base.branch.create({ data: { companyId, code: 0, name: 'B0' } });
    const warehouse = await base.warehouse.create({ data: { companyId, branchId: branch.id, code: `S-${run}`, name: 'W', isMain: true } });
    warehouseId = warehouse.id;
    const country = await base.country.create({ data: { companyId, code: 'SE', name: 'Suecia' } });
    brandId = (await base.brand.create({ data: { companyId, name: `Marca ${run}`, countryId: country.id } })).id;
    categoryId = (await base.category.create({ data: { companyId, name: `Cat ${run}` } })).id;
    const product = await base.product.create({
      data: { companyId, sku: `STK-${run}`, manufacturerCode: `STK-${run}`, brandId, categoryId, name: 'Stock test', salePrice: '1.00' },
    });
    productId = product.id;
  });

  afterAll(async () => {
    await purgeMovements(companyId);
    await base.stockLevel.deleteMany({ where: { companyId } });
    await base.product.deleteMany({ where: { companyId } });
    await base.category.deleteMany({ where: { companyId } });
    await base.brand.deleteMany({ where: { companyId } });
    await base.warehouse.deleteMany({ where: { companyId } });
    await base.branch.deleteMany({ where: { companyId } });
    await base.country.deleteMany({ where: { companyId } });
    await base.company.delete({ where: { id: companyId } });
    await base.$disconnect();
  });

  it('creates the level on first use and keeps the balance chain', async () => {
    expect(await move(productId, warehouseId, 24, 'INITIAL')).toMatchObject({ balanceAfter: 24 });
    expect(await move(productId, warehouseId, -4)).toMatchObject({ balanceAfter: 20 });
    const level = await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } });
    expect(level.quantity).toBe(20);
    const movements = await base.stockMovement.findMany({ where: { productId, warehouseId }, orderBy: { createdAt: 'asc' } });
    expect(movements.map((m) => m.balanceAfter)).toEqual([24, 20]);
  });

  it('refuses a movement below zero when negative stock is not allowed', async () => {
    expect(await codeOf(move(productId, warehouseId, -100))).toBe('INSUFFICIENT_STOCK');
    expect(await base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } })).toMatchObject({ quantity: 20 });
  });

  it('refuses a movement without a reason, or whose sign does not match its type', async () => {
    const apply = (input: { type: 'SALE' | 'INITIAL'; quantity: number; reason: string }) =>
      base.tenant.$transaction((tx) => stock.apply(tx, { productId, warehouseId, ...input }));
    expect(await codeOf(apply({ type: 'SALE', quantity: -1, reason: '  ' }))).toBe('REASON_REQUIRED');
    expect(await codeOf(apply({ type: 'SALE', quantity: 1, reason: 'Venta' }))).toBe('MOVEMENT_SIGN_MISMATCH');
    expect(await codeOf(apply({ type: 'INITIAL', quantity: -1, reason: 'Carga' }))).toBe('MOVEMENT_SIGN_MISMATCH');
  });

  it('refuses stock into an inactive warehouse', async () => {
    const branch = await base.branch.findFirstOrThrow({ where: { companyId } });
    const closed = await base.warehouse.create({ data: { companyId, branchId: branch.id, code: `X-${run}`, name: 'Cerrado', status: 'INACTIVE' } });
    expect(await codeOf(move(productId, closed.id, 5, 'INITIAL'))).toBe('WAREHOUSE_INACTIVE');
    await base.warehouse.delete({ where: { id: closed.id } });
  });

  it('serializes 10 parallel deductions of 1 on a stock of 5: exactly 5 succeed, none goes negative, none is lost', async () => {
    const fresh = await base.product.create({
      data: { companyId, sku: `CONC-${run}`, manufacturerCode: `CONC-${run}`, brandId, categoryId, name: 'Concurrency', salePrice: '1.00' },
    });
    await move(fresh.id, warehouseId, 5, 'INITIAL');

    const results = await Promise.allSettled(Array.from({ length: 10 }, () => move(fresh.id, warehouseId, -1)));
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(succeeded).toHaveLength(5);
    expect(rejected).toHaveLength(5);
    for (const r of rejected) {
      expect((r.reason as { getResponse(): { code: string } }).getResponse().code).toBe('INSUFFICIENT_STOCK');
    }
    expect(await base.stockLevel.findFirstOrThrow({ where: { productId: fresh.id, warehouseId } })).toMatchObject({ quantity: 0 });

    const movements = await base.stockMovement.findMany({ where: { productId: fresh.id, warehouseId }, orderBy: { createdAt: 'asc' } });
    expect(movements).toHaveLength(6); // the initial stock plus the five deductions that succeeded
    expect(movements.map((m) => m.balanceAfter).sort((x, y) => y - x)).toEqual([5, 4, 3, 2, 1, 0]);
  });
});

