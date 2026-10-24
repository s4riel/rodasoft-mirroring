/**
 * Integration test of the creation wizard (HU-INV-06) against the real Postgres (DATABASE_URL). Creates throw-away
 * companies and removes them at the end, so it is safe to run against the dev database.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import { EquivalencesService } from './equivalences.service';
import { ProductCommandsService } from './product-commands.service';
import { ProductsService } from './products.service';
import type { ProductWriteDto } from './product-write.dto';
import { StockMovementService } from './stock-movement.service';

const run = randomUUID().slice(0, 8);

let current: string | null = null;
/** Same shape as PrismaService: the client itself plus a tenant-scoped extension of it. */
class TestPrisma extends PrismaClient {
  readonly tenant = this.$extends(tenantExtension(() => current));
}
const base = new TestPrisma();
const prisma = base as unknown as PrismaService;
const cls = { get: (k: string) => (k === 'companyId' ? current : k === 'membershipId' ? 'm1' : k === 'userId' ? null : null) } as never;
const membership = { permissions: async () => new Set(['inventory.costs.view']), operableBranchIds: async () => null } as never;
const settings = new SettingsService(prisma);
const stock = new StockMovementService(cls, settings);
const products = new ProductsService(prisma, cls);
const equivalences = new EquivalencesService(prisma, cls, new AuditService(prisma, cls));
const commands = new ProductCommandsService(prisma, cls, new AuditService(prisma, cls), membership, settings, stock, new OutboxService(prisma, cls));

interface Fixture {
  companyId: string;
  branchId: string;
  warehouseId: string;
  countrySE: string;
  brandSKF: string;
  bearings: string;
  seals: string;
}

