/**
 * Integration test against the real Postgres (DATABASE_URL). Creates two throw-away companies
 * and removes them at the end, so it is safe to run against the dev database.
 */
import { NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { normalizePair } from '@rodasoft/domain';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { EquivalencesService } from './equivalences.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { SettingsService } from '../../common/settings/settings.service';
import { ProductCommandsService } from './product-commands.service';
import { StockMovementService } from './stock-movement.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;
const cls = { get: (k: string) => (k === 'companyId' ? current : k === 'membershipId' ? 'm1' : null) } as never;
const membership = { permissions: async () => new Set(), operableBranchIds: async () => null } as never;
const service = new EquivalencesService(prisma, cls, new AuditService(prisma, cls));
const settings = new SettingsService(prisma);
const commands = new ProductCommandsService(prisma, cls, new AuditService(prisma, cls), membership, settings, new StockMovementService(cls, settings), new OutboxService(prisma, cls));

interface Fixture {
  companyId: string;
  brands: Record<string, string>;
  balls: string;
  rollers: string;
  warehouseId: string;
}

const MEASURES_6205 = { innerDiameter: '25', outerDiameter: '52', width: '15' };
const ATTRS = { seal: '2RS', internalClearance: 'CN', toleranceClass: 'P0', cage: 'Acero', dynamicLoad: 14.8, staticLoad: 7.8 };

async function createCompany(tag: string): Promise<Fixture> {
  const company = await base.company.create({
    data: { slug: `eq-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `${tag}${run}`.slice(0, 20) },
  });
  const companyId = company.id;
  const branch = await base.branch.create({ data: { companyId, code: 0, name: 'B0' } });
  const warehouse = await base.warehouse.create({ data: { companyId, branchId: branch.id, code: `W-${run}`, name: 'W' } });
  const brands: Record<string, string> = {};
  for (const name of ['SKF', 'NSK', 'FAG', 'NTN']) {
    brands[name] = (await base.brand.create({ data: { companyId, name } })).id;
  }
  const bearings = await base.category.create({ data: { companyId, name: 'Rodamientos' } });
  const balls = await base.category.create({ data: { companyId, name: 'Bolas', parentId: bearings.id } });
  const rollers = await base.category.create({ data: { companyId, name: 'Rodillos', parentId: bearings.id } });
  await base.attributeDefinition.createMany({
    data: [
      { companyId, categoryId: bearings.id, key: 'seal', label: 'Protección / sello', type: 'ENUM', step: 3 },
      { companyId, categoryId: bearings.id, key: 'cage', label: 'Material de la jaula', type: 'ENUM', step: 3 },
    ],
  });
  return { companyId, brands, balls: balls.id, rollers: rollers.id, warehouseId: warehouse.id };
}

async function removeCompany(companyId: string) {
  await base.equivalence.deleteMany({ where: { companyId } });
  await base.auditLog.deleteMany({ where: { companyId } });
  await base.stockLevel.deleteMany({ where: { companyId } });
  await base.stockThreshold.deleteMany({ where: { companyId } });
  await base.companySetting.deleteMany({ where: { companyId } });
  await base.outboxEvent.deleteMany({ where: { companyId } });
  await base.productDimension.deleteMany({ where: { companyId } });
  await base.product.deleteMany({ where: { companyId } });
  await base.attributeDefinition.deleteMany({ where: { companyId } });
  await base.category.deleteMany({ where: { companyId, parentId: { not: null } } });
  await base.category.deleteMany({ where: { companyId } });
  await base.brand.deleteMany({ where: { companyId } });
  await base.warehouse.deleteMany({ where: { companyId } });
  await base.branch.deleteMany({ where: { companyId } });
  await base.company.delete({ where: { id: companyId } });
}

describe('EquivalencesService (integration, real Postgres)', () => {
  let a: Fixture;
  let b: Fixture;
  let n = 0;

  const product = async (
    f: Fixture,
    brand: string,
    code: string,
    over: { attributes?: object; dimensions?: object | null; categoryId?: string; stock?: number; price?: string } = {},
  ) => {
    n += 1;
    const p = await base.product.create({
      data: {
        companyId: f.companyId,
        sku: `EQ-${run}-${n}`,
        manufacturerCode: code,
        brandId: f.brands[brand],
        categoryId: over.categoryId ?? f.balls,
        name: `Rodamiento ${code}`,
        salePrice: over.price ?? '100.00',
        attributes: over.attributes ?? ATTRS,
        ...(over.dimensions === null
          ? {}
          : { dimensions: { create: { companyId: f.companyId, ...(over.dimensions ?? MEASURES_6205) } } }),
      },
    });
    if (over.stock !== undefined) {
      await base.stockLevel.create({ data: { companyId: f.companyId, productId: p.id, warehouseId: f.warehouseId, quantity: over.stock } });
    }
    return p.id;
  };

  const link = (companyId: string, x: string, y: string) => {
    const [productAId, productBId] = normalizePair(x, y);
    return base.equivalence.create({ data: { companyId, productAId, productBId } });
  };

  let original: string;
  let exact: string;
  let diffSeal: string;
  let diffCage: string;
  let tooBig: string;
  let unlinked: string;
  let foreign: string;

  beforeAll(async () => {
    a = await createCompany('a');
    b = await createCompany('b');
    original = await product(a, 'SKF', '6205-2RS', { stock: 24, price: '245.00' });
    exact = await product(a, 'NTN', '6205-2RSR', { stock: 6, price: '250.00' });
    diffSeal = await product(a, 'NSK', '6205-DDU', { stock: 18, price: '230.00', attributes: { ...ATTRS, seal: 'DDU' } });
    diffCage = await product(a, 'FAG', '6205-2Z', { stock: 0, price: '240.00', attributes: { ...ATTRS, cage: 'Poliamida', seal: '2Z' } });
    tooBig = await product(a, 'NSK', '6305-2RS', { dimensions: { innerDiameter: '25', outerDiameter: '62', width: '17' } });
    unlinked = await product(a, 'FAG', 'ALONE');
    foreign = await product(b, 'SKF', 'FOREIGN');
    // the original is side A for some links and side B for the others
    await link(a.companyId, original, exact);
    await link(a.companyId, diffSeal, original);
    await link(a.companyId, original, diffCage);
    await link(a.companyId, original, tooBig);
  }, 60_000);

  afterAll(async () => {
    await removeCompany(a.companyId);
    await removeCompany(b.companyId);
    await base.$disconnect();
  }, 60_000);

  beforeEach(() => {
    current = a.companyId;
  });

  it('finds the links where the product is side A and where it is side B', async () => {
    const res = await service.listForProduct(original, {});
    expect(res.items.map((i) => i.manufacturerCode).sort()).toEqual(['6205-2RSR', '6205-2Z', '6205-DDU', '6305-2RS'].sort());
    // and from the other side the original is found too
    const reverse = await service.listForProduct(diffSeal, {});
    expect(reverse.items.map((i) => i.manufacturerCode)).toEqual(['6205-2RS']);
  });

  it('computes the kind and the differences from the real attributes, with the labels of the definitions', async () => {
    const res = await service.listForProduct(original, {});
    const byCode = Object.fromEntries(res.items.map((i) => [i.manufacturerCode, i]));
    expect(byCode['6205-2RSR']).toMatchObject({ kind: 'EXACT', differences: [] });
    expect(byCode['6205-DDU']).toMatchObject({
      kind: 'WITH_DIFFERENCES',
      differences: [{ key: 'seal', label: 'Protección / sello', source: '2RS', other: 'DDU' }],
    });
    expect(byCode['6205-2Z'].differences.map((d) => [d.key, d.other])).toEqual([
      ['seal', '2Z'],
      ['cage', 'Poliamida'],
    ]);
    expect(byCode['6305-2RS']).toMatchObject({ kind: 'INCOMPATIBLE', differences: [] });
  });

  it('puts the exact equivalents first, then orders by brand', async () => {
    const res = await service.listForProduct(original, {});
    expect(res.items.map((i) => [i.kind, i.brand.name])).toEqual([
      ['EXACT', 'NTN'],
      ['WITH_DIFFERENCES', 'FAG'],
      ['WITH_DIFFERENCES', 'NSK'],
      ['INCOMPATIBLE', 'NSK'],
    ]);
  });

  it('returns the original as the first row and totals that include it', async () => {
    const res = await service.listForProduct(original, {});
    expect(res.source).toMatchObject({ productId: original, manufacturerCode: '6205-2RS', totalStock: 24, salePrice: '245.00' });
    expect(res.totals).toEqual({ codes: 5, stock: 24 + 6 + 18 + 0 + 0 });
    expect(res.items.find((i) => i.manufacturerCode === '6205-DDU')).toMatchObject({ totalStock: 18, salePrice: '230.00' });
    expect(JSON.stringify(res)).not.toContain('cost');
  });

  it('summarizes the brands and the kinds', async () => {
    const { summary } = await service.listForProduct(original, {});
    expect(summary).toEqual({ brandCount: 3, exact: 1, withDifferences: 2, incompatible: 1 });
  });

  it('paginates the equivalents and keeps the totals of the whole list', async () => {
    const first = await service.listForProduct(original, { page: 1, pageSize: 3 });
    const second = await service.listForProduct(original, { page: 2, pageSize: 3 });
    expect(first.items).toHaveLength(3);
    expect(second.items).toHaveLength(1);
    expect([first.total, second.total]).toEqual([4, 4]);
    expect(second.totals).toEqual(first.totals);
    expect(new Set([...first.items, ...second.items].map((i) => i.productId)).size).toBe(4);
  });

  it('returns no equivalents for a product without links', async () => {
    const res = await service.listForProduct(unlinked, {});
    expect(res).toMatchObject({ items: [], total: 0, summary: { brandCount: 0 }, totals: { codes: 1, stock: 0 } });
  });

  it("answers 404 for a missing product or another company's, and never shows foreign links", async () => {
    await expect(service.listForProduct(randomUUID(), {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listForProduct(foreign, {})).rejects.toBeInstanceOf(NotFoundException);
    current = b.companyId;
    await expect(service.listForProduct(original, {})).rejects.toBeInstanceOf(NotFoundException);
    expect((await service.listForProduct(foreign, {})).items).toEqual([]);
  });

  describe('integrity', () => {
    it('rejects a self-link', async () => {
      await expect(base.equivalence.create({ data: { companyId: a.companyId, productAId: unlinked, productBId: unlinked } })).rejects.toThrow();
    });

    it('rejects a pair stored in reverse order, so a duplicate in the other direction cannot exist', async () => {
      const [lo, hi] = normalizePair(original, unlinked);
      await expect(base.equivalence.create({ data: { companyId: a.companyId, productAId: hi, productBId: lo } })).rejects.toThrow();
    });

    it('rejects the same pair twice', async () => {
      await expect(link(a.companyId, original, exact)).rejects.toThrow();
    });

    it('removes the links when a product is deleted, and the product delete of HU-INV-02 still works', async () => {
      const lonely = await product(a, 'FAG', 'TO-DELETE');
      await link(a.companyId, original, lonely);
      expect((await service.listForProduct(original, {})).total).toBe(5);
      await commands.remove(lonely);
      expect(await base.product.count({ where: { id: lonely } })).toBe(0);
      expect(await base.equivalence.count({ where: { OR: [{ productAId: lonely }, { productBId: lonely }] } })).toBe(0);
      expect((await service.listForProduct(original, {})).total).toBe(4);
    });
  });
});
