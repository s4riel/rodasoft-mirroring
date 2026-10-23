/**
 * Integration test against the real Postgres (DATABASE_URL). Creates two throw-away companies
 * and removes them at the end, so it is safe to run against the dev database.
 */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { OutboxService } from '../../common/outbox/outbox.service';
import { SettingsService } from '../../common/settings/settings.service';
import { ProductCommandsService } from './product-commands.service';
import { StockMovementService } from './stock-movement.service';
import { ProductsService } from './products.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;
let grantedPermissions: string[] = ['inventory.costs.view'];
const cls = { get: (k: string) => (k === 'companyId' ? current : k === 'membershipId' ? 'm1' : null) } as never;
const membership = { permissions: async () => new Set(grantedPermissions), operableBranchIds: async () => null } as never;
const settings = new SettingsService(prisma);
const outbox = new OutboxService(prisma, cls);
const commands = new ProductCommandsService(prisma, cls, new AuditService(prisma, cls), membership, settings, new StockMovementService(cls, settings), outbox);
const products = new ProductsService(prisma, cls);

interface Fixture {
  companyId: string;
  warehouseId: string;
  countrySE: string;
  countryJP: string;
  brandSKF: string;
  brandNSK: string;
  category: string;
}

async function createCompany(tag: string): Promise<Fixture> {
  const company = await base.company.create({
    data: { slug: `cmd-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `${tag}${run}`.slice(0, 20) },
  });
  const companyId = company.id;
  const branch = await base.branch.create({ data: { companyId, code: 0, name: 'B0' } });
  const warehouse = await base.warehouse.create({ data: { companyId, branchId: branch.id, code: `W-${run}`, name: 'W' } });
  const [se, jp] = await Promise.all([
    base.country.create({ data: { companyId, code: 'SE', name: 'Suecia' } }),
    base.country.create({ data: { companyId, code: 'JP', name: 'Japón' } }),
  ]);
  const [skf, nsk] = await Promise.all([
    base.brand.create({ data: { companyId, name: 'SKF', countryId: se.id } }),
    base.brand.create({ data: { companyId, name: 'NSK', countryId: jp.id } }),
  ]);
  const category = await base.category.create({ data: { companyId, name: 'Rodamientos' } });
  return {
    companyId,
    warehouseId: warehouse.id,
    countrySE: se.id,
    countryJP: jp.id,
    brandSKF: skf.id,
    brandNSK: nsk.id,
    category: category.id,
  };
}

/** The immutability trigger blocks DELETE on stock_movements; test cleanup bypasses it inside its own transaction. */
async function purgeMovements(companyId: string) {
  await base.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.stockMovement.deleteMany({ where: { companyId } });
  });
}

async function removeCompany(companyId: string) {
  await purgeMovements(companyId);
  await base.auditLog.deleteMany({ where: { companyId } });
  await base.stockLevel.deleteMany({ where: { companyId } });
  await base.stockThreshold.deleteMany({ where: { companyId } });
  await base.companySetting.deleteMany({ where: { companyId } });
  await base.outboxEvent.deleteMany({ where: { companyId } });
  await base.productDimension.deleteMany({ where: { companyId } });
  await base.product.deleteMany({ where: { companyId } });
  await base.category.deleteMany({ where: { companyId } });
  await base.brand.deleteMany({ where: { companyId } });
  await base.country.deleteMany({ where: { companyId } });
  await base.warehouse.deleteMany({ where: { companyId } });
  await base.branch.deleteMany({ where: { companyId } });
  await base.company.delete({ where: { id: companyId } });
}

describe('ProductCommandsService (integration, real Postgres)', () => {
  let a: Fixture;
  let b: Fixture;
  let source: string;
  let foreign: string;

  const dup = (code: string, over: Partial<Parameters<ProductCommandsService['duplicate']>[1]> = {}) =>
    commands.duplicate(source, {
      manufacturerCode: code,
      brandId: a.brandSKF,
      countryId: a.countrySE,
      copy: ['dimensions', 'specifications', 'price'],
      ...over,
    });

  beforeAll(async () => {
    a = await createCompany('a');
    b = await createCompany('b');
    const src = await base.product.create({
      data: {
        companyId: a.companyId,
        sku: 'RL-000010',
        manufacturerCode: '6205-2RS',
        brandId: a.brandSKF,
        countryId: a.countrySE,
        categoryId: a.category,
        name: 'Rodamiento 6205-2RS',
        salePrice: '120.50',
        cost: '70.0000',
        attributes: { seal: '2RS' },
        photos: ['p.jpg'],
        datasheetUrl: 'https://x/d.pdf',
        dimensions: { create: { companyId: a.companyId, innerDiameter: '25', outerDiameter: '52', width: '15' } },
      },
    });
    source = src.id;
    await base.stockLevel.create({ data: { companyId: a.companyId, productId: src.id, warehouseId: a.warehouseId, quantity: 9 } });
    const other = await base.product.create({
      data: {
        companyId: b.companyId,
        sku: 'RL-000001',
        manufacturerCode: 'X-1',
        brandId: b.brandSKF,
        categoryId: b.category,
        name: 'Other company',
        salePrice: '1.00',
      },
    });
    foreign = other.id;
  });

  afterAll(async () => {
    await removeCompany(a.companyId);
    await removeCompany(b.companyId);
    await base.$disconnect();
  });

  beforeEach(() => {
    current = a.companyId;
    grantedPermissions = ['inventory.costs.view'];
  });

  describe('duplicate', () => {
    it('copies only the chosen parts, starts at stock 0, stores the chosen industry and audits', async () => {
      const copy = await dup('6205-2RS-JP', { brandId: a.brandNSK, countryId: a.countryJP, copy: ['price'] });
      expect(copy.sku).toMatch(/^RL-0000\d\d$/);

      const row = await base.product.findUniqueOrThrow({
        where: { id: copy.id },
        include: { dimensions: true, stockLevels: true },
      });
      expect(row).toMatchObject({
        manufacturerCode: '6205-2RS-JP',
        brandId: a.brandNSK,
        countryId: a.countryJP,
        name: 'Rodamiento 6205-2RS',
        status: 'ACTIVE',
        attributes: {},
        photos: [],
        datasheetUrl: null,
      });
      expect(row.salePrice.toFixed(2)).toBe('120.50');
      expect(row.dimensions).toBeNull();
      expect(row.stockLevels).toHaveLength(0);

      const listed = await products.list({});
      expect(listed.items.find((i) => i.id === copy.id)?.country?.code).toBe('JP');

      const audit = await base.auditLog.findFirst({ where: { companyId: a.companyId, entityId: copy.id } });
      expect(audit).toMatchObject({ action: 'inventory.product.duplicate', entity: 'Product', before: { sourceId: source } });
    });

    it('copies the cost with the price only for users who can view costs', async () => {
      const withCost = await dup('COST-YES', { copy: ['price'] });
      expect((await base.product.findUniqueOrThrow({ where: { id: withCost.id } })).cost?.toFixed(4)).toBe('70.0000');

      grantedPermissions = [];
      const withoutCost = await dup('COST-NO', { copy: ['price'] });
      const row = await base.product.findUniqueOrThrow({ where: { id: withoutCost.id } });
      expect(row.salePrice.toFixed(2)).toBe('120.50');
      expect(row.cost).toBeNull();
    });

    it('copies dimensions, specifications and media when asked and zeroes the price otherwise', async () => {
      const copy = await dup('6205-FULL', { copy: ['dimensions', 'specifications', 'media'] });
      const row = await base.product.findUniqueOrThrow({ where: { id: copy.id }, include: { dimensions: true } });
      expect(row.attributes).toEqual({ seal: '2RS' });
      expect(row.photos).toEqual(['p.jpg']);
      expect(row.datasheetUrl).toBe('https://x/d.pdf');
      expect(row.dimensions?.innerDiameter?.toString()).toBe('25');
      expect(row.salePrice.toFixed(2)).toBe('0.00');
      expect(row.cost).toBeNull();
    });

    it('rejects an existing code for the same brand with 409', async () => {
      await expect(dup('6205-2RS')).rejects.toMatchObject({
        constructor: ConflictException,
        response: { code: 'DUPLICATE_MANUFACTURER_CODE' },
      });
    });

    it('rejects an unknown source, brand or country', async () => {
      await expect(commands.duplicate(randomUUID(), { manufacturerCode: 'Z', brandId: a.brandSKF, countryId: null, copy: [] })).rejects.toBeInstanceOf(NotFoundException);
      await expect(dup('Z-1', { brandId: randomUUID() })).rejects.toMatchObject({ response: { code: 'BRAND_NOT_FOUND' } });
      await expect(dup('Z-2', { countryId: randomUUID() })).rejects.toMatchObject({ response: { code: 'COUNTRY_NOT_FOUND' } });
    });

    it('keeps the tenant filter inside the transaction', async () => {
      const seen = await prisma.tenant.$transaction((tx) => tx.product.findMany({ where: { id: foreign } }));
      expect(seen).toHaveLength(0);
    });

    it('cannot duplicate or use data of another company', async () => {
      await expect(commands.duplicate(foreign, { manufacturerCode: 'Y', brandId: a.brandSKF, countryId: null, copy: [] })).rejects.toBeInstanceOf(NotFoundException);
      await expect(dup('Y-1', { brandId: b.brandSKF })).rejects.toMatchObject({ response: { code: 'BRAND_NOT_FOUND' } });
      await expect(dup('Y-2', { countryId: b.countrySE })).rejects.toMatchObject({ response: { code: 'COUNTRY_NOT_FOUND' } });
    });

    it('gives 5 parallel duplicates 5 distinct consecutive SKUs', async () => {
      const results = await Promise.all([1, 2, 3, 4, 5].map((i) => dup(`PAR-${i}`)));
      const numbers = results.map((r) => Number(r.sku.slice(3))).sort((x, y) => x - y);
      expect(new Set(numbers).size).toBe(5);
      expect(numbers[4] - numbers[0]).toBe(4);
    });

    it('lets one of 2 parallel duplicates with the same code succeed and rejects the other with 409', async () => {
      const results = await Promise.allSettled([dup('RACE-1'), dup('RACE-1')]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason.response.code).toBe('DUPLICATE_MANUFACTURER_CODE');
    });
  });

  describe('remove', () => {
    const create = (code: string) =>
      base.product.create({
        data: {
          companyId: a.companyId,
          sku: `DEL-${code}`,
          manufacturerCode: code,
          brandId: a.brandSKF,
          categoryId: a.category,
          name: code,
          salePrice: '1.00',
          dimensions: { create: { companyId: a.companyId, innerDiameter: '1' } },
        },
      });

    it('is blocked when the product has stock records', async () => {
      await expect(commands.remove(source)).rejects.toMatchObject({
        constructor: ConflictException,
        response: { code: 'PRODUCT_HAS_STOCK' },
      });
      expect(await base.product.count({ where: { id: source } })).toBe(1);
    });

    it('is blocked when the product has movements, even if its stock is now 0', async () => {
      const p = await create('DEL-HIST');
      await base.stockLevel.create({ data: { companyId: a.companyId, productId: p.id, warehouseId: a.warehouseId, quantity: 0 } });
      await base.stockMovement.create({
        data: { companyId: a.companyId, productId: p.id, warehouseId: a.warehouseId, type: 'INITIAL', quantity: 3, balanceAfter: 3 },
      });
      await expect(commands.remove(p.id)).rejects.toMatchObject({
        constructor: ConflictException,
        response: { code: 'PRODUCT_HAS_MOVEMENTS' },
      });
      expect(await base.product.count({ where: { id: p.id } })).toBe(1);
    });

    it('deletes a product whose only stock record is 0 and has no movements', async () => {
      const p = await create('DEL-ZERO');
      await base.stockLevel.create({ data: { companyId: a.companyId, productId: p.id, warehouseId: a.warehouseId, quantity: 0 } });
      await commands.remove(p.id);
      expect(await base.product.count({ where: { id: p.id } })).toBe(0);
      expect(await base.stockLevel.count({ where: { productId: p.id } })).toBe(0);
    });

    it('deletes a product without history with its dimensions and audits it', async () => {
      const p = await create('DEL-1');
      await commands.remove(p.id);
      expect(await base.product.count({ where: { id: p.id } })).toBe(0);
      expect(await base.productDimension.count({ where: { productId: p.id } })).toBe(0);
      const audit = await base.auditLog.findFirst({ where: { companyId: a.companyId, entityId: p.id } });
      expect(audit).toMatchObject({ action: 'inventory.product.delete', before: { manufacturerCode: 'DEL-1' } });
    });

    it('answers 404 for a missing product or one of another company', async () => {
      await expect(commands.remove(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
      await expect(commands.remove(foreign)).rejects.toBeInstanceOf(NotFoundException);
      expect(await base.product.count({ where: { id: foreign } })).toBe(1);
    });
  });

  describe('industry filter', () => {
    it("uses the product's country and falls back to the brand's", async () => {
      const own = await dup('IND-OWN', { brandId: a.brandSKF, countryId: a.countryJP });
      const inherited = await base.product.create({
        data: {
          companyId: a.companyId,
          sku: 'IND-INH',
          manufacturerCode: 'IND-INH',
          brandId: a.brandNSK,
          categoryId: a.category,
          name: 'inherits JP from NSK',
          salePrice: '1.00',
        },
      });
      const jp = (await products.list({ countryId: a.countryJP, pageSize: 100 })).items.map((i) => i.id);
      expect(jp).toContain(own.id);
      expect(jp).toContain(inherited.id);
      const se = (await products.list({ countryId: a.countrySE, pageSize: 100 })).items.map((i) => i.id);
      expect(se).not.toContain(own.id);
      expect(se).not.toContain(inherited.id);
    });
  });
});
