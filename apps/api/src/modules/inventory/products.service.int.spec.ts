/**
 * Integration test against the real Postgres (DATABASE_URL). Creates two throw-away companies
 * and removes them at the end, so it is safe to run against the dev database.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { ProductsService } from './products.service';

const base = new PrismaClient();
const run = randomUUID().slice(0, 8);

interface Fixture {
  companyId: string;
  branchA: string;
  branchB: string;
  whA: string;
  whB: string;
  countrySE: string;
  countryJP: string;
  brandSKF: string;
  brandNSK: string;
  rootBearings: string;
  subBalls: string;
  rootSeals: string;
  limitedMembership: string;
  fullMembership: string;
}

let current: string | null = null;
let membershipId: string | null = null;
const prisma = { tenant: base.$extends(tenantExtension(() => current)), user: base.user } as unknown as PrismaService;
const cls = { get: (k: string) => (k === 'membershipId' ? membershipId : null) } as never;
const service = new ProductsService(prisma, cls);

async function createCompany(tag: string): Promise<Fixture> {
  const company = await base.company.create({
    data: { slug: `it-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `${tag}${run}`.slice(0, 20) },
  });
  const companyId = company.id;
  const [a, b] = await Promise.all(
    [0, 1].map((code) => base.branch.create({ data: { companyId, code, name: `B${code}` } })),
  );
  const [whA, whB] = await Promise.all([
    base.warehouse.create({ data: { companyId, branchId: a.id, code: `A-${run}`, name: 'A' } }),
    base.warehouse.create({ data: { companyId, branchId: b.id, code: `B-${run}`, name: 'B' } }),
  ]);
  const [se, jp] = await Promise.all([
    base.country.create({ data: { companyId, code: 'SE', name: 'Suecia' } }),
    base.country.create({ data: { companyId, code: 'JP', name: 'Japón' } }),
  ]);
  const [skf, nsk] = await Promise.all([
    base.brand.create({ data: { companyId, name: 'SKF', countryId: se.id } }),
    base.brand.create({ data: { companyId, name: 'NSK', countryId: jp.id } }),
  ]);
  const bearings = await base.category.create({ data: { companyId, name: 'Rodamientos' } });
  const seals = await base.category.create({ data: { companyId, name: 'Retenes' } });
  const balls = await base.category.create({ data: { companyId, name: 'Bolas', parentId: bearings.id } });

  const role = await base.role.create({ data: { companyId, key: 'it', name: 'it' } });
  const user = await base.user.create({ data: { email: `it-${tag}-${run}@test.local`, name: 'it' } });
  const full = await base.membership.create({ data: { companyId, userId: user.id, roleId: role.id, allBranches: true } });
  const user2 = await base.user.create({ data: { email: `it2-${tag}-${run}@test.local`, name: 'it2' } });
  const limited = await base.membership.create({
    data: { companyId, userId: user2.id, roleId: role.id, branches: { create: [{ branchId: a.id }] } },
  });

  return {
    companyId,
    branchA: a.id,
    branchB: b.id,
    whA: whA.id,
    whB: whB.id,
    countrySE: se.id,
    countryJP: jp.id,
    brandSKF: skf.id,
    brandNSK: nsk.id,
    rootBearings: bearings.id,
    subBalls: balls.id,
    rootSeals: seals.id,
    limitedMembership: limited.id,
    fullMembership: full.id,
  };
}

async function removeCompany(companyId: string) {
  await base.stockLevel.deleteMany({ where: { companyId } });
  await base.stockThreshold.deleteMany({ where: { companyId } });
  await base.productDimension.deleteMany({ where: { companyId } });
  await base.product.deleteMany({ where: { companyId } });
  await base.attributeDefinition.deleteMany({ where: { companyId } });
  await base.category.deleteMany({ where: { companyId, parentId: { not: null } } });
  await base.category.deleteMany({ where: { companyId } });
  await base.brand.deleteMany({ where: { companyId } });
  await base.country.deleteMany({ where: { companyId } });
  const memberships = await base.membership.findMany({ where: { companyId }, select: { id: true, userId: true } });
  await base.membershipBranch.deleteMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  await base.membership.deleteMany({ where: { companyId } });
  await base.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
  await base.role.deleteMany({ where: { companyId } });
  await base.warehouse.deleteMany({ where: { companyId } });
  await base.branch.deleteMany({ where: { companyId } });
  await base.company.delete({ where: { id: companyId } });
}

describe('ProductsService (integration, real Postgres)', () => {
  let a: Fixture;
  let b: Fixture;
  let p1: string;

  beforeAll(async () => {
    a = await createCompany('a');
    b = await createCompany('b');

    const mk = (code: string, brandId: string, categoryId: string, extra: object = {}) =>
      base.product.create({
        data: {
          companyId: a.companyId,
          sku: `RL-${code}`,
          manufacturerCode: code,
          brandId,
          categoryId,
          name: `Producto ${code}`,
          salePrice: '123.50',
          cost: '70.1234',
          photos: ['https://img.test/p.png'],
          ...extra,
        },
      });
    const x1 = await mk('6205', a.brandSKF, a.subBalls, {
      dimensions: { create: { companyId: a.companyId, innerDiameter: 25, outerDiameter: 52, width: 15 } },
    });
    p1 = x1.id;
    const x2 = await mk('6206', a.brandNSK, a.subBalls, { status: 'INACTIVE' });
    const x3 = await mk('RET1', a.brandSKF, a.rootSeals);
    const x4 = await mk('NU206', a.brandNSK, a.rootBearings);
    await base.stockLevel.createMany({
      data: [
        { companyId: a.companyId, productId: x1.id, warehouseId: a.whA, quantity: 10 },
        { companyId: a.companyId, productId: x1.id, warehouseId: a.whB, quantity: 5 },
        { companyId: a.companyId, productId: x2.id, warehouseId: a.whB, quantity: 7 },
        { companyId: a.companyId, productId: x3.id, warehouseId: a.whA, quantity: 1 },
        { companyId: a.companyId, productId: x4.id, warehouseId: a.whA, quantity: 2 },
      ],
    });
    await base.product.create({
      data: {
        companyId: b.companyId,
        sku: 'RL-B1',
        manufacturerCode: 'OTHER',
        brandId: b.brandSKF,
        categoryId: b.rootSeals,
        name: 'De otra empresa',
        salePrice: '1',
      },
    });
  }, 60_000);

  afterAll(async () => {
    await removeCompany(a.companyId);
    await removeCompany(b.companyId);
    await base.$disconnect();
  }, 60_000);

  beforeEach(() => {
    current = a.companyId;
    membershipId = a.fullMembership;
  });

  it('returns the list item shape without exposing cost', async () => {
    const res = await service.list({ branchId: a.branchA });
    const item = res.items.find((i) => i.id === p1)!;
    expect(item).toMatchObject({
      sku: 'RL-6205',
      manufacturerCode: '6205',
      photoUrl: 'https://img.test/p.png',
      brand: { name: 'SKF', logoUrl: null },
      country: { code: 'SE' },
      category: { name: 'Rodamientos' },
      subcategory: { name: 'Bolas' },
      salePrice: '123.50',
      status: 'ACTIVE',
    });
    expect(item.dimensions).toEqual({ innerDiameter: '25', outerDiameter: '52', width: '15' });
    expect(JSON.stringify(res)).not.toContain('70.12');
    expect(item).not.toHaveProperty('cost');
  });

  it('computes total stock and stock of the selected branch', async () => {
    const atA = (await service.list({ branchId: a.branchA })).items.find((i) => i.id === p1)!;
    expect([atA.totalStock, atA.branchStock]).toEqual([15, 10]);
    const atB = (await service.list({ branchId: a.branchB })).items.find((i) => i.id === p1)!;
    expect([atB.totalStock, atB.branchStock]).toEqual([15, 5]);
  });

  it('leaves branchStock null when no branch is selected', async () => {
    const res = await service.list({});
    expect(res.items.every((i) => i.branchStock === null)).toBe(true);
    expect(res.items.find((i) => i.id === p1)!.totalStock).toBe(15);
  });

  it('filters by industry (country of the brand)', async () => {
    const res = await service.list({ countryId: a.countryJP });
    expect(res.items.map((i) => i.manufacturerCode).sort()).toEqual(['6206', 'NU206']);
  });

  it('filters by brand and by status', async () => {
    expect((await service.list({ brandId: a.brandSKF })).total).toBe(2);
    expect((await service.list({ status: 'INACTIVE' })).items.map((i) => i.manufacturerCode)).toEqual(['6206']);
  });

  it('a root category includes its subcategories; a subcategory narrows it', async () => {
    const root = await service.list({ categoryId: a.rootBearings });
    expect(root.items.map((i) => i.manufacturerCode).sort()).toEqual(['6205', '6206', 'NU206']);
    const sub = await service.list({ categoryId: a.rootBearings, subcategoryId: a.subBalls });
    expect(sub.items.map((i) => i.manufacturerCode).sort()).toEqual(['6205', '6206']);
  });

  it('combines filters with AND', async () => {
    const res = await service.list({ categoryId: a.rootBearings, countryId: a.countryJP, status: 'ACTIVE' });
    expect(res.items.map((i) => i.manufacturerCode)).toEqual(['NU206']);
  });

  it('searches by code, brand, name and measurement', async () => {
    const codes = async (search: string) =>
      (await service.list({ search })).items.map((i) => i.manufacturerCode).sort();
    expect(await codes('6205')).toEqual(['6205']);
    expect(await codes('nsk')).toEqual(['6206', 'NU206']);
    expect(await codes('Producto RET')).toEqual(['RET1']);
    expect(await codes('25x52x15')).toEqual(['6205']);
    expect(await codes('25 × 52 × 15 mm')).toEqual(['6205']);
    expect(await codes('99x99x99')).toEqual([]);
  });

  it('reports no results without claiming the catalog is empty', async () => {
    const res = await service.list({ brandId: randomUUID() });
    expect(res).toMatchObject({ total: 0, items: [], catalogEmpty: false });
  });

  it('flags an empty catalog (first use)', async () => {
    current = b.companyId;
    await base.product.deleteMany({ where: { companyId: b.companyId } });
    expect((await service.list({})).catalogEmpty).toBe(true);
  });

  it('never leaks products of another company', async () => {
    current = b.companyId;
    await base.product.create({
      data: {
        companyId: b.companyId,
        sku: 'RL-B2',
        manufacturerCode: 'B-ONLY',
        brandId: b.brandSKF,
        categoryId: b.rootSeals,
        name: 'Solo B',
        salePrice: '2',
      },
    });
    const res = await service.list({});
    expect(res.items.map((i) => i.manufacturerCode)).toEqual(['B-ONLY']);
  });

  it('rejects a branch of another company and one the member cannot operate', async () => {
    await expect(service.list({ branchId: b.branchA })).rejects.toBeInstanceOf(NotFoundException);
    membershipId = a.limitedMembership;
    await expect(service.list({ branchId: a.branchB })).rejects.toMatchObject({ response: { code: 'BRANCH_NOT_ALLOWED' } });
    await expect(service.list({ branchId: a.branchB })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.list({ branchId: a.branchA })).resolves.toBeDefined();
  });

  it('lists filter options of the company only', async () => {
    const o = await service.filterOptions();
    expect(o.countries.map((c) => c.code).sort()).toEqual(['JP', 'SE']);
    expect(o.brands.map((x) => x.name)).toEqual(['NSK', 'SKF']);
    expect(o.categories.find((c) => c.name === 'Rodamientos')!.subcategories.map((s) => s.name)).toEqual(['Bolas']);
  });

  describe('detail (product sheet)', () => {
    let creator: string;

    beforeAll(async () => {
      await base.attributeDefinition.createMany({
        data: [
          { companyId: a.companyId, categoryId: a.rootBearings, key: 'seal', label: 'Sello', type: 'ENUM', step: 1 },
          { companyId: a.companyId, categoryId: a.rootBearings, key: 'series', label: 'Serie', type: 'TEXT', step: 0 },
          { companyId: a.companyId, categoryId: a.rootBearings, key: 'rows', label: 'Hileras', type: 'NUMBER', step: 2 },
        ],
      });
      const user = await base.user.create({ data: { email: `creator-${run}@test.local`, name: 'Ana Rojas' } });
      creator = user.id;
      await base.product.update({
        where: { id: p1 },
        data: { attributes: { seal: '2RS', series: '62', tariffCode: '8482.10' }, createdById: creator, updatedById: creator },
      });
      await base.stockThreshold.create({
        data: { companyId: a.companyId, productId: p1, branchId: a.branchA, minStock: 12, maxStock: 60, location: 'A-03-2' },
      });
    });

    afterAll(async () => {
      await base.product.update({ where: { id: p1 }, data: { createdById: null, updatedById: null } });
      await base.user.delete({ where: { id: creator } });
    });

    it('returns identity, dimensions, industry and authorship', async () => {
      const d = await service.detail(p1, false);
      expect(d).toMatchObject({
        sku: 'RL-6205',
        manufacturerCode: '6205',
        brand: { name: 'SKF' },
        country: { code: 'SE' },
        category: { name: 'Rodamientos' },
        subcategory: { name: 'Bolas' },
        photos: ['https://img.test/p.png'],
        createdBy: { name: 'Ana Rojas' },
        updatedBy: { name: 'Ana Rojas' },
        extra: { tariffCode: '8482.10', supplierName: null, sectors: null },
      });
      expect(d.dimensions).toMatchObject({ innerDiameter: '25', outerDiameter: '52', width: '15', weight: null });
    });

    it("lists the specs in definition order using the parent category's definitions", async () => {
      const d = await service.detail(p1, false);
      expect(d.specs.map((s) => [s.key, s.value])).toEqual([
        ['series', '62'],
        ['seal', '2RS'],
        ['rows', null],
      ]);
      expect(d.specs.map((s) => s.step)).toEqual([0, 1, 2]);
    });

    it('aggregates stock per branch across warehouses with the branch thresholds', async () => {
      const d = await service.detail(p1, false);
      expect(d.totalStock).toBe(15);
      expect(d.stockByBranch).toEqual([
        { branchId: a.branchA, branchName: 'B0', warehouses: ['A'], quantity: 10, minStock: 12, maxStock: 60, location: 'A-03-2', availability: 'low' },
        { branchId: a.branchB, branchName: 'B1', warehouses: ['B'], quantity: 5, minStock: null, maxStock: null, location: null, availability: 'available' },
      ]);
    });

    it('hides cost and margin without inventory.costs.view and shows them with it', async () => {
      const without = await service.detail(p1, false);
      expect(without.pricing).toEqual({ salePrice: '123.50' });
      expect(JSON.stringify(without)).not.toContain('70.12');
      const withCost = await service.detail(p1, true);
      expect(withCost.pricing).toEqual({ salePrice: '123.50', cost: '70.1234', marginPercent: '43.2' });
    });

    it('shows only the branches a limited member may operate', async () => {
      membershipId = a.limitedMembership;
      const d = await service.detail(p1, false);
      expect(d.stockByBranch.map((s) => s.branchId)).toEqual([a.branchA]);
      // the total never includes branches the member cannot see
      expect(d.totalStock).toBe(10);
    });

    it("answers 404 for a missing product or another company's", async () => {
      const foreign = await base.product.findFirstOrThrow({ where: { companyId: b.companyId } });
      await expect(service.detail(foreign.id, true)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.detail(randomUUID(), true)).rejects.toBeInstanceOf(NotFoundException);
    });

    it("falls back to the brand's country when the product has none, and prefers its own", async () => {
      expect((await service.detail(p1, false)).country?.code).toBe('SE');
      await base.product.update({ where: { id: p1 }, data: { countryId: a.countryJP } });
      expect((await service.detail(p1, false)).country?.code).toBe('JP');
      await base.product.update({ where: { id: p1 }, data: { countryId: null } });
    });
  });

  describe('pagination with thousands of products', () => {
    beforeAll(async () => {
      const data = Array.from({ length: 5000 }, (_, i) => ({
        companyId: a.companyId,
        sku: `BULK-${i}`,
        manufacturerCode: `BULK-${i}`,
        brandId: a.brandSKF,
        categoryId: a.subBalls,
        name: `Bulk ${i}`,
        salePrice: '10.00',
      }));
      await base.product.createMany({ data });
    }, 60_000);

    it('pages through the catalog without duplicates and clamps the page size', async () => {
      const first = await service.list({ page: 1, pageSize: 100 });
      const second = await service.list({ page: 2, pageSize: 100 });
      expect(first.total).toBe(5004);
      expect(first.items).toHaveLength(100);
      const ids = new Set([...first.items, ...second.items].map((i) => i.id));
      expect(ids.size).toBe(200);
      expect((await service.list({ pageSize: 9999 })).pageSize).toBe(100);
      expect((await service.list({ page: 51, pageSize: 100 })).items).toHaveLength(4);
    });
  });
});
