/**
 * Integration test of the sales schema against the real Postgres (DATABASE_URL): the constraints the migration adds by
 * hand, the unique keys, and the tenant isolation of the new models. Creates throw-away companies and removes them.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { tenantExtension } from '../../common/prisma/tenant.extension';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();

interface Fixture {
  companyId: string;
  branchId: string;
  warehouseId: string;
  registerId: string;
}

async function createFixture(tag: string): Promise<Fixture> {
  const company = await base.company.create({
    data: { slug: `ven-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `V${tag}${run}`.slice(0, 20) },
  });
  const branch = await base.branch.create({ data: { companyId: company.id, code: 0, name: 'Central' } });
  const warehouse = await base.warehouse.create({ data: { companyId: company.id, branchId: branch.id, code: 'T-01', name: 'Main', isMain: true } });
  const pos = await base.siatPointOfSale.create({ data: { companyId: company.id, branchId: branch.id, code: 0, name: 'Caja 1' } });
  const register = await base.cashRegister.create({
    data: { companyId: company.id, branchId: branch.id, pointOfSaleId: pos.id, warehouseId: warehouse.id, name: 'Caja 1' },
  });
  return { companyId: company.id, branchId: branch.id, warehouseId: warehouse.id, registerId: register.id };
}

const openShift = (f: Fixture) =>
  base.cashShift.create({ data: { companyId: f.companyId, registerId: f.registerId, openingFloat: '100.00', openedById: randomUUID() } });

describe('sales schema (integration, real Postgres)', () => {
  let a: Fixture;
  let b: Fixture;

  beforeAll(async () => {
    a = await createFixture('a');
    b = await createFixture('b');
  });

  afterAll(async () => {
    for (const f of [a, b]) {
      const where = { companyId: f.companyId };
      await base.posCheckoutItem.deleteMany({ where });
      await base.posCheckout.deleteMany({ where });
      await base.cashShift.deleteMany({ where });
      await base.cashRegister.deleteMany({ where });
      await base.customer.deleteMany({ where });
      await base.siatPointOfSale.deleteMany({ where });
      await base.warehouse.deleteMany({ where });
      await base.branch.deleteMany({ where });
      await base.company.delete({ where: { id: f.companyId } });
    }
    await base.$disconnect();
  });

  describe('cash shifts', () => {
    it('refuses a second OPEN shift on the same register', async () => {
      await openShift(a);
      await expect(openShift(a)).rejects.toThrow();
    });

    it('allows a new shift once the open one is closed, and one OPEN shift per register', async () => {
      await base.cashShift.updateMany({ where: { companyId: a.companyId, status: 'OPEN' }, data: { status: 'CLOSED' } });
      await expect(openShift(a)).resolves.toBeDefined();
      // another company's register is independent
      await expect(openShift(b)).resolves.toBeDefined();
    });
  });

  describe('cash registers', () => {
    it('allows one register per SIAT point of sale', async () => {
      const pos = await base.siatPointOfSale.findFirstOrThrow({ where: { companyId: a.companyId } });
      await expect(
        base.cashRegister.create({
          data: { companyId: a.companyId, branchId: a.branchId, pointOfSaleId: pos.id, warehouseId: a.warehouseId, name: 'Dup' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('customers', () => {
    const customer = (f: Fixture, data: Record<string, unknown> = {}) =>
      base.customer.create({ data: { companyId: f.companyId, name: 'Cliente', documentType: 5, documentNumber: '1020304050', ...data } as never });

    it('keeps the document unique per company', async () => {
      await customer(a);
      await expect(customer(a)).rejects.toThrow();
      await expect(customer(b)).resolves.toBeDefined();
    });

    it('accepts a percent up to 100 and a fixed amount above 100', async () => {
      await expect(customer(a, { documentNumber: '1', discountType: 'PERCENT', discountValue: '100.00' })).resolves.toBeDefined();
      await expect(customer(a, { documentNumber: '2', discountType: 'AMOUNT', discountValue: '250.00' })).resolves.toBeDefined();
    });

    it('refuses a percent above 100 and a negative discount', async () => {
      await expect(customer(a, { documentNumber: '3', discountType: 'PERCENT', discountValue: '100.01' })).rejects.toThrow();
      await expect(customer(a, { documentNumber: '4', discountType: 'AMOUNT', discountValue: '-1.00' })).rejects.toThrow();
    });

    it('is isolated by company through prisma.tenant', async () => {
      current = a.companyId;
      const mine = await base.tenant.customer.findMany();
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every((c) => c.companyId === a.companyId)).toBe(true);

      current = b.companyId;
      const theirs = await base.tenant.customer.findMany();
      expect(theirs.every((c) => c.companyId === b.companyId)).toBe(true);
    });

    it('stamps the company on creates made through prisma.tenant', async () => {
      current = b.companyId;
      const created = await base.tenant.customer.create({ data: { name: 'Tenant', documentType: 1, documentNumber: '777' } as never });
      expect(created.companyId).toBe(b.companyId);
    });
  });

  describe('checkouts', () => {
    it('refuses a line with a quantity of zero', async () => {
      const shift = await base.cashShift.findFirstOrThrow({ where: { companyId: a.companyId } });
      const checkout = await base.posCheckout.create({ data: { companyId: a.companyId, cashierId: randomUUID(), shiftId: shift.id } });
      const product = await createProduct(a.companyId);
      await expect(
        base.posCheckoutItem.create({
          data: { companyId: a.companyId, checkoutId: checkout.id, productId: product, quantity: 0, unitPrice: '10.00' },
        }),
      ).rejects.toThrow();
      await base.posCheckoutItem.deleteMany({ where: { companyId: a.companyId } });
      await base.product.deleteMany({ where: { companyId: a.companyId } });
      await base.brand.deleteMany({ where: { companyId: a.companyId } });
      await base.category.deleteMany({ where: { companyId: a.companyId } });
    });
  });
});

async function createProduct(companyId: string): Promise<string> {
  const brand = await base.brand.create({ data: { companyId, name: 'B' } });
  const category = await base.category.create({ data: { companyId, name: 'C' } });
  const product = await base.product.create({
    data: { companyId, sku: `T-${run}`, manufacturerCode: 'X1', brandId: brand.id, categoryId: category.id, name: 'Prod', salePrice: '10.00' },
  });
  return product.id;
}
