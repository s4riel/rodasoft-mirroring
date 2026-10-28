/**
 * Integration test against the real Postgres (DATABASE_URL). Creates throw-away companies and removes them at the
 * end, so it is safe to run against the dev database.
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { StockQueriesService } from './stock-queries.service';

const base = new PrismaClient();
const run = randomUUID().slice(0, 8);
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);

let current: string | null = null;
let membershipId: string | null = null;
const prisma = { tenant: base.$extends(tenantExtension(() => current)), user: base.user } as unknown as PrismaService;
const cls = { get: (k: string) => (k === 'membershipId' ? membershipId : null) } as never;
const service = new StockQueriesService(prisma, cls);

interface Fixture {
  companyId: string;
  branchA: string;
  branchB: string;
  whA: string;
  whB: string;
  whA2: string;
  productId: string;
  fullMembership: string;
  limitedMembership: string;
}

/** Purges the movements of a company. The immutability trigger blocks DELETE, so the cleanup bypasses it in its own transaction. */
async function purgeMovements(companyId: string) {
  await base.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.stockMovement.deleteMany({ where: { companyId } });
  });
}

async function createProduct(companyId: string, code: string) {
  const brand = await base.brand.create({ data: { companyId, name: `Brand ${code}` } });
  const category = await base.category.create({ data: { companyId, name: `Cat ${code}` } });
  const product = await base.product.create({
    data: {
      companyId,
      sku: `RL-${code}`,
      manufacturerCode: code,
      brandId: brand.id,
      categoryId: category.id,
      name: code,
      salePrice: '10.00',
    },
  });
  return product.id;
}