async function createCompany(tag: string): Promise<Fixture> {
  const company = await base.company.create({
    data: { slug: `wiz-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `W${tag}${run}`.slice(0, 20) },
  });
  const companyId = company.id;
  const branch = await base.branch.create({ data: { companyId, code: 0, name: 'Central' } });
  const warehouse = await base.warehouse.create({
    data: { companyId, branchId: branch.id, code: `W-${run}`, name: 'Principal', isMain: true },
  });
  const se = await base.country.create({ data: { companyId, code: 'SE', name: 'Suecia' } });
  const skf = await base.brand.create({ data: { companyId, name: 'SKF', countryId: se.id } });
  const bearings = await base.category.create({ data: { companyId, name: 'Rodamientos' } });
  const seals = await base.category.create({ data: { companyId, name: 'Retenes y sellos' } });
  await base.attributeDefinition.createMany({
    data: [
      { companyId, categoryId: bearings.id, key: 'bore', label: 'Agujero', type: 'NUMBER', step: 2 },
      { companyId, categoryId: bearings.id, key: 'seal', label: 'Sello', type: 'ENUM', options: ['Abierto', '2RS'], required: true, step: 3 },
      { companyId, categoryId: seals.id, key: 'material', label: 'Material', type: 'TEXT', required: true, step: 3 },
      { companyId, categoryId: seals.id, key: 'innerDiameter', label: 'Ø Interior d', type: 'NUMBER', step: 3 },
      { companyId, categoryId: seals.id, key: 'outerDiameter', label: 'Ø Exterior D', type: 'NUMBER', step: 3 },
      { companyId, categoryId: seals.id, key: 'width', label: 'Ancho B', type: 'NUMBER', step: 3 },
    ],
  });
  return {
    companyId,
    branchId: branch.id,
    warehouseId: warehouse.id,
    countrySE: se.id,
    brandSKF: skf.id,
    bearings: bearings.id,
    seals: seals.id,
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

describe('ProductCommandsService create / saveDraft (integration, real Postgres)', () => {
  let a: Fixture;
  const bearing = (over: Partial<ProductWriteDto> = {}): ProductWriteDto => ({
    manufacturerCode: '6205-2RS',
    brandId: a.brandSKF,
    categoryId: a.bearings,
    countryId: a.countrySE,
    salePrice: '45.50',
    innerDiameter: '25',
    outerDiameter: '52',
    width: '15',
    attributes: { seal: 'Abierto' },
    ...over,
  });

  beforeAll(async () => {
    a = await createCompany('a');
  });

  afterAll(async () => {
    await removeCompany(a.companyId);
    await base.$disconnect();
  });

  beforeEach(() => {
    current = a.companyId;
  });

  it('creates an active bearing and records the initial stock as an INITIAL movement in the receiving branch', async () => {
    const created = await commands.create(
      bearing({ branchId: a.branchId, initialStock: 24, minStock: 2, maxStock: 30, location: 'A-1' }),
    );

    expect(created).toEqual({ id: expect.any(String), sku: 'RL-000001', status: 'ACTIVE' });
    const level = await base.stockLevel.findFirstOrThrow({ where: { productId: created.id, warehouseId: a.warehouseId } });
    expect(level.quantity).toBe(24);
    const movement = await base.stockMovement.findFirstOrThrow({ where: { productId: created.id } });
    expect(movement).toMatchObject({ type: 'INITIAL', quantity: 24, balanceAfter: 24, refNumber: 'RL-000001' });
    const threshold = await base.stockThreshold.findFirstOrThrow({ where: { productId: created.id } });
    expect(threshold).toMatchObject({ minStock: 2, maxStock: 30, location: 'A-1' });
  });

  it('writes the audit entry and the product-created event in the same transaction', async () => {
    const created = await base.product.findFirstOrThrow({ where: { companyId: a.companyId, sku: 'RL-000001' } });
    const audit = await base.auditLog.findFirst({ where: { companyId: a.companyId, action: 'inventory.product.create', entityId: created.id } });
    expect(audit).not.toBeNull();
    const event = await base.outboxEvent.findFirst({ where: { companyId: a.companyId, type: 'inventory.product-created' } });
    expect(event?.payload).toMatchObject({ productId: created.id, sku: 'RL-000001' });
  });

  it('refuses a second product with the same code for the brand (409 DUPLICATE_MANUFACTURER_CODE)', async () => {
    const err = await rejection(commands.create(bearing({ attributes: { seal: '2RS' } })));
    expect(err).toMatchObject({ status: 409, code: 'DUPLICATE_MANUFACTURER_CODE' });
  });

  it('refuses an active product without a price (422 PRICE_REQUIRED) and accepts the same product as a draft', async () => {
    const noPrice = bearing({ manufacturerCode: 'NO-PRICE', salePrice: undefined });
    expect(await rejection(commands.create(noPrice))).toMatchObject({ status: 422, code: 'PRICE_REQUIRED' });

    const draft = await commands.create({ ...noPrice, status: 'DRAFT' });
    expect(draft.status).toBe('DRAFT');
  });

  it('reports the required technical fields of an active product with 400 and the field errors', async () => {
    const err = await rejection(commands.create(bearing({ manufacturerCode: 'NO-SEAL', attributes: {} })));
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.details).toContainEqual({ field: 'seal', code: 'ATTRIBUTE_REQUIRED' });
  });

  it('keeps a draft out of the stock: the initial stock waits for the activation', async () => {
    const draft = await commands.create(bearing({ manufacturerCode: 'DRAFT-STOCK', status: 'DRAFT', branchId: a.branchId, initialStock: 10 }));
    expect(draft.status).toBe('DRAFT');
    expect(await base.stockLevel.count({ where: { productId: draft.id } })).toBe(0);
    expect(await base.stockMovement.count({ where: { productId: draft.id } })).toBe(0);
  });

  it('saves a draft, then finalizes it with the stock; a finished product cannot be saved as a draft again', async () => {
    const draft = await commands.create(bearing({ manufacturerCode: 'LIFE-1', status: 'DRAFT', salePrice: undefined, attributes: {} }));

    const finalized = await commands.saveDraft(draft.id, bearing({ manufacturerCode: 'LIFE-1', status: 'ACTIVE', branchId: a.branchId, initialStock: 3 }));
    expect(finalized).toMatchObject({ id: draft.id, status: 'ACTIVE' });
    expect(await base.stockLevel.findFirstOrThrow({ where: { productId: draft.id } })).toMatchObject({ quantity: 3 });

    const err = await rejection(commands.saveDraft(draft.id, bearing({ manufacturerCode: 'LIFE-1', status: 'DRAFT' })));
    expect(err).toMatchObject({ status: 409, code: 'NOT_A_DRAFT' });
  });

  it('keeps the stored fields of a draft that a later save leaves out', async () => {
    const draft = await commands.create(bearing({ manufacturerCode: 'KEEP-1', status: 'DRAFT', sectors: ['Minería'], tariffCode: '8482.10' }));

    // the wizard sends only what the user filled in this time
    await commands.saveDraft(draft.id, { status: 'DRAFT', manufacturerCode: 'KEEP-1', brandId: a.brandSKF, categoryId: a.bearings, salePrice: '50.00' });

    const row = await base.product.findFirstOrThrow({ where: { id: draft.id }, include: { dimensions: true } });
    expect(row.attributes).toEqual({ seal: 'Abierto' });
    expect(row.sectors).toEqual(['Minería']);
    expect(row.tariffCode).toBe('8482.10');
    expect(row.salePrice.toFixed(2)).toBe('50.00');
    expect(row.dimensions?.innerDiameter?.toString()).toBe('25');
  });

  it('clears a field sent as null and keeps one that is left out', async () => {
    const datasheet = `${a.companyId}/datasheet/CLEAR-1_v1.pdf`;
    const draft = await commands.create(
      bearing({ manufacturerCode: 'CLEAR-1', status: 'DRAFT', tariffCode: '8482.10', supplierName: 'Proveedor', datasheetKey: datasheet }),
    );

    await commands.saveDraft(draft.id, { status: 'DRAFT', manufacturerCode: 'CLEAR-1', tariffCode: null, datasheetKey: null });

    const row = await base.product.findFirstOrThrow({ where: { id: draft.id } });
    expect(row.tariffCode).toBeNull();
    expect(row.datasheetUrl).toBeNull();
    expect(row.supplierName).toBe('Proveedor');
  });

  it('fills the dimension columns from the technical fields of a category without a dimensions step', async () => {
    const seal = await commands.create({
      manufacturerCode: 'SEAL-DIMS',
      brandId: a.brandSKF,
      categoryId: a.seals,
      salePrice: '12.00',
      attributes: { material: 'NBR', innerDiameter: 35, outerDiameter: 52, width: 7 },
    });
    const dims = await base.productDimension.findFirstOrThrow({ where: { productId: seal.id } });
    expect([dims.innerDiameter?.toString(), dims.outerDiameter?.toString(), dims.width?.toString()]).toEqual(['35', '52', '7']);
  });

  it('stores the photo and datasheet keys of this company and refuses keys of another company', async () => {
    const photo = `${a.companyId}/photo/FILES-1_v1.jpg`;
    const datasheet = `${a.companyId}/datasheet/FILES-1_v1.pdf`;
    const created = await commands.create(bearing({ manufacturerCode: 'FILES-1', status: 'DRAFT', photos: [photo], datasheetKey: datasheet }));
    const row = await base.product.findFirstOrThrow({ where: { id: created.id } });
    expect(row.photos).toEqual([photo]);
    expect(row.datasheetUrl).toBe(datasheet);

    const foreign = `${randomUUID()}/photo/FILES-1_v1.jpg`;
    const err = await rejection(commands.saveDraft(created.id, { status: 'DRAFT', manufacturerCode: 'FILES-1', photos: [foreign] }));
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', details: [{ field: 'photos', code: 'INVALID_FILE_KEY' }] });
  });

  it('keeps the stored photos when a later save leaves them out', async () => {
    const photo = `${a.companyId}/photo/FILES-2_v1.png`;
    const created = await commands.create(bearing({ manufacturerCode: 'FILES-2', status: 'DRAFT', photos: [photo] }));
    await commands.saveDraft(created.id, { status: 'DRAFT', manufacturerCode: 'FILES-2', salePrice: '10.00' });
    expect((await base.product.findFirstOrThrow({ where: { id: created.id } })).photos).toEqual([photo]);
  });

  it('finalizes a draft once when two saves race: the stock is recorded once', async () => {
    const draft = await commands.create(bearing({ manufacturerCode: 'RACE-1', status: 'DRAFT', salePrice: undefined, attributes: {} }));
    const finalize = bearing({ manufacturerCode: 'RACE-1', status: 'ACTIVE', branchId: a.branchId, initialStock: 10 });

    const results = await Promise.allSettled([commands.saveDraft(draft.id, finalize), commands.saveDraft(draft.id, finalize)]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect((loser?.reason as { getResponse(): { code: string } }).getResponse().code).toBe('NOT_A_DRAFT');
    expect(await base.stockMovement.count({ where: { productId: draft.id, type: 'INITIAL' } })).toBe(1);
    expect(await base.stockLevel.findFirstOrThrow({ where: { productId: draft.id } })).toMatchObject({ quantity: 10 });
  });

  it('checks the code live per brand (drafts count)', async () => {
    expect(await commands.codeAvailability(a.brandSKF, '6205-2RS')).toMatchObject({ available: false, productId: expect.any(String) });
    expect(await commands.codeAvailability(a.brandSKF, 'FREE-CODE')).toEqual({ available: true, productId: null });
  });

  it('ignores the case of the code, and refuses a product whose code only differs in case', async () => {
    expect(await commands.codeAvailability(a.brandSKF, '6205-2rs')).toMatchObject({ available: false, productId: expect.any(String) });
    const err = await rejection(commands.create(bearing({ manufacturerCode: '6205-2rs', status: 'DRAFT' })));
    expect(err).toMatchObject({ status: 409, code: 'DUPLICATE_MANUFACTURER_CODE' });
  });

  it('validates a non-bearing category without dimensions', async () => {
    const seal = await commands.create({
      manufacturerCode: 'SEAL-1',
      brandId: a.brandSKF,
      categoryId: a.seals,
      countryId: a.countrySE,
      salePrice: '12.00',
      attributes: { material: 'NBR' },
    });
    expect(seal.status).toBe('ACTIVE');
  });

  it('asks for the receiving branch when there is initial stock', async () => {
    const err = await rejection(commands.create(bearing({ manufacturerCode: 'NO-BRANCH', initialStock: 5 })));
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', details: [{ field: 'branchId', code: 'BRANCH_REQUIRED' }] });
  });

  it('refuses a branch the member may not operate (403 BRANCH_NOT_ALLOWED)', async () => {
    const restricted = new ProductCommandsService(
      prisma,
      cls,
      new AuditService(prisma, cls),
      { permissions: async () => new Set(), operableBranchIds: async () => [] } as never,
      settings,
      stock,
      new OutboxService(prisma, cls),
    );
    const err = await rejection(restricted.create(bearing({ manufacturerCode: 'NO-SCOPE', branchId: a.branchId, initialStock: 1 })));
    expect(err).toMatchObject({ status: 403, code: 'BRANCH_NOT_ALLOWED' });
  });

  // runs after the sequence above: the next SKU continues the numbering under the new prefix
  it('takes the SKU prefix from the company settings', async () => {
    await base.companySetting.create({ data: { companyId: a.companyId, key: 'inventory.skuPrefix', value: 'AB-' } });
    const created = await commands.create(bearing({ manufacturerCode: 'PREFIX-1' }));
    expect(created.sku).toMatch(/^AB-\d{6}$/);
    const next = await commands.create(bearing({ manufacturerCode: 'PREFIX-2' }));
    expect(next.sku).toBe(`AB-${String(Number(created.sku.slice(3)) + 1).padStart(6, '0')}`);
    await base.companySetting.deleteMany({ where: { companyId: a.companyId } });
  });

  describe('equivalence suggestions and link', () => {
    it('suggests products with the same type and d×D×B, and drops them once linked', async () => {
      const original = await commands.create(bearing({ manufacturerCode: 'EQ-ORIG', attributes: { seal: '2RS' } }));
      const twin = await commands.create(bearing({ manufacturerCode: 'EQ-TWIN', attributes: { seal: 'Abierto' } }));
      const other = await commands.create(bearing({ manufacturerCode: 'EQ-OTHER', innerDiameter: '30' }));

      const before = await equivalences.suggestions(original.id);
      expect(before.items.map((i) => i.productId)).toContain(twin.id);
      expect(before.items.map((i) => i.productId)).not.toContain(other.id);
      expect(before.items.find((i) => i.productId === twin.id)?.kind).toBe('WITH_DIFFERENCES');

      await equivalences.link({ productAId: original.id, productBId: twin.id });
      const after = await equivalences.suggestions(original.id);
      expect(after.items.map((i) => i.productId)).not.toContain(twin.id);
    });

    it('finds candidates by measures for a product that is not saved yet, exact first', async () => {
      await commands.create(bearing({ manufacturerCode: 'CAND-EXACT', attributes: { seal: '2RS' } }));
      await commands.create(bearing({ manufacturerCode: 'CAND-DIFF', attributes: { seal: 'Abierto' } }));

      const found = await equivalences.candidates({
        categoryId: a.bearings,
        innerDiameter: '25',
        outerDiameter: '52',
        width: '15',
        attributes: { seal: '2RS' },
      });
      const byCode = new Map(found.items.map((i) => [i.manufacturerCode, i.kind]));
      expect(byCode.get('CAND-EXACT')).toBe('EXACT');
      expect(byCode.get('CAND-DIFF')).toBe('WITH_DIFFERENCES');
      expect(found.items[0].kind).toBe('EXACT');

      expect((await equivalences.candidates({ categoryId: a.bearings, innerDiameter: '99', outerDiameter: '52', width: '15' })).items).toEqual([]);
      expect(await rejection(equivalences.candidates({ categoryId: randomUUID(), innerDiameter: '25', outerDiameter: '52', width: '15' }))).toMatchObject({
        status: 404,
        code: 'CATEGORY_NOT_FOUND',
      });
    });

    it('stores a link once whichever way round it is made', async () => {
      const first = await commands.create(bearing({ manufacturerCode: 'LINK-1' }));
      const second = await commands.create(bearing({ manufacturerCode: 'LINK-2' }));
      const linked = await equivalences.link({ productAId: first.id, productBId: second.id });
      expect(linked.productAId < linked.productBId).toBe(true);

      expect(await rejection(equivalences.link({ productAId: second.id, productBId: first.id }))).toMatchObject({
        status: 409,
        code: 'EQUIVALENCE_EXISTS',
      });
    });

    it('refuses a product linked to itself (422 SELF_LINK)', async () => {
      const solo = await commands.create(bearing({ manufacturerCode: 'SOLO-1' }));
      expect(await rejection(equivalences.link({ productAId: solo.id, productBId: solo.id }))).toMatchObject({
        status: 422,
        code: 'SELF_LINK',
      });
    });
  });

  it('gives a subcategory without its own fields the parent’s definitions', async () => {
    const sub = await base.category.create({ data: { companyId: a.companyId, name: 'Rodamientos rígidos', parentId: a.bearings } });
    const fields = await products.attributeDefinitions(sub.id);
    expect(fields).toMatchObject({ categoryId: sub.id, definedOn: a.bearings });
    expect(fields.items.map((i) => i.key)).toEqual(['bore', 'seal']);
    await expect(products.attributeDefinitions(randomUUID())).rejects.toMatchObject({ status: 404 });
  });

  it('maps a missing brand or category to 422 with its own code', async () => {
    const unknown = randomUUID();
    expect(await rejection(commands.create(bearing({ manufacturerCode: 'NO-BRAND', brandId: unknown })))).toMatchObject({
      status: 422,
      code: 'BRAND_NOT_FOUND',
    });
    expect(await rejection(commands.create(bearing({ manufacturerCode: 'NO-CAT', categoryId: unknown })))).toMatchObject({
      status: 422,
      code: 'CATEGORY_NOT_FOUND',
    });
  });
});

