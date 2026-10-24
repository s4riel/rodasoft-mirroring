/**
 * Integration test of deactivating and reactivating a product (HU-INV-09) against the real Postgres (DATABASE_URL).
 * Creates throw-away companies and removes them at the end, so it is safe to run against the dev database.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import type { ListProductsQueryDto } from './dto';
import { ProductCommandsService } from './product-commands.service';
import type { ProductWriteDto } from './product-write.dto';
import { ProductsService } from './products.service';
import { StockMovementService } from './stock-movement.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;
const memberships = new Map<string, { membershipId: string; userId: string }>();
const cls = {
  get: (k: string) => {
    const member = memberships.get(current ?? '');
    return k === 'companyId' ? current : k === 'membershipId' ? (member?.membershipId ?? null) : k === 'userId' ? (member?.userId ?? null) : null;
  },
} as never;
const membership = { permissions: async () => new Set(['inventory.costs.view']), operableBranchIds: async () => null } as never;
const settings = new SettingsService(prisma);
const stock = new StockMovementService(cls, settings);
const audit = new AuditService(prisma, cls);
const outbox = new OutboxService(prisma, cls);
const commands = new ProductCommandsService(prisma, cls, audit, membership, settings, stock, outbox);
const products = new ProductsService(prisma, cls);

interface Fixture {
  companyId: string;
  userId: string;
  branchId: string;
  warehouseId: string;
  brand: string;
  category: string;
}

async function createCompany(tag: string): Promise<Fixture> {
  const company = await base.company.create({
    data: { slug: `sts-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `S${tag}${run}`.slice(0, 20) },
  });
  const companyId = company.id;
  const branch = await base.branch.create({ data: { companyId, code: 0, name: 'Central' } });
  const warehouse = await base.warehouse.create({
    data: { companyId, branchId: branch.id, code: `W-${run}`, name: 'Principal', isMain: true },
  });
  const brand = await base.brand.create({ data: { companyId, name: 'SKF' } });
  const category = await base.category.create({ data: { companyId, name: 'Rodamientos' } });
  const role = await base.role.create({ data: { companyId, key: 'it', name: 'it' } });
  const user = await base.user.create({ data: { email: `sts-${tag}-${run}@test.local`, name: 'it' } });
  const member = await base.membership.create({ data: { companyId, userId: user.id, roleId: role.id, allBranches: true } });
  memberships.set(companyId, { membershipId: member.id, userId: user.id });
  return { companyId, userId: user.id, branchId: branch.id, warehouseId: warehouse.id, brand: brand.id, category: category.id };
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
  await base.outboxEvent.deleteMany({ where: { companyId } });
  await base.auditLog.deleteMany({ where: { companyId } });
  await base.companySetting.deleteMany({ where: { companyId } });
  await base.equivalence.deleteMany({ where: { companyId } });
  await base.stockThreshold.deleteMany({ where: { companyId } });
  await base.stockLevel.deleteMany({ where: { companyId } });
  await base.productDimension.deleteMany({ where: { companyId } });
  await base.product.deleteMany({ where: { companyId } });
  await base.category.deleteMany({ where: { companyId } });
  await base.brand.deleteMany({ where: { companyId } });
  await base.warehouse.deleteMany({ where: { companyId } });
  await base.branch.deleteMany({ where: { companyId } });
  const members = await base.membership.findMany({ where: { companyId }, select: { userId: true } });
  await base.membership.deleteMany({ where: { companyId } });
  await base.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) } } });
  await base.role.deleteMany({ where: { companyId } });
  await base.company.delete({ where: { id: companyId } });
}

/** Resolves to the error response body of a rejected call, or fails the test if the call succeeds. */
async function rejection(promise: Promise<unknown>): Promise<{ status: number; code: string; details?: unknown }> {
  try {
    await promise;
  } catch (err) {
    const e = err as { getStatus(): number; getResponse(): { code: string; details?: unknown } };
    return { status: e.getStatus(), code: e.getResponse().code, details: e.getResponse().details };
  }
  throw new Error('expected the call to be rejected');
}