async function createCompany(tag: string): Promise<Fixture> {
  const company = await base.company.create({
    data: { slug: `st-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `${tag}${run}`.slice(0, 20) },
  });
  const companyId = company.id;
  const [a, b] = await Promise.all(
    [0, 1].map((code) => base.branch.create({ data: { companyId, code, name: `B${code}` } })),
  );
  const [whA, whA2, whB] = await Promise.all([
    base.warehouse.create({ data: { companyId, branchId: a.id, code: `A-01-${run}`, name: 'A', isMain: true } }),
    base.warehouse.create({ data: { companyId, branchId: a.id, code: `A-02-${run}`, name: 'A2' } }),
    base.warehouse.create({ data: { companyId, branchId: b.id, code: `B-01-${run}`, name: 'B' } }),
  ]);
  const role = await base.role.create({ data: { companyId, key: 'it', name: 'it' } });
  const user = await base.user.create({ data: { email: `st-${tag}-${run}@test.local`, name: 'it' } });
  const full = await base.membership.create({ data: { companyId, userId: user.id, roleId: role.id, allBranches: true } });
  const user2 = await base.user.create({ data: { email: `st2-${tag}-${run}@test.local`, name: 'it2' } });
  const limited = await base.membership.create({
    data: { companyId, userId: user2.id, roleId: role.id, branches: { create: [{ branchId: a.id }] } },
  });
  const productId = await createProduct(companyId, `P-${tag}`);
  return {
    companyId,
    branchA: a.id,
    branchB: b.id,
    whA: whA.id,
    whA2: whA2.id,
    whB: whB.id,
    productId,
    fullMembership: full.id,
    limitedMembership: limited.id,
  };
}

async function removeCompany(companyId: string) {
  await purgeMovements(companyId);
  await base.stockLevel.deleteMany({ where: { companyId } });
  await base.stockThreshold.deleteMany({ where: { companyId } });
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

describe('StockQueriesService (integration, real Postgres)', () => {
  let a: Fixture;
  let b: Fixture;

  beforeAll(async () => {
    a = await createCompany('a');
    b = await createCompany('b');

    // whA: +10 forty days ago (outside the window), -4 sale 20 days ago → balance 6
    // whB: +5 transfer in 5 days ago, -1 transfer out yesterday → balance 4
    await base.stockMovement.createMany({
      data: [
        { companyId: a.companyId, productId: a.productId, warehouseId: a.whA, type: 'INITIAL', quantity: 10, balanceAfter: 10, createdAt: daysAgo(40) },
        { companyId: a.companyId, productId: a.productId, warehouseId: a.whA, type: 'SALE', quantity: -4, balanceAfter: 6, refType: 'SALE', refNumber: 'V-00231', createdAt: daysAgo(20) },
        { companyId: a.companyId, productId: a.productId, warehouseId: a.whB, type: 'TRANSFER_IN', quantity: 5, balanceAfter: 5, refType: 'TRANSFER', refNumber: 'TR-0045', createdAt: daysAgo(5) },
        { companyId: a.companyId, productId: a.productId, warehouseId: a.whB, type: 'TRANSFER_OUT', quantity: -1, balanceAfter: 4, refType: 'TRANSFER', refNumber: 'TR-0046', createdAt: daysAgo(1) },
      ],
    });
    await base.stockLevel.createMany({
      data: [
        { companyId: a.companyId, productId: a.productId, warehouseId: a.whA, quantity: 6 },
        { companyId: a.companyId, productId: a.productId, warehouseId: a.whB, quantity: 4 },
      ],
    });
    await base.stockThreshold.create({
      data: { companyId: a.companyId, productId: a.productId, warehouseId: a.whA, minStock: 6, maxStock: 60, location: 'A-03-2' },
    });
  });

  afterAll(async () => {
    await removeCompany(a.companyId);
    await removeCompany(b.companyId);
    await base.$disconnect();
  });

  const useCompany = (membership: string) => {
    current = a.companyId;
    membershipId = membership;
  };

  describe('movements', () => {
    it('lists movements newest first with the balance after each one', async () => {
      useCompany(a.fullMembership);
      const r = await service.movements(a.productId, {});
      expect(r.total).toBe(4);
      expect(r.items.map((m) => [m.type, m.quantity, m.balanceAfter, m.warehouse.name])).toEqual([
        ['TRANSFER_OUT', -1, 4, 'B'],
        ['TRANSFER_IN', 5, 5, 'B'],
        ['SALE', -4, 6, 'A'],
        ['INITIAL', 10, 10, 'A'],
      ]);
      expect(r.items[0]).toMatchObject({
        document: { refType: 'TRANSFER', refNumber: 'TR-0046' },
        branch: { name: 'B1' },
      });
      expect(JSON.stringify(r)).not.toContain('unitCost');
    });

    it('paginates', async () => {
      useCompany(a.fullMembership);
      const r = await service.movements(a.productId, { page: 2, pageSize: 2 });
      expect(r.items.map((m) => m.type)).toEqual(['SALE', 'INITIAL']);
      expect(r.total).toBe(4);
    });

    it('sums the inflows and outflows of the window and the current balance', async () => {
      useCompany(a.fullMembership);
      const r = await service.movements(a.productId, {});
      // the +10 of forty days ago is outside the 30-day window
      expect(r.summary).toEqual({ inLast30Days: 5, outLast30Days: 5, currentBalance: 10 });
    });

    it('widens the window with the days parameter', async () => {
      useCompany(a.fullMembership);
      const r = await service.movements(a.productId, { days: 60 });
      expect(r.summary).toEqual({ inLast30Days: 15, outLast30Days: 5, currentBalance: 10 });
    });

    it('keeps the balance after each movement consistent with the level of its warehouse', async () => {
      useCompany(a.fullMembership);
      const r = await service.movements(a.productId, {});
      for (const warehouse of ['A', 'B']) {
        const rows = r.items.filter((m) => m.warehouse.name === warehouse);
        const level = await base.stockLevel.findFirstOrThrow({
          where: { productId: a.productId, warehouse: { name: warehouse, companyId: a.companyId } },
        });
        expect(rows[0].balanceAfter).toBe(level.quantity);
      }
    });

    it('filters by branch and rejects a branch the member cannot operate', async () => {
      useCompany(a.fullMembership);
      expect((await service.movements(a.productId, { branchId: a.branchB })).total).toBe(2);
      useCompany(a.limitedMembership);
      await expect(service.movements(a.productId, { branchId: a.branchB })).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('shows only the branches a limited member may operate, in the list and in the summary', async () => {
      useCompany(a.limitedMembership);
      const r = await service.movements(a.productId, {});
      expect(r.items.every((m) => m.warehouse.name === 'A')).toBe(true);
      expect(r.total).toBe(2);
      expect(r.summary).toEqual({ inLast30Days: 0, outLast30Days: 4, currentBalance: 6 });
    });

    it("answers 404 for another company's product and for an unknown branch", async () => {
      useCompany(a.fullMembership);
      await expect(service.movements(b.productId, {})).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.movements(a.productId, { branchId: randomUUID() })).rejects.toMatchObject({
        response: { code: 'BRANCH_NOT_FOUND' },
      });
    });
  });

  describe('stock per warehouse', () => {
    it('returns one row per warehouse with stock or thresholds, with the thresholds joined', async () => {
      useCompany(a.fullMembership);
      const r = await service.stockByWarehouse(a.productId);
      expect(r.items).toEqual([
        {
          branch: { id: a.branchA, name: 'B0' },
          warehouse: { id: a.whA, name: 'A' },
          location: 'A-03-2',
          quantity: 6,
          inTransit: 0,
          minStock: 6,
          maxStock: 60,
          availability: 'low',
        },
        {
          branch: { id: a.branchB, name: 'B1' },
          warehouse: { id: a.whB, name: 'B' },
          location: null,
          quantity: 4,
          inTransit: 0,
          minStock: null,
          maxStock: null,
          availability: 'available',
        },
      ]);
      expect(r.total).toBe(10);
    });

    it('leaves out warehouses with neither stock nor thresholds', async () => {
      useCompany(a.fullMembership);
      const r = await service.stockByWarehouse(a.productId);
      expect(r.items.map((i) => i.warehouse.id)).not.toContain(a.whA2);
    });

    it('shows only the warehouses of the branches a limited member may operate', async () => {
      useCompany(a.limitedMembership);
      const r = await service.stockByWarehouse(a.productId);
      expect(r.items.map((i) => i.warehouse.name)).toEqual(['A']);
      expect(r.total).toBe(6);
    });

    it("answers 404 for another company's product", async () => {
      useCompany(a.fullMembership);
      await expect(service.stockByWarehouse(b.productId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('immutability', () => {
    it('rejects UPDATE and DELETE on stock_movements', async () => {
      await expect(
        base.$executeRaw`UPDATE stock_movements SET quantity = 0 WHERE company_id = ${a.companyId}::uuid`,
      ).rejects.toThrow(/immutable/);
      await expect(
        base.$executeRaw`DELETE FROM stock_movements WHERE company_id = ${a.companyId}::uuid`,
      ).rejects.toThrow(/immutable/);
      expect(await base.stockMovement.count({ where: { companyId: a.companyId } })).toBe(4);
    });
  });
});
