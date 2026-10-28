/**
 * Integration test of the warehouses service (HU-INV-17) against the real Postgres (DATABASE_URL): list, create and edit,
 * the one-main-per-branch rule (also under concurrency), the deactivation rules, branch scoping and tenant isolation.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import { StockMovementService } from './stock-movement.service';
import { WarehousesService } from './warehouses.service';

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
const service = new WarehousesService(prisma, cls, new AuditService(prisma, cls), new OutboxService(prisma, cls));

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

describe('WarehousesService (integration, real Postgres)', () => {
  let companyId: string;
  let otherCompanyId: string;
  let branchA: string;
  let branchB: string;
  let branchInactive: string;
  let otherBranch: string;
  let userId: string;
  let allMembership: string;
  let restrictedMembership: string;
  let otherMembership: string;
  let productId: string;
  let seq = 0;

  /** A fresh branch, so each test starts with no warehouses in it. */
  async function newBranch(): Promise<string> {
    seq += 1;
    return (await base.branch.create({ data: { companyId, code: 100 + seq, name: `Branch ${seq}` } })).id;
  }

  const create = (branchId: string, code: string, extra: Record<string, unknown> = {}) =>
    service.create({ code, name: `Warehouse ${code}`, branchId, ...extra });

  const mains = (branchId: string) => base.warehouse.findMany({ where: { branchId, isMain: true, status: 'ACTIVE' }, select: { code: true } });

  async function putStock(warehouseId: string, quantity: number) {
    await base.tenant.$transaction((tx) =>
      new StockMovementService(cls, new SettingsService(prisma)).apply(tx, { productId, warehouseId, type: 'INITIAL', quantity, reason: 'Initial load' }),
    );
  }

  beforeAll(async () => {
    const company = await base.company.create({ data: { slug: `wh-${run}`, legalName: 'wh', tradeName: 'wh', nit: `W${run}`.slice(0, 20) } });
    const other = await base.company.create({ data: { slug: `wh2-${run}`, legalName: 'wh2', tradeName: 'wh2', nit: `X${run}`.slice(0, 20) } });
    companyId = company.id;
    otherCompanyId = other.id;
    current = companyId;
    branchA = (await base.branch.create({ data: { companyId, code: 0, name: 'Branch A' } })).id;
    branchB = (await base.branch.create({ data: { companyId, code: 1, name: 'Branch B' } })).id;
    branchInactive = (await base.branch.create({ data: { companyId, code: 2, name: 'Branch closed', status: 'INACTIVE' } })).id;
    otherBranch = (await base.branch.create({ data: { companyId: otherCompanyId, code: 0, name: 'Other company branch' } })).id;

    const country = await base.country.create({ data: { companyId, code: 'SE', name: 'Suecia' } });
    const brand = await base.brand.create({ data: { companyId, name: `Marca ${run}`, countryId: country.id } });
    const category = await base.category.create({ data: { companyId, name: `Cat ${run}` } });
    productId = (
      await base.product.create({
        data: { companyId, sku: `WH-${run}`, manufacturerCode: `WH-${run}`, brandId: brand.id, categoryId: category.id, name: 'Stock holder', salePrice: '10.00' },
      })
    ).id;

    const role = await base.role.create({ data: { companyId, key: 'warehouse', name: 'Almacén' } });
    userId = (await base.user.create({ data: { email: `wh-${run}@example.com`, name: 'Manager' } })).id;
    const restrictedUser = await base.user.create({ data: { email: `wh2-${run}@example.com`, name: 'Restricted' } });
    allMembership = (await base.membership.create({ data: { companyId, userId, roleId: role.id, allBranches: true } })).id;
    restrictedMembership = (
      await base.membership.create({ data: { companyId, userId: restrictedUser.id, roleId: role.id, branches: { create: { branchId: branchA } } } })
    ).id;
    const otherRole = await base.role.create({ data: { companyId: otherCompanyId, key: 'warehouse', name: 'Almacén' } });
    otherMembership = (await base.membership.create({ data: { companyId: otherCompanyId, userId, roleId: otherRole.id, allBranches: true } })).id;
    currentMembership = allMembership;
    currentUser = userId;
  });

  afterAll(async () => {
    await purgeMovements([companyId]);
    await base.outboxEvent.deleteMany({ where: { companyId } });
    await base.auditLog.deleteMany({ where: { companyId } });
    await base.stockLevel.deleteMany({ where: { companyId } });
    await base.product.deleteMany({ where: { companyId } });
    await base.membership.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await base.user.deleteMany({ where: { email: { in: [`wh-${run}@example.com`, `wh2-${run}@example.com`] } } });
    await base.role.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await base.category.deleteMany({ where: { companyId } });
    await base.brand.deleteMany({ where: { companyId } });
    await base.warehouse.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await base.branch.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await base.country.deleteMany({ where: { companyId } });
    await base.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await base.$disconnect();
  });

  beforeEach(() => {
    current = companyId;
    currentMembership = allMembership;
  });

  describe('create', () => {
    it('makes the first warehouse of a branch its main one, and audits it', async () => {
      const branchId = await newBranch();
      const { warehouse, demotedMain } = await create(branchId, 'N-01', { isMain: false, locationNote: 'Calle 1' });

      expect(demotedMain).toBeNull();
      expect(warehouse).toMatchObject({ code: 'N-01', isMain: true, visibleInStore: true, status: 'ACTIVE', locationNote: 'Calle 1', hasMovements: false, totalUnits: 0 });
      const audit = await base.auditLog.findFirstOrThrow({ where: { companyId, action: 'inventory.warehouse.create', entityId: warehouse.id } });
      expect(audit).toMatchObject({ entity: 'Warehouse', userId });
      expect(audit.after).toMatchObject({ code: 'N-01', isMain: true, branchId });
      expect(await base.outboxEvent.count({ where: { companyId, type: 'inventory.warehouse.changed', payload: { path: ['warehouseId'], equals: warehouse.id } } })).toBe(1);
    });

    it('adds a secondary warehouse without touching the main one', async () => {
      const branchId = await newBranch();
      await create(branchId, 'S-01');
      const { warehouse, demotedMain } = await create(branchId, 'S-02');

      expect(demotedMain).toBeNull();
      expect(warehouse.isMain).toBe(false);
      expect(await mains(branchId)).toEqual([{ code: 'S-01' }]);
    });

    it('moves the main flag when the new warehouse is created as main', async () => {
      const branchId = await newBranch();
      const first = await create(branchId, 'M-01');
      const { warehouse, demotedMain } = await create(branchId, 'M-02', { isMain: true });

      expect(warehouse.isMain).toBe(true);
      expect(demotedMain).toEqual({ id: first.warehouse.id, code: 'M-01' });
      expect(await mains(branchId)).toEqual([{ code: 'M-02' }]);
    });

    it('refuses a duplicate code with a 409, and leaves nothing behind', async () => {
      const branchId = await newBranch();
      await create(branchId, 'D-01');
      const before = await base.auditLog.count({ where: { companyId, action: 'inventory.warehouse.create' } });

      expect(await codeOf(create(branchId, 'D-01'))).toBe('WAREHOUSE_CODE_EXISTS');
      expect(await codeOf(create(await newBranch(), 'D-01'))).toBe('WAREHOUSE_CODE_EXISTS');
      expect(await base.auditLog.count({ where: { companyId, action: 'inventory.warehouse.create' } })).toBe(before);
    });

    it('accepts the same code in another company', async () => {
      await create(await newBranch(), 'X-01');
      current = otherCompanyId;
      currentMembership = otherMembership;
      const { warehouse } = await service.create({ code: 'X-01', name: 'Other', branchId: otherBranch });
      expect(warehouse.code).toBe('X-01');
    });

    it('rejects an unknown, inactive or foreign branch with BRANCH_INVALID', async () => {
      expect(await codeOf(create(branchInactive, 'I-01'))).toBe('BRANCH_INVALID');
      expect(await codeOf(create(randomUUID(), 'I-02'))).toBe('BRANCH_INVALID');
      expect(await codeOf(create(otherBranch, 'I-03'))).toBe('BRANCH_INVALID');
    });

    it('rejects a branch outside the member scope with BRANCH_FORBIDDEN', async () => {
      currentMembership = restrictedMembership;
      expect(await codeOf(create(branchB, 'F-01'))).toBe('BRANCH_FORBIDDEN');
      expect((await create(branchA, 'F-02')).warehouse.code).toBe('F-02');
    });

    it('leaves exactly one main when two first warehouses of an empty branch are created at once', async () => {
      const branchId = await newBranch();
      const results = await Promise.allSettled([create(branchId, 'C-01'), create(branchId, 'C-02', { isMain: true })]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await mains(branchId)).toHaveLength(1);
    });
  });

  describe('list and detail', () => {
    it('returns the row fields with the products and units in stock', async () => {
      const branchId = await newBranch();
      const { warehouse } = await create(branchId, 'L-01');
      await putStock(warehouse.id, 7);

      const { items } = await service.list({ branchId });
      expect(items).toEqual([
        {
          id: warehouse.id,
          code: 'L-01',
          name: 'Warehouse L-01',
          branch: { id: branchId, name: expect.any(String) },
          isMain: true,
          visibleInStore: true,
          status: 'ACTIVE',
          productCount: 1,
          totalUnits: 7,
        },
      ]);
    });

    it('filters by status and search, and paginates', async () => {
      const branchId = await newBranch();
      await create(branchId, 'P-01');
      const second = await create(branchId, 'P-02');
      await create(branchId, 'P-03');
      await service.update(second.warehouse.id, { status: 'INACTIVE' });

      expect((await service.list({ branchId, status: 'INACTIVE' })).items.map((i) => i.code)).toEqual(['P-02']);
      expect((await service.list({ branchId, q: 'p-03' })).items.map((i) => i.code)).toEqual(['P-03']);
      expect((await service.list({ branchId, q: 'warehouse p-0' })).total).toBe(3);

      const page2 = await service.list({ branchId, page: 2, pageSize: 2 });
      expect(page2).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page2.items.map((i) => i.code)).toEqual(['P-03']);
    });

    it('never lists another company, and limited members see only their branches', async () => {
      current = otherCompanyId;
      currentMembership = otherMembership;
      const foreign = (await service.create({ code: 'FOREIGN-1', name: 'Foreign', branchId: otherBranch })).warehouse;

      current = companyId;
      currentMembership = allMembership;
      await create(branchB, 'R-B1');
      await create(branchA, 'R-A1');
      const all = (await service.list({ pageSize: 100 })).items;
      expect(all.map((i) => i.id)).not.toContain(foreign.id);
      expect(all.map((i) => i.code)).toEqual(expect.arrayContaining(['R-A1', 'R-B1']));

      currentMembership = restrictedMembership;
      const scoped = (await service.list({ pageSize: 100 })).items;
      expect(scoped.map((i) => i.code)).toContain('R-A1');
      expect(scoped.map((i) => i.code)).not.toContain('R-B1');
      expect(await codeOf(service.list({ branchId: branchB }))).toBe('BRANCH_FORBIDDEN');
    });

    it('hides a warehouse of another company or of a branch outside the scope', async () => {
      const { warehouse } = await create(branchB, 'H-01');
      const detail = await service.detail(warehouse.id);
      expect(detail).toMatchObject({ id: warehouse.id, code: 'H-01', hasMovements: false });

      currentMembership = restrictedMembership;
      expect(await codeOf(service.detail(warehouse.id))).toBe('WAREHOUSE_NOT_FOUND');
      expect(await codeOf(service.update(warehouse.id, { name: 'x' }))).toBe('WAREHOUSE_NOT_FOUND');

      currentMembership = otherMembership;
      current = otherCompanyId;
      expect(await codeOf(service.detail(warehouse.id))).toBe('WAREHOUSE_NOT_FOUND');
    });
  });

  describe('update', () => {
    it('edits the fields, audits only what changed and publishes when the store sees a change', async () => {
      const branchId = await newBranch();
      const { warehouse } = await create(branchId, 'U-01');
      const outboxBefore = await base.outboxEvent.count({ where: { companyId, type: 'inventory.warehouse.changed' } });

      const renamed = await service.update(warehouse.id, { name: 'Renamed', code: 'U-09', locationNote: 'Piso 2', expectedUpdatedAt: warehouse.updatedAt });
      expect(renamed.warehouse).toMatchObject({ name: 'Renamed', code: 'U-09', locationNote: 'Piso 2' });
      expect(await base.outboxEvent.count({ where: { companyId, type: 'inventory.warehouse.changed' } })).toBe(outboxBefore);

      const hidden = await service.update(warehouse.id, { visibleInStore: false });
      expect(hidden.warehouse.visibleInStore).toBe(false);
      expect(await base.outboxEvent.count({ where: { companyId, type: 'inventory.warehouse.changed' } })).toBe(outboxBefore + 1);

      const audits = await base.auditLog.findMany({ where: { companyId, action: 'inventory.warehouse.update', entityId: warehouse.id }, orderBy: { createdAt: 'asc' } });
      expect(audits).toHaveLength(2);
      expect(audits[0]).toMatchObject({ before: { name: 'Warehouse U-01', code: 'U-01', locationNote: null }, after: { name: 'Renamed', code: 'U-09', locationNote: 'Piso 2' } });
      expect(audits[1]).toMatchObject({ before: { visibleInStore: true }, after: { visibleInStore: false } });
    });

    it('refuses a code that another warehouse uses', async () => {
      const branchId = await newBranch();
      await create(branchId, 'K-01');
      const { warehouse } = await create(branchId, 'K-02');
      expect(await codeOf(service.update(warehouse.id, { code: 'K-01' }))).toBe('WAREHOUSE_CODE_EXISTS');
    });

    it('answers WAREHOUSE_MODIFIED when the form is stale', async () => {
      const { warehouse } = await create(await newBranch(), 'V-01');
      await service.update(warehouse.id, { name: 'Edited elsewhere' });
      expect(await codeOf(service.update(warehouse.id, { name: 'Mine', expectedUpdatedAt: warehouse.updatedAt }))).toBe('WAREHOUSE_MODIFIED');
      expect((await service.detail(warehouse.id)).name).toBe('Edited elsewhere');
    });

    it('swaps the main warehouse in one step', async () => {
      const branchId = await newBranch();
      const first = await create(branchId, 'W-01');
      const second = await create(branchId, 'W-02');

      const { warehouse, demotedMain } = await service.update(second.warehouse.id, { isMain: true });
      expect(warehouse.isMain).toBe(true);
      expect(demotedMain).toEqual({ id: first.warehouse.id, code: 'W-01' });
      expect(await mains(branchId)).toEqual([{ code: 'W-02' }]);
    });

    it('does not let the main flag be removed without naming another main', async () => {
      const { warehouse } = await create(await newBranch(), 'Y-01');
      expect(await codeOf(service.update(warehouse.id, { isMain: false }))).toBe('WAREHOUSE_MAIN_REQUIRED');
      expect(await codeOf(service.update(warehouse.id, { isMain: true, status: 'INACTIVE' }))).toBe('WAREHOUSE_MAIN_REQUIRED');
    });

    it('does not make an inactive warehouse the main one', async () => {
      const branchId = await newBranch();
      await create(branchId, 'Z-01');
      const { warehouse } = await create(branchId, 'Z-02');
      expect(await codeOf(service.update(warehouse.id, { isMain: true, status: 'INACTIVE' }))).toBe('WAREHOUSE_MAIN_INACTIVE');
    });

    it('leaves exactly one main when two warehouses are set as main at the same time', async () => {
      const branchId = await newBranch();
      await create(branchId, 'G-01');
      const second = await create(branchId, 'G-02');
      const third = await create(branchId, 'G-03');

      const results = await Promise.allSettled([
        service.update(second.warehouse.id, { isMain: true }),
        service.update(third.warehouse.id, { isMain: true }),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await mains(branchId)).toHaveLength(1);
    });

    describe('against a stock movement in flight', () => {
      const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

      /** Holds a first movement into the warehouse uncommitted, runs `edit` meanwhile, then commits the movement. */
      async function editDuringMovement(warehouseId: string, edit: () => Promise<unknown>): Promise<string | null> {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const movement = base.tenant.$transaction(async (tx) => {
          await new StockMovementService(cls, new SettingsService(prisma)).apply(tx, { productId, warehouseId, type: 'INITIAL', quantity: 5, reason: 'Initial load' });
          await gate;
        });
        await sleep(300);
        const outcome = codeOf(edit());
        await sleep(300);
        release();
        await movement;
        return outcome;
      }

      it('waits for the movement and then refuses to deactivate a warehouse that now holds stock', async () => {
        const branchId = await newBranch();
        await create(branchId, 'R-01');
        const { warehouse } = await create(branchId, 'R-02');

        expect(await editDuringMovement(warehouse.id, () => service.update(warehouse.id, { status: 'INACTIVE' }))).toBe('WAREHOUSE_HAS_STOCK');
        expect(await base.warehouse.findUniqueOrThrow({ where: { id: warehouse.id } })).toMatchObject({ status: 'ACTIVE' });
        expect((await service.detail(warehouse.id)).totalUnits).toBe(5);
      });

      it('waits for the movement and then refuses to change the branch of a warehouse that now has movements', async () => {
        const branchId = await newBranch();
        const target = await newBranch();
        await create(branchId, 'R-10');
        const { warehouse } = await create(branchId, 'R-11');

        expect(await editDuringMovement(warehouse.id, () => service.update(warehouse.id, { branchId: target }))).toBe('WAREHOUSE_BRANCH_LOCKED');
        expect((await service.detail(warehouse.id)).branch.id).toBe(branchId);
      });

      it('makes a movement that starts after the deactivation fail instead of landing in the inactive warehouse', async () => {
        const branchId = await newBranch();
        await create(branchId, 'R-20');
        const { warehouse } = await create(branchId, 'R-21');
        await service.update(warehouse.id, { status: 'INACTIVE' });
        expect(await codeOf(putStock(warehouse.id, 1))).toBe('WAREHOUSE_INACTIVE');
      });
    });

    describe('branch', () => {
      it('can change while the warehouse has no movements', async () => {
        const from = await newBranch();
        const to = await newBranch();
        await create(from, 'B-01');
        const { warehouse } = await create(from, 'B-02');

        const moved = await service.update(warehouse.id, { branchId: to });
        expect(moved.warehouse.branch.id).toBe(to);
        // the first warehouse of the target branch becomes its main
        expect(moved.warehouse.isMain).toBe(true);
        expect(await mains(from)).toEqual([{ code: 'B-01' }]);
      });

      it('is locked once it has movements', async () => {
        const branchId = await newBranch();
        await create(branchId, 'B-10');
        const { warehouse } = await create(branchId, 'B-11');
        await putStock(warehouse.id, 1);

        expect(await codeOf(service.update(warehouse.id, { branchId: await newBranch() }))).toBe('WAREHOUSE_BRANCH_LOCKED');
        expect((await service.detail(warehouse.id)).hasMovements).toBe(true);
      });

      it('must be an active branch the member may operate', async () => {
        const { warehouse } = await create(await newBranch(), 'B-20');
        expect(await codeOf(service.update(warehouse.id, { branchId: branchInactive }))).toBe('BRANCH_INVALID');
        expect(await codeOf(service.update(warehouse.id, { branchId: otherBranch }))).toBe('BRANCH_INVALID');
      });

      it('cannot be changed on the main warehouse', async () => {
        const { warehouse } = await create(await newBranch(), 'B-30');
        expect(await codeOf(service.update(warehouse.id, { branchId: await newBranch() }))).toBe('WAREHOUSE_MAIN_REQUIRED');
      });
    });

    describe('deactivation', () => {
      it('is refused while the warehouse holds units', async () => {
        const branchId = await newBranch();
        await create(branchId, 'A-01');
        const { warehouse } = await create(branchId, 'A-02');
        await putStock(warehouse.id, 4);

        expect(await codeOf(service.update(warehouse.id, { status: 'INACTIVE' }))).toBe('WAREHOUSE_HAS_STOCK');
        expect((await service.detail(warehouse.id)).status).toBe('ACTIVE');
      });

      it('is refused for reserved or negative levels, which a plain sum would miss', async () => {
        const branchId = await newBranch();
        await create(branchId, 'A-30');
        const { warehouse } = await create(branchId, 'A-31');
        await base.stockLevel.create({ data: { companyId, productId, warehouseId: warehouse.id, quantity: 0, reserved: 2 } });
        expect(await codeOf(service.update(warehouse.id, { status: 'INACTIVE' }))).toBe('WAREHOUSE_HAS_STOCK');

        await base.stockLevel.updateMany({ where: { warehouseId: warehouse.id }, data: { quantity: -3, reserved: 0 } });
        expect(await codeOf(service.update(warehouse.id, { status: 'INACTIVE' }))).toBe('WAREHOUSE_HAS_STOCK');
      });

      it('cannot be undone while the branch is inactive', async () => {
        const branchId = await newBranch();
        await create(branchId, 'A-40');
        const { warehouse } = await create(branchId, 'A-41');
        await service.update(warehouse.id, { status: 'INACTIVE' });
        await base.branch.update({ where: { id: branchId }, data: { status: 'INACTIVE' } });
        expect(await codeOf(service.update(warehouse.id, { status: 'ACTIVE' }))).toBe('BRANCH_INVALID');
      });

      it('is refused on the main warehouse, even when empty', async () => {
        const branchId = await newBranch();
        const main = await create(branchId, 'A-10');
        await create(branchId, 'A-11');
        expect(await codeOf(service.update(main.warehouse.id, { status: 'INACTIVE' }))).toBe('WAREHOUSE_MAIN_REQUIRED');
      });

      it('works on an empty secondary warehouse, which stops receiving stock, and can be undone', async () => {
        const branchId = await newBranch();
        await create(branchId, 'A-20');
        const { warehouse } = await create(branchId, 'A-21');

        const off = await service.update(warehouse.id, { status: 'INACTIVE' });
        expect(off.warehouse.status).toBe('INACTIVE');
        expect(await codeOf(putStock(warehouse.id, 1))).toBe('WAREHOUSE_INACTIVE');
        expect(await base.outboxEvent.count({ where: { companyId, type: 'inventory.warehouse.changed', payload: { path: ['status'], equals: 'INACTIVE' } } })).toBeGreaterThan(0);

        const on = await service.update(warehouse.id, { status: 'ACTIVE' });
        expect(on.warehouse).toMatchObject({ status: 'ACTIVE', isMain: false });
      });
    });
  });
});
