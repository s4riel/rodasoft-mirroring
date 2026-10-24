/**
 * Integration test of the product edit (HU-INV-07) against the real Postgres (DATABASE_URL). Creates throw-away
 * companies and removes them at the end, so it is safe to run against the dev database.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import { ProductCommandsService } from './product-commands.service';
import type { ProductUpdateDto, ProductWriteDto } from './product-write.dto';
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
/** The product sheet reads the member's branches, so each company has a real full-access membership. */
const memberships = new Map<string, string>();
const cls = {
  get: (k: string) => (k === 'companyId' ? current : k === 'membershipId' ? (memberships.get(current ?? '') ?? null) : null),
} as never;
const withCost = { permissions: async () => new Set(['inventory.costs.view']), operableBranchIds: async () => null } as never;
const withoutCost = { permissions: async () => new Set<string>(), operableBranchIds: async () => null } as never;
const settings = new SettingsService(prisma);
const stock = new StockMovementService(cls, settings);
const audit = new AuditService(prisma, cls);
const outbox = new OutboxService(prisma, cls);
const commands = new ProductCommandsService(prisma, cls, audit, withCost, settings, stock, outbox);
const commandsWithoutCost = new ProductCommandsService(prisma, cls, audit, withoutCost, settings, stock, outbox);
const products = new ProductsService(prisma, cls);

interface Fixture {
  companyId: string;
  branchId: string;
  warehouseId: string;
  countrySE: string;
  brandSKF: string;
  brandFAG: string;
  bearings: string;
  seals: string;
}

