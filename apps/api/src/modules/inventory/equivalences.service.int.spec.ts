/**
 * Integration test against the real Postgres (DATABASE_URL). Creates two throw-away companies
 * and removes them at the end, so it is safe to run against the dev database.
 */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { normalizePair } from '@rodasoft/domain';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { PermissionsGuard } from '../access/permissions.guard';
import { EquivalencesController } from './equivalences.controller';
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

  describe('company-wide list (HU-INV-11)', () => {
    it('lists each pair once with both products, its kind and its differences', async () => {
      const res = await service.list({});
      expect(res).toMatchObject({ total: 4, page: 1, linksEmpty: false });
      expect(res.items).toHaveLength(4);
      const toDdu = res.items.find((i) => [i.productA.id, i.productB.id].includes(diffSeal));
      expect(toDdu).toBeDefined();
      expect(new Set([toDdu!.productA.id, toDdu!.productB.id])).toEqual(new Set([original, diffSeal]));
      expect(toDdu).toMatchObject({ kind: 'WITH_DIFFERENCES' });
      expect(toDdu!.differences.map((d) => d.key)).toEqual(['seal']);
      // a pair is stored in one direction only, so no link repeats
      expect(new Set(res.items.map((i) => i.id)).size).toBe(4);
    });

    it('describes each side with code, brand, measures and the total stock', async () => {
      const res = await service.list({});
      const sides = res.items.flatMap((i) => [i.productA, i.productB]);
      const skf = sides.find((p) => p.id === original)!;
      expect(skf).toMatchObject({
        manufacturerCode: '6205-2RS',
        brand: { name: 'SKF' },
        dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15' },
        totalStock: 24,
        status: 'ACTIVE',
      });
      expect(sides.find((p) => p.id === exact)).toMatchObject({ totalStock: 6, brand: { name: 'NTN' } });
      expect(sides.find((p) => p.id === diffCage)).toMatchObject({ totalStock: 0 });
      expect(JSON.stringify(res)).not.toContain('cost');
    });

    it('lists the newest link first and returns the date of creation', async () => {
      const res = await service.list({});
      const times = res.items.map((i) => Date.parse(i.createdAt));
      expect(times).toEqual([...times].sort((x, y) => y - x));
      expect(res.items[0].createdBy).toBeNull();
    });

    it('filters by kind, computing it before the page is cut', async () => {
      expect((await service.list({ kind: 'EXACT' })).items.map((i) => i.kind)).toEqual(['EXACT']);
      const diff = await service.list({ kind: 'WITH_DIFFERENCES' });
      expect([diff.total, diff.items.every((i) => i.kind === 'WITH_DIFFERENCES')]).toEqual([2, true]);
      expect((await service.list({ kind: 'INCOMPATIBLE' })).total).toBe(1);
      const second = await service.list({ kind: 'WITH_DIFFERENCES', page: 2, pageSize: 1 });
      expect([second.total, second.items.length]).toEqual([2, 1]);
    });

    it('filters by the brand of either side', async () => {
      const ntn = await service.list({ brandId: a.brands['NTN'] });
      expect(ntn.items.map((i) => i.kind)).toEqual(['EXACT']);
      // SKF is the original, which is side A in some links and side B in others
      expect((await service.list({ brandId: a.brands['SKF'] })).total).toBe(4);
      expect((await service.list({ brandId: a.brands['NSK'] })).total).toBe(2);
    });

    it('filters by category, a root one matching its subcategories', async () => {
      const root = await base.category.findFirstOrThrow({ where: { companyId: a.companyId, parentId: null } });
      expect((await service.list({ categoryId: root.id })).total).toBe(4);
      expect((await service.list({ categoryId: a.balls })).total).toBe(4);
      expect((await service.list({ categoryId: a.rollers })).total).toBe(0);
    });

    it('searches the code of either side, ignoring case', async () => {
      expect((await service.list({ q: '6205-2z' })).total).toBe(1);
      // the original appears on every link
      expect((await service.list({ q: '6205-2RS' })).total).toBe(4);
      expect((await service.list({ q: '  nothing  ' })).total).toBe(0);
    });

    it('combines the filters', async () => {
      const res = await service.list({ brandId: a.brands['NSK'], kind: 'WITH_DIFFERENCES', q: 'DDU' });
      expect(res.total).toBe(1);
    });

    it('paginates and keeps the total', async () => {
      const first = await service.list({ page: 1, pageSize: 3 });
      const second = await service.list({ page: 2, pageSize: 3 });
      expect([first.items.length, second.items.length, first.total, second.total]).toEqual([3, 1, 4, 4]);
      expect(new Set([...first.items, ...second.items].map((i) => i.id)).size).toBe(4);
      expect((await service.list({ page: 9 })).items).toEqual([]);
    });

    it('tells a company without links from a search without results', async () => {
      expect(await service.list({ q: 'nothing' })).toMatchObject({ total: 0, linksEmpty: false });
      current = b.companyId;
      expect(await service.list({})).toMatchObject({ items: [], total: 0, linksEmpty: true });
    });

    it("never shows another company's links", async () => {
      current = b.companyId;
      const other = await product(b, 'SKF', 'FOREIGN-2');
      await link(b.companyId, foreign, other);
      const res = await service.list({});
      expect(res.total).toBe(1);
      expect(res.items[0].productA.manufacturerCode.startsWith('FOREIGN')).toBe(true);
      expect(JSON.stringify(res)).not.toContain('6205');
      current = a.companyId;
      expect(JSON.stringify(await service.list({ pageSize: 100 }))).not.toContain('FOREIGN');
    });

    describe('permissions', () => {
      const guardFor = (granted: string[]) =>
        new PermissionsGuard(new Reflector(), { permissions: async () => new Set(granted) } as never);
      const contextOf = (handler: unknown) =>
        ({
          getHandler: () => handler,
          getClass: () => EquivalencesController,
          switchToHttp: () => ({ getRequest: () => ({ user: { mid: 'm1' } }) }),
        }) as never;

      it('lets a user who can only view read the list but answers 403 when they try to link', async () => {
        const viewer = guardFor(['inventory.products.view']);
        await expect(viewer.canActivate(contextOf(EquivalencesController.prototype.listAll))).resolves.toBe(true);
        const refused = viewer.canActivate(contextOf(EquivalencesController.prototype.link));
        await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
        await expect(refused).rejects.toMatchObject({ response: { code: 'NO_PERMISSION', details: { missing: ['inventory.equivalences.link'] } } });
      });

      it('refuses the list to a user who cannot view products', async () => {
        await expect(guardFor([]).canActivate(contextOf(EquivalencesController.prototype.listAll))).rejects.toBeInstanceOf(ForbiddenException);
      });
    });
  });

  describe('side-by-side comparison (HU-INV-12)', () => {
    let seals: string;

    beforeAll(async () => {
      await base.attributeDefinition.create({
        data: { companyId: a.companyId, categoryId: (await base.category.findFirstOrThrow({ where: { companyId: a.companyId, name: 'Rodamientos' } })).id, key: 'minRadius', label: 'Radio mínimo r', type: 'NUMBER', unit: 'mm', step: 2 },
      });
      seals = await product(a, 'FAG', '6205-SEALS', { attributes: { ...ATTRS, minRadius: 1, seal: 'Abierto' } });
    }, 30_000);

    const rowOf = (res: Awaited<ReturnType<typeof service.compare>>, key: string) => res.rows.find((r) => r.key === key);

    it('returns the columns in the order requested, with the product data and the stock', async () => {
      const res = await service.compare([diffSeal, original, exact].join(','));
      expect(res.columns.map((c) => c.manufacturerCode)).toEqual(['6205-DDU', '6205-2RS', '6205-2RSR']);
      expect(res.columns[0]).toMatchObject({
        productId: diffSeal,
        brand: { name: 'NSK' },
        totalStock: 18,
        salePrice: '230.00',
        status: 'ACTIVE',
        photoUrl: null,
      });
      expect(JSON.stringify(res)).not.toContain('cost');
    });

    it('returns the measures and the real attribute values, with the labels of the definitions', async () => {
      const res = await service.compare([original, diffSeal, diffCage].join(','));
      expect(rowOf(res, 'innerDiameter')).toMatchObject({ label: 'd', unit: 'mm', group: 'MEASURES', values: ['25', '25', '25'], differs: false });
      expect(rowOf(res, 'width')).toMatchObject({ label: 'B', values: ['15', '15', '15'] });
      expect(rowOf(res, 'seal')).toMatchObject({ label: 'Protección / sello', group: 'SPECS', values: ['2RS', 'DDU', '2Z'], differs: true });
      expect(rowOf(res, 'cage')).toMatchObject({ label: 'Material de la jaula', values: ['Acero', 'Acero', 'Poliamida'], differs: true });
      // the compared keys come before the other fields
      const keys = res.rows.map((r) => r.key);
      expect(keys.indexOf('seal')).toBeLessThan(keys.indexOf('minRadius'));
      expect(rowOf(res, 'minRadius')).toMatchObject({ unit: 'mm', values: [null, null, null], differs: false });
    });

    it('marks each column against the first one, and a different measure as INCOMPATIBLE', async () => {
      const res = await service.compare([original, exact, diffSeal, tooBig].join(','));
      expect(res.columns.map((c) => c.kind)).toEqual(['EXACT', 'EXACT', 'WITH_DIFFERENCES', 'INCOMPATIBLE']);
      expect(res.columns[2].differences.map((d) => d.key)).toEqual(['seal']);
      expect(rowOf(res, 'outerDiameter')).toMatchObject({ values: ['52', '52', '52', '62'], differs: true });
    });

    it('compares products that are not linked to each other', async () => {
      const res = await service.compare([diffSeal, seals].join(','));
      expect(res.columns.map((c) => c.kind)).toEqual(['EXACT', 'WITH_DIFFERENCES']);
      expect(rowOf(res, 'seal')?.differs).toBe(true);
    });

    it('rejects fewer than 2 products, more than 4, duplicates and ids that are not uuids with COMPARE_INVALID_SELECTION', async () => {
      for (const ids of [original, [original, exact, diffSeal, diffCage, tooBig].join(','), [original, original].join(','), `${original},not-a-uuid`, `${original},`]) {
        const refused = service.compare(ids);
        await expect(refused).rejects.toBeInstanceOf(BadRequestException);
        await expect(refused).rejects.toMatchObject({ response: { code: 'COMPARE_INVALID_SELECTION', details: { min: 2, max: 4 } } });
      }
    });

    it('accepts ids in upper case, and sees a mixed-case repeat as a duplicate', async () => {
      const res = await service.compare([original.toUpperCase(), exact].join(','));
      expect(res.columns.map((c) => c.productId)).toEqual([original, exact]);
      const refused = service.compare([original.toUpperCase(), original].join(','));
      await expect(refused).rejects.toMatchObject({ response: { code: 'COMPARE_INVALID_SELECTION' } });
    });

    it('answers PRODUCT_NOT_FOUND for an unknown id and for a product of another company', async () => {
      const refused = service.compare([original, randomUUID()].join(','));
      await expect(refused).rejects.toBeInstanceOf(NotFoundException);
      await expect(refused).rejects.toMatchObject({ response: { code: 'PRODUCT_NOT_FOUND' } });
      await expect(service.compare([original, foreign].join(','))).rejects.toMatchObject({ response: { code: 'PRODUCT_NOT_FOUND' } });
    });

    it('does not show the data of another company', async () => {
      current = b.companyId;
      const mine = await product(b, 'SKF', 'CMP-ONLY-B');
      const res = await service.compare([foreign, mine].join(','));
      current = a.companyId;
      expect(res.columns.map((c) => c.manufacturerCode)).toEqual(['FOREIGN', 'CMP-ONLY-B']);
      expect(JSON.stringify(res)).not.toContain('6205');
    });

    it('is open to who can view products and refused to who cannot', async () => {
      const guardFor = (granted: string[]) => new PermissionsGuard(new Reflector(), { permissions: async () => new Set(granted) } as never);
      const contextOf = () =>
        ({
          getHandler: () => EquivalencesController.prototype.compare,
          getClass: () => EquivalencesController,
          switchToHttp: () => ({ getRequest: () => ({ user: { mid: 'm1' } }) }),
        }) as never;
      await expect(guardFor(['inventory.products.view']).canActivate(contextOf())).resolves.toBe(true);
      const refused = guardFor([]).canActivate(contextOf());
      await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refused).rejects.toMatchObject({ response: { code: 'NO_PERMISSION', details: { missing: ['inventory.products.view'] } } });
    });
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