describe('ProductCommandsService setStatus (integration, real Postgres)', () => {
  let a: Fixture;
  let b: Fixture;
  const write = (code: string, over: Partial<ProductWriteDto> = {}): ProductWriteDto => ({
    manufacturerCode: code,
    brandId: a.brand,
    categoryId: a.category,
    salePrice: '45.50',
    ...over,
  });
  const query = (over: Partial<ListProductsQueryDto> = {}) => ({ pageSize: 100, ...over }) as ListProductsQueryDto;
  const listed = async (over: Partial<ListProductsQueryDto> = {}) => (await products.list(query(over))).items.map((i) => i.manufacturerCode);

  beforeAll(async () => {
    a = await createCompany('a');
    b = await createCompany('b');
  });

  afterAll(async () => {
    await removeCompany(a.companyId);
    await removeCompany(b.companyId);
    await base.$disconnect();
  });

  beforeEach(() => {
    current = a.companyId;
  });

  it('deactivates: records who and when, audits and publishes the event', async () => {
    const { id } = await commands.create(write('ST-1'));

    const result = await commands.setStatus(id, 'deactivate');

    expect(result).toMatchObject({ id, status: 'INACTIVE' });
    const row = await base.product.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('INACTIVE');
    expect(row.deactivatedAt).toBeInstanceOf(Date);
    expect(row.deactivatedById).toBe(a.userId);
    const log = await base.auditLog.findFirstOrThrow({ where: { companyId: a.companyId, entityId: id, action: 'inventory.product.deactivate' } });
    expect([log.before, log.after]).toEqual([{ status: 'ACTIVE' }, { status: 'INACTIVE' }]);
    const event = await base.outboxEvent.findFirstOrThrow({ where: { companyId: a.companyId, type: 'inventory.product-status-changed' } });
    expect(event.payload).toMatchObject({ productId: id, from: 'ACTIVE', to: 'INACTIVE' });
  });

  it('reactivates: clears who and when, audits and publishes the event', async () => {
    const { id } = await commands.create(write('ST-2'));
    await commands.setStatus(id, 'deactivate');

    const result = await commands.setStatus(id, 'reactivate');

    expect(result).toMatchObject({ id, status: 'ACTIVE' });
    const row = await base.product.findUniqueOrThrow({ where: { id } });
    expect([row.status, row.deactivatedAt, row.deactivatedById]).toEqual(['ACTIVE', null, null]);
    const log = await base.auditLog.findFirstOrThrow({ where: { companyId: a.companyId, entityId: id, action: 'inventory.product.reactivate' } });
    expect([log.before, log.after]).toEqual([{ status: 'INACTIVE' }, { status: 'ACTIVE' }]);
    const events = await base.outboxEvent.findMany({ where: { companyId: a.companyId, type: 'inventory.product-status-changed' } });
    expect(events.filter((e) => (e.payload as { productId: string }).productId === id)).toHaveLength(2);
  });

  it('keeps the history: stock, levels, movements, thresholds and equivalences are not touched', async () => {
    const { id } = await commands.create(write('ST-HIST', { branchId: a.branchId, initialStock: 7, minStock: 2, maxStock: 9 }));
    const other = await commands.create(write('ST-HIST-EQ'));
    const [productAId, productBId] = id < other.id ? [id, other.id] : [other.id, id];
    await base.equivalence.create({ data: { companyId: a.companyId, productAId, productBId } });
    const snapshot = async () => ({
      levels: await base.stockLevel.findMany({ where: { productId: id }, orderBy: { id: 'asc' } }),
      movements: await base.stockMovement.findMany({ where: { productId: id }, orderBy: { id: 'asc' } }),
      thresholds: await base.stockThreshold.findMany({ where: { productId: id }, orderBy: { id: 'asc' } }),
      equivalences: await base.equivalence.count({ where: { OR: [{ productAId: id }, { productBId: id }] } }),
    });
    const before = await snapshot();

    await commands.setStatus(id, 'deactivate');
    expect(await snapshot()).toEqual(before);
    await commands.setStatus(id, 'reactivate');
    expect(await snapshot()).toEqual(before);
    expect(before.levels[0]?.quantity).toBe(7);
  });

  it('only changes the status columns of the product row', async () => {
    const { id } = await commands.create(write('ST-ROW'));
    const before = await base.product.findUniqueOrThrow({ where: { id } });

    await commands.setStatus(id, 'deactivate');

    const after = await base.product.findUniqueOrThrow({ where: { id } });
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    // `updatedById` is not listed: the fixture's single user created the product, so it does not differ
    expect(changed.sort()).toEqual(['deactivatedAt', 'deactivatedById', 'status', 'updatedAt'].sort());
  });

  it('refuses a draft (409 INVALID_STATUS_TRANSITION): a draft is deleted, not deactivated', async () => {
    const draft = await commands.create({ status: 'DRAFT', manufacturerCode: 'ST-DRAFT', brandId: a.brand, categoryId: a.category });

    expect(await rejection(commands.setStatus(draft.id, 'deactivate'))).toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' });
    expect(await rejection(commands.setStatus(draft.id, 'reactivate'))).toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' });
    expect((await base.product.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
  });

  it('refuses to deactivate an inactive product or reactivate an active one', async () => {
    const { id } = await commands.create(write('ST-TWICE'));

    expect(await rejection(commands.setStatus(id, 'reactivate'))).toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' });
    await commands.setStatus(id, 'deactivate');
    expect(await rejection(commands.setStatus(id, 'deactivate'))).toMatchObject({ status: 409, code: 'INVALID_STATUS_TRANSITION' });
    // the refused calls left no audit entry
    expect(await base.auditLog.count({ where: { companyId: a.companyId, entityId: id, action: { startsWith: 'inventory.product.' } } })).toBe(2);
  });

  it('answers 404 for an unknown product and for one of another company', async () => {
    const { id } = await commands.create(write('ST-TENANT'));
    current = b.companyId;

    expect(await rejection(commands.setStatus(id, 'deactivate'))).toMatchObject({ status: 404, code: 'PRODUCT_NOT_FOUND' });
    expect(await rejection(commands.setStatus(randomUUID(), 'deactivate'))).toMatchObject({ status: 404, code: 'PRODUCT_NOT_FOUND' });
    current = a.companyId;
    expect((await base.product.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
  });

  describe('hidden from sales', () => {
    it('drops out of ?sellable=true but stays in the default list, with its status', async () => {
      const { id } = await commands.create(write('SELL-1'));
      await commands.create(write('SELL-2'));
      await commands.setStatus(id, 'deactivate');

      expect(await listed({ sellable: 'true' })).toEqual(expect.arrayContaining(['SELL-2']));
      expect(await listed({ sellable: 'true' })).not.toContain('SELL-1');
      expect(await listed()).toEqual(expect.arrayContaining(['SELL-1', 'SELL-2']));
      expect((await products.list(query())).items.find((i) => i.manufacturerCode === 'SELL-1')?.status).toBe('INACTIVE');
      expect(await listed({ status: 'INACTIVE' })).toContain('SELL-1');

      await commands.setStatus(id, 'reactivate');
      expect(await listed({ sellable: 'true' })).toContain('SELL-1');
    });

    it('never lists a draft as sellable', async () => {
      await commands.create({ status: 'DRAFT', manufacturerCode: 'SELL-DRAFT', brandId: a.brand, categoryId: a.category });

      expect(await listed({ sellable: 'true' })).not.toContain('SELL-DRAFT');
    });

    it('does not mix the sellable filter with an INACTIVE status filter', async () => {
      const { id } = await commands.create(write('SELL-3'));
      await commands.setStatus(id, 'deactivate');

      expect(await listed({ sellable: 'true', status: 'INACTIVE' })).toEqual([]);
    });
  });

  describe('hasMovements', () => {
    it('tells the list and the sheet which products have history', async () => {
      const fresh = await commands.create(write('HM-FRESH'));
      const moved = await commands.create(write('HM-MOVED', { branchId: a.branchId, initialStock: 3 }));

      const items = (await products.list(query())).items;
      expect(items.find((i) => i.id === fresh.id)?.hasMovements).toBe(false);
      expect(items.find((i) => i.id === moved.id)?.hasMovements).toBe(true);
      expect((await products.detail(fresh.id, false)).hasMovements).toBe(false);
      expect((await products.detail(moved.id, false)).hasMovements).toBe(true);
    });

    it('keeps delete blocked for a product with movements, and a deactivated one can still be deleted when it has none', async () => {
      const moved = await commands.create(write('HM-DEL', { branchId: a.branchId, initialStock: 3 }));
      await commands.setStatus(moved.id, 'deactivate');
      expect(await rejection(commands.remove(moved.id))).toMatchObject({ status: 409, code: 'PRODUCT_HAS_MOVEMENTS' });

      const fresh = await commands.create(write('HM-DEL2'));
      await commands.setStatus(fresh.id, 'deactivate');
      await commands.remove(fresh.id);
      expect(await base.product.count({ where: { id: fresh.id } })).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('lets one of 2 parallel deactivations win and refuses the other, with a single audit entry and event', async () => {
      const { id } = await commands.create(write('CC-1'));

      const results = await Promise.allSettled([commands.setStatus(id, 'deactivate'), commands.setStatus(id, 'deactivate')]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason.response.code).toBe('INVALID_STATUS_TRANSITION');
      expect(await base.auditLog.count({ where: { companyId: a.companyId, entityId: id, action: 'inventory.product.deactivate' } })).toBe(1);
      const events = await base.outboxEvent.findMany({ where: { companyId: a.companyId, type: 'inventory.product-status-changed' } });
      expect(events.filter((e) => (e.payload as { productId: string }).productId === id)).toHaveLength(1);
    });

    it('never deletes a product that a racing stock movement gave history', async () => {
      for (let i = 0; i < 5; i++) {
        const created = await commands.create(write(`CC-DEL-${i}`));
        const move = prisma.tenant.$transaction((tx) =>
          stock.apply(tx, {
            productId: created.id,
            warehouseId: a.warehouseId,
            type: 'INITIAL',
            quantity: 2,
            reason: 'race',
            refType: 'PRODUCT',
            refId: created.id,
            refNumber: `CC-DEL-${i}`,
          }),
        );

        await Promise.allSettled([commands.remove(created.id), move]);

        const exists = (await base.product.count({ where: { id: created.id } })) === 1;
        const movements = await base.stockMovement.count({ where: { productId: created.id } });
        // either the delete won and left nothing behind, or the movement won and the product stays with its history
        expect(movements).toBe(exists ? 1 : 0);
      }
    });

    /**
     * Holds the product row lock in an open transaction, runs `act` and checks it waits for the lock instead of running
     * through; then releases the lock and returns what `act` settled with. Fails if the lock is not what orders the calls.
     */
    async function blockedByLock(id: string, act: () => Promise<unknown>) {
      let release!: () => void;
      let locked!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const holder = base.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
          locked();
          await held;
        },
        { timeout: 30_000 },
      );
      await isLocked;
      let settled = false;
      const outcome = act().then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      void outcome.then(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 500));
      const blocked = !settled;
      release();
      await holder;
      expect(blocked).toBe(true);
      return outcome;
    }

    it('waits for the product lock: setStatus, remove and a stock movement do not run past a held lock', async () => {
      const status = await commands.create(write('CC-LOCK-1'));
      expect((await blockedByLock(status.id, () => commands.setStatus(status.id, 'deactivate'))).ok).toBe(true);

      const removable = await commands.create(write('CC-LOCK-2'));
      expect((await blockedByLock(removable.id, () => commands.remove(removable.id))).ok).toBe(true);
      expect(await base.product.count({ where: { id: removable.id } })).toBe(0);

      const moved = await commands.create(write('CC-LOCK-3'));
      const move = () =>
        prisma.tenant.$transaction((tx) =>
          stock.apply(tx, { productId: moved.id, warehouseId: a.warehouseId, type: 'INITIAL', quantity: 1, reason: 'lock', refType: 'PRODUCT', refId: moved.id, refNumber: 'CC-LOCK-3' }),
        );
      expect((await blockedByLock(moved.id, move)).ok).toBe(true);
    });

    it('a deactivation queued behind a delete fails with 404 and leaves no audit entry or event', async () => {
      const { id } = await commands.create(write('CC-2'));

      const outcome = await blockedByLock(id, async () => {
        // queued behind the held lock, then the delete takes the lock first because it started earlier
        const deleting = commands.remove(id);
        await new Promise((resolve) => setTimeout(resolve, 100));
        const [removed, deactivated] = await Promise.allSettled([deleting, commands.setStatus(id, 'deactivate')]);
        return { removed: removed.status, deactivated };
      });

      expect(outcome.ok).toBe(true);
      const result = (outcome as { ok: true; value: { removed: string; deactivated: PromiseSettledResult<unknown> } }).value;
      expect(result.removed).toBe('fulfilled');
      expect(result.deactivated.status).toBe('rejected');
      expect(((result.deactivated as PromiseRejectedResult).reason as { response: { code: string } }).response.code).toBe('PRODUCT_NOT_FOUND');
      expect(await base.product.count({ where: { id } })).toBe(0);
      expect(await base.auditLog.count({ where: { companyId: a.companyId, entityId: id, action: 'inventory.product.deactivate' } })).toBe(0);
      const events = await base.outboxEvent.findMany({ where: { companyId: a.companyId, type: 'inventory.product-status-changed' } });
      expect(events.filter((e) => (e.payload as { productId: string }).productId === id)).toHaveLength(0);
    });

    it('a deactivation and a delete racing freely end consistent: gone with no trace, or inactive with one audit entry and event', async () => {
      const { id } = await commands.create(write('CC-3'));

      await Promise.allSettled([commands.setStatus(id, 'deactivate'), commands.remove(id)]);

      const row = await base.product.findUnique({ where: { id } });
      const audits = await base.auditLog.count({ where: { companyId: a.companyId, entityId: id, action: 'inventory.product.deactivate' } });
      const events = (await base.outboxEvent.findMany({ where: { companyId: a.companyId, type: 'inventory.product-status-changed' } })).filter(
        (e) => (e.payload as { productId: string }).productId === id,
      );
      // a deactivation that ran before the delete leaves its trace in the log (the delete is audited too); never half a change
      if (row) {
        expect(row.status).toBe('INACTIVE');
        expect([audits, events.length]).toEqual([1, 1]);
      } else {
        expect(audits).toBe(events.length);
      }
    });
  });
});