async function createCompany(tag: string): Promise<Fixture> {
  const company = await base.company.create({
    data: { slug: `upd-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `U${tag}${run}`.slice(0, 20) },
  });
  const companyId = company.id;
  const branch = await base.branch.create({ data: { companyId, code: 0, name: 'Central' } });
  const warehouse = await base.warehouse.create({
    data: { companyId, branchId: branch.id, code: `W-${run}`, name: 'Principal', isMain: true },
  });
  const se = await base.country.create({ data: { companyId, code: 'SE', name: 'Suecia' } });
  const skf = await base.brand.create({ data: { companyId, name: 'SKF', countryId: se.id } });
  const fag = await base.brand.create({ data: { companyId, name: 'FAG', countryId: se.id } });
  const bearings = await base.category.create({ data: { companyId, name: 'Rodamientos' } });
  const seals = await base.category.create({ data: { companyId, name: 'Retenes y sellos' } });
  await base.attributeDefinition.createMany({
    data: [
      { companyId, categoryId: bearings.id, key: 'bore', label: 'Agujero', type: 'NUMBER', step: 2 },
      { companyId, categoryId: bearings.id, key: 'seal', label: 'Sello', type: 'ENUM', options: ['Abierto', '2RS'], required: true, step: 3 },
      { companyId, categoryId: seals.id, key: 'material', label: 'Material', type: 'TEXT', required: true, step: 3 },
    ],
  });
  const role = await base.role.create({ data: { companyId, key: 'it', name: 'it' } });
  const user = await base.user.create({ data: { email: `upd-${tag}-${run}@test.local`, name: 'it' } });
  const member = await base.membership.create({ data: { companyId, userId: user.id, roleId: role.id, allBranches: true } });
  memberships.set(companyId, member.id);
  return { companyId, branchId: branch.id, warehouseId: warehouse.id, countrySE: se.id, brandSKF: skf.id, brandFAG: fag.id, bearings: bearings.id, seals: seals.id };
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
  await base.stockThreshold.deleteMany({ where: { companyId } });
  await base.stockLevel.deleteMany({ where: { companyId } });
  await base.productDimension.deleteMany({ where: { companyId } });
  await base.product.deleteMany({ where: { companyId } });
  await base.attributeDefinition.deleteMany({ where: { companyId } });
  await base.category.deleteMany({ where: { companyId } });
  await base.brand.deleteMany({ where: { companyId } });
  await base.country.deleteMany({ where: { companyId } });
  await base.warehouse.deleteMany({ where: { companyId } });
  await base.branch.deleteMany({ where: { companyId } });
  const members = await base.membership.findMany({ where: { companyId }, select: { id: true, userId: true } });
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

describe('ProductCommandsService update (integration, real Postgres)', () => {
  let a: Fixture;
  let b: Fixture;
  const bearing = (over: Partial<ProductWriteDto> = {}): ProductWriteDto => ({
    manufacturerCode: '6205-2RS',
    brandId: a.brandSKF,
    categoryId: a.bearings,
    countryId: a.countrySE,
    salePrice: '45.50',
    cost: '30.0000',
    innerDiameter: '25',
    outerDiameter: '52',
    width: '15',
    attributes: { seal: 'Abierto' },
    ...over,
  });

  /** A product with no movements, and its `updatedAt` as the edit form would hold it. */
  async function product(over: Partial<ProductWriteDto> = {}) {
    const created = await commands.create(bearing(over));
    const row = await base.product.findUniqueOrThrow({ where: { id: created.id } });
    return { id: created.id, updatedAt: row.updatedAt.toISOString() };
  }

  const edit = (updatedAt: string, over: Partial<ProductUpdateDto> = {}): ProductUpdateDto => ({ expectedUpdatedAt: updatedAt, ...over });

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

  it('updates the fields sent, keeps the rest, sets updated_by and audits only what changed', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-1' });

    const saved = await commands.update(id, edit(updatedAt, { salePrice: '49.90', attributes: { seal: '2RS' }, width: '16' }));

    expect(saved.id).toBe(id);
    expect(new Date(saved.updatedAt).getTime()).toBeGreaterThan(new Date(updatedAt).getTime());
    const row = await base.product.findUniqueOrThrow({ where: { id }, include: { dimensions: true } });
    expect(row.salePrice.toFixed(2)).toBe('49.90');
    expect(row.attributes).toEqual({ seal: '2RS' });
    expect(row.dimensions?.width?.toString()).toBe('16');
    expect(row.dimensions?.innerDiameter?.toString()).toBe('25');
    expect(row.manufacturerCode).toBe('UPD-1');
    expect(row.cost?.toFixed(4)).toBe('30.0000');

    const log = await base.auditLog.findFirstOrThrow({ where: { companyId: a.companyId, entityId: id, action: 'inventory.product.update' } });
    expect(log.before).toEqual({ salePrice: '45.50', width: '15', 'attributes.seal': 'Abierto' });
    expect(log.after).toEqual({ salePrice: '49.90', width: '16', 'attributes.seal': '2RS' });
    const event = await base.outboxEvent.findFirst({ where: { companyId: a.companyId, type: 'inventory.product-updated' } });
    expect(event).not.toBeNull();
  });

  it('writes nothing when the form comes back unchanged', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-NOOP' });

    const saved = await commands.update(id, edit(updatedAt, { salePrice: '45.5', innerDiameter: '25.000' }));

    expect(saved.updatedAt).toBe(updatedAt);
    expect(await base.auditLog.count({ where: { companyId: a.companyId, entityId: id, action: 'inventory.product.update' } })).toBe(0);
  });

  it('refuses an empty price with PRICE_REQUIRED (422), like creation', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-PRICE' });

    expect(await rejection(commands.update(id, edit(updatedAt, { salePrice: null })))).toMatchObject({ status: 422, code: 'PRICE_REQUIRED' });
  });

  it('refuses a code that another product of the brand already has (409), in any case', async () => {
    await product({ manufacturerCode: 'UPD-TAKEN' });
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-OTHER' });

    expect(await rejection(commands.update(id, edit(updatedAt, { manufacturerCode: 'upd-taken' })))).toMatchObject({
      status: 409,
      code: 'DUPLICATE_MANUFACTURER_CODE',
    });
    // its own code is not a clash
    await expect(commands.update(id, edit(updatedAt, { manufacturerCode: 'UPD-OTHER', salePrice: '50' }))).resolves.toMatchObject({ id });
  });

  it('refuses a technical value that does not fit the category with VALIDATION_FAILED (400)', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-ATTR' });

    const refused = await rejection(commands.update(id, edit(updatedAt, { attributes: { seal: 'Dorado' } })));

    expect(refused).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', details: [{ field: 'seal', code: 'ATTRIBUTE_OPTION' }] });
  });

  it('refuses stock, branch and status fields with FIELD_NOT_EDITABLE and writes no movement', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-STOCK' });
    const movementsBefore = await base.stockMovement.count({ where: { companyId: a.companyId } });

    for (const field of [{ initialStock: 5 }, { branchId: a.branchId }, { status: 'DRAFT' as const }]) {
      expect(await rejection(commands.update(id, edit(updatedAt, field)))).toMatchObject({ status: 400, code: 'FIELD_NOT_EDITABLE' });
    }
    expect(await base.stockMovement.count({ where: { companyId: a.companyId } })).toBe(movementsBefore);
  });

  it('changes brand and category while the product has no movements, and starts the technical fields over', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-FREE' });

    await commands.update(id, edit(updatedAt, { brandId: a.brandFAG, categoryId: a.seals, attributes: { material: 'NBR' } }));

    const row = await base.product.findUniqueOrThrow({ where: { id } });
    expect([row.brandId, row.categoryId]).toEqual([a.brandFAG, a.seals]);
    expect(row.attributes).toEqual({ material: 'NBR' });
  });

  it('locks brand and category once the product has movements (409), but still edits the rest', async () => {
    const created = await commands.create(bearing({ manufacturerCode: 'UPD-MOVED', branchId: a.branchId, initialStock: 10 }));
    const updatedAt = (await base.product.findUniqueOrThrow({ where: { id: created.id } })).updatedAt.toISOString();

    expect(await rejection(commands.update(created.id, edit(updatedAt, { brandId: a.brandFAG })))).toMatchObject({ status: 409, code: 'PRODUCT_HAS_MOVEMENTS' });
    expect(await rejection(commands.update(created.id, edit(updatedAt, { categoryId: a.seals, attributes: { material: 'NBR' } })))).toMatchObject({
      status: 409,
      code: 'PRODUCT_HAS_MOVEMENTS',
    });
    // sending the same brand and category is not a change
    await commands.update(created.id, edit(updatedAt, { brandId: a.brandSKF, categoryId: a.bearings, salePrice: '60' }));
    expect((await base.product.findUniqueOrThrow({ where: { id: created.id } })).salePrice.toFixed(2)).toBe('60.00');
    // and the stock stays what the movements say
    const level = await base.stockLevel.findFirstOrThrow({ where: { productId: created.id } });
    expect(level.quantity).toBe(10);
    expect(await base.stockMovement.count({ where: { productId: created.id } })).toBe(1);
  });

  it('refuses a second edit made from the same loaded state with PRODUCT_MODIFIED (409)', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-LOCK' });

    await commands.update(id, edit(updatedAt, { salePrice: '51' }));

    expect(await rejection(commands.update(id, edit(updatedAt, { salePrice: '52' })))).toMatchObject({ status: 409, code: 'PRODUCT_MODIFIED' });
    expect((await base.product.findUniqueOrThrow({ where: { id } })).salePrice.toFixed(2)).toBe('51.00');
  });

  it('lets exactly one of two simultaneous edits through', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-RACE' });

    const results = await Promise.allSettled([
      commands.update(id, edit(updatedAt, { salePrice: '70' })),
      commands.update(id, edit(updatedAt, { salePrice: '80' })),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect((failed?.reason as { getResponse(): { code: string } }).getResponse().code).toBe('PRODUCT_MODIFIED');
    const price = (await base.product.findUniqueOrThrow({ where: { id } })).salePrice.toFixed(2);
    expect(['70.00', '80.00']).toContain(price);
  });

  it('ignores the cost for who cannot see costs, and keeps the stored one', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-COST' });

    await commandsWithoutCost.update(id, edit(updatedAt, { cost: '1.0000', salePrice: '47' }));

    const row = await base.product.findUniqueOrThrow({ where: { id } });
    expect(row.cost?.toFixed(4)).toBe('30.0000');
    expect(row.salePrice.toFixed(2)).toBe('47.00');
    const log = await base.auditLog.findFirstOrThrow({ where: { companyId: a.companyId, entityId: id, action: 'inventory.product.update' } });
    expect(JSON.stringify(log.after)).not.toContain('cost');
  });

  it('records a cost change in the audit for who can see costs, and never in the response', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-COST2' });

    const saved = await commands.update(id, edit(updatedAt, { cost: '31.5000' }));

    expect(Object.keys(saved).sort()).toEqual(['id', 'sku', 'updatedAt']);
    const log = await base.auditLog.findFirstOrThrow({ where: { companyId: a.companyId, entityId: id, action: 'inventory.product.update' } });
    expect(log.before).toEqual({ cost: '30.0000' });
    expect(log.after).toEqual({ cost: '31.5000' });
  });

  it('edits the thresholds of the main warehouse of the branch and audits them', async () => {
    const created = await commands.create(bearing({ manufacturerCode: 'UPD-TH', branchId: a.branchId, initialStock: 4, minStock: 2, maxStock: 20, location: 'A-1' }));
    const updatedAt = (await base.product.findUniqueOrThrow({ where: { id: created.id } })).updatedAt.toISOString();

    expect((await products.editModel(created.id, true)).thresholds).toEqual([{ branchId: a.branchId, minStock: 2, maxStock: 20, location: 'A-1' }]);
    await commands.update(created.id, edit(updatedAt, { thresholdBranchId: a.branchId, minStock: 5, location: 'B-2' }));

    const threshold = await base.stockThreshold.findFirstOrThrow({ where: { productId: created.id, warehouseId: a.warehouseId } });
    expect([threshold.minStock, threshold.maxStock, threshold.location]).toEqual([5, 20, 'B-2']);
    const log = await base.auditLog.findFirstOrThrow({ where: { companyId: a.companyId, entityId: created.id, action: 'inventory.product.update' } });
    expect(log.after).toEqual({ minStock: 5, location: 'B-2' });
    expect(await base.stockMovement.count({ where: { productId: created.id } })).toBe(1);
  });

  it('refuses a maximum below the stored minimum even when only the maximum is sent', async () => {
    const created = await commands.create(bearing({ manufacturerCode: 'UPD-TH3', branchId: a.branchId, minStock: 10, maxStock: 20 }));
    const updatedAt = (await base.product.findUniqueOrThrow({ where: { id: created.id } })).updatedAt.toISOString();

    expect(await rejection(commands.update(created.id, edit(updatedAt, { thresholdBranchId: a.branchId, maxStock: 5 })))).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: [{ field: 'maxStock', code: 'MAX_BELOW_MIN' }],
    });
  });

  it('asks for the branch when thresholds are sent without it', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-TH2' });

    expect(await rejection(commands.update(id, edit(updatedAt, { minStock: 1 })))).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('does not edit a draft (409 NOT_EDITABLE_DRAFT): drafts use their own route', async () => {
    const draft = await commands.create({ status: 'DRAFT', manufacturerCode: 'UPD-DRAFT', brandId: a.brandSKF, categoryId: a.bearings });
    const updatedAt = (await base.product.findUniqueOrThrow({ where: { id: draft.id } })).updatedAt.toISOString();

    expect(await rejection(commands.update(draft.id, edit(updatedAt)))).toMatchObject({ status: 409, code: 'NOT_EDITABLE_DRAFT' });
    expect(await rejection(products.editModel(draft.id, true))).toMatchObject({ status: 409, code: 'NOT_EDITABLE_DRAFT' });
  });

  it('does not see or edit a product of another company', async () => {
    const { id, updatedAt } = await product({ manufacturerCode: 'UPD-TENANT' });
    current = b.companyId;

    expect(await rejection(commands.update(id, edit(updatedAt, { salePrice: '1' })))).toMatchObject({ status: 404, code: 'PRODUCT_NOT_FOUND' });
    expect(await rejection(products.editModel(id, true))).toMatchObject({ status: 404 });
    current = a.companyId;
    expect((await base.product.findUniqueOrThrow({ where: { id } })).salePrice.toFixed(2)).toBe('45.50');
  });

  describe('editModel', () => {
    it('gives the sheet, the lock value and whether the product has movements', async () => {
      const fresh = await product({ manufacturerCode: 'EM-1' });
      const moved = await commands.create(bearing({ manufacturerCode: 'EM-2', branchId: a.branchId, initialStock: 3 }));

      const free = await products.editModel(fresh.id, true);
      const locked = await products.editModel(moved.id, true);

      expect(free.hasMovements).toBe(false);
      expect(free.product.updatedAt).toBe(fresh.updatedAt);
      expect(free.countryId).toBe(a.countrySE);
      expect(free.thresholds).toEqual([]);
      expect(locked.hasMovements).toBe(true);
      expect(locked.product.totalStock).toBe(3);
    });

    it('leaves the cost out without the permission', async () => {
      const { id } = await product({ manufacturerCode: 'EM-3' });

      expect((await products.editModel(id, true)).product.pricing).toMatchObject({ cost: '30.0000' });
      expect((await products.editModel(id, false)).product.pricing).toEqual({ salePrice: '45.50' });
    });
  });
});
