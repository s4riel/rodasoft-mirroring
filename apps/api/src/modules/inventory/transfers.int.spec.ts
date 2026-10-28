/**
 * Integration test of transfers (HU-INV-18) against the real Postgres (DATABASE_URL): drafts, the list, resolving pasted
 * and uploaded lists, and sending, which writes the movements, the audit entry and the outbox event in one transaction.
 * Concurrency: two sends over the same scarce stock never leave negative stock or a partial send.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import { StockMovementService } from './stock-movement.service';
import { StockQueriesService } from './stock-queries.service';
import { TransfersService } from './transfers.service';

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

let granted = new Set<string>(['inventory.transfers.create', 'inventory.costs.view']);
let restrictedMembershipId = '';
let restrictedBranchId = '';
const membership = {
  permissions: async () => granted,
  operableBranchIds: async (id: string) => (id === restrictedMembershipId ? [restrictedBranchId] : null),
} as never;

const settings = new SettingsService(prisma);
const stockService = new StockMovementService(cls, settings);
const service = new TransfersService(prisma, cls, stockService, settings, new AuditService(prisma, cls), new OutboxService(prisma, cls), membership);
const queries = new StockQueriesService(prisma, cls);

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

describe('TransfersService (integration, real Postgres)', () => {
  let companyId: string;
  let otherCompanyId: string;
  let central: string;
  let north: string;
  let northAnnex: string;
  let inactive: string;
  let brandId: string;
  let categoryId: string;
  let userId: string;
  let membershipId: string;
  let seq = 0;

  /** A product with a known stock in a warehouse, loaded through the same service path as real stock. */
  async function productWithStock(stock: number, opts: { cost?: string | null; warehouseId?: string; status?: 'ACTIVE' | 'INACTIVE' } = {}) {
    seq += 1;
    const product = await base.product.create({
      data: {
        companyId,
        sku: `TR-${run}-${seq}`,
        manufacturerCode: `TRC-${run}-${seq}`,
        brandId,
        categoryId,
        name: 'Transfer test',
        salePrice: '10.00',
        cost: opts.cost === undefined ? '5.0000' : opts.cost,
        status: opts.status ?? 'ACTIVE',
      },
    });
    if (stock > 0) {
      await base.tenant.$transaction((tx) =>
        stockService.apply(tx, { productId: product.id, warehouseId: opts.warehouseId ?? central, type: 'INITIAL', quantity: stock, reason: 'Initial load' }),
      );
    }
    return product;
  }

  const save = (lines: { productId: string; quantity: number }[], over: Record<string, unknown> = {}) =>
    service.create({ originWarehouseId: central, destinationWarehouseId: north, lines, ...over } as never);

  const levelOf = async (productId: string, warehouseId = central) =>
    (await base.stockLevel.findFirst({ where: { productId, warehouseId } }))?.quantity ?? 0;

  const setSetting = (key: string, value: unknown) =>
    base.companySetting.upsert({ where: { companyId_key: { companyId, key } }, create: { companyId, key, value: value as never }, update: { value: value as never } });
  const clearSetting = (key: string) => base.companySetting.deleteMany({ where: { companyId, key } });

  beforeAll(async () => {
    const company = await base.company.create({ data: { slug: `tr-${run}`, legalName: 'tr', tradeName: 'tr', nit: `T${run}`.slice(0, 20) } });
    const other = await base.company.create({ data: { slug: `tr2-${run}`, legalName: 'tr2', tradeName: 'tr2', nit: `U${run}`.slice(0, 20) } });
    companyId = company.id;
    otherCompanyId = other.id;
    current = companyId;
    const branch0 = await base.branch.create({ data: { companyId, code: 0, name: 'Central' } });
    const branch1 = await base.branch.create({ data: { companyId, code: 1, name: 'Norte' } });
    restrictedBranchId = branch0.id;
    central = (await base.warehouse.create({ data: { companyId, branchId: branch0.id, code: `C-${run}`, name: 'Almacén Central', isMain: true } })).id;
    north = (await base.warehouse.create({ data: { companyId, branchId: branch1.id, code: `N-${run}`, name: 'Almacén Norte', isMain: true } })).id;
    northAnnex = (await base.warehouse.create({ data: { companyId, branchId: branch1.id, code: `NA-${run}`, name: 'Anexo Norte' } })).id;
    inactive = (await base.warehouse.create({ data: { companyId, branchId: branch1.id, code: `X-${run}`, name: 'Cerrado', status: 'INACTIVE' } })).id;
    const country = await base.country.create({ data: { companyId, code: 'SE', name: 'Suecia' } });
    brandId = (await base.brand.create({ data: { companyId, name: `Marca ${run}`, countryId: country.id } })).id;
    categoryId = (await base.category.create({ data: { companyId, name: `Cat ${run}` } })).id;

    const role = await base.role.create({ data: { companyId, key: 'warehouse', name: 'Almacén' } });
    userId = (await base.user.create({ data: { email: `tr-${run}@example.com`, name: 'Transferor' } })).id;
    const user2 = await base.user.create({ data: { email: `tr2-${run}@example.com`, name: 'Restricted' } });
    membershipId = (await base.membership.create({ data: { companyId, userId, roleId: role.id, allBranches: true } })).id;
    restrictedMembershipId = (
      await base.membership.create({ data: { companyId, userId: user2.id, roleId: role.id, branches: { create: { branchId: branch0.id } } } })
    ).id;
    currentMembership = membershipId;
    currentUser = userId;
  });

  afterAll(async () => {
    await purgeMovements([companyId, otherCompanyId]);
    await base.outboxEvent.deleteMany({ where: { companyId } });
    await base.auditLog.deleteMany({ where: { companyId } });
    await base.companySetting.deleteMany({ where: { companyId } });
    await base.transferItem.deleteMany({ where: { companyId } });
    await base.transfer.deleteMany({ where: { companyId } });
    await base.stockLevel.deleteMany({ where: { companyId } });
    await base.product.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
    await base.membership.deleteMany({ where: { companyId } });
    await base.user.deleteMany({ where: { email: { in: [`tr-${run}@example.com`, `tr2-${run}@example.com`] } } });
    await base.role.deleteMany({ where: { companyId } });
    await base.category.deleteMany({ where: { companyId } });
    await base.brand.deleteMany({ where: { companyId } });
    await base.warehouse.deleteMany({ where: { companyId } });
    await base.branch.deleteMany({ where: { companyId } });
    await base.country.deleteMany({ where: { companyId } });
    await base.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
    await base.$disconnect();
  });

  beforeEach(() => {
    current = companyId;
    currentMembership = membershipId;
    granted = new Set(['inventory.transfers.create', 'inventory.costs.view']);
  });

  describe('drafts', () => {
    it('creates a numbered draft with its lines, totals and a flag on the line without stock', async () => {
      const a = await productWithStock(10);
      const b = await productWithStock(2, { cost: '2.5000' });
      const detail = await save([
        { productId: a.id, quantity: 4 },
        { productId: b.id, quantity: 3 },
      ]);

      expect(detail.number).toMatch(/^TR-\d{6}$/);
      expect(detail.status).toBe('DRAFT');
      expect(detail.origin.name).toBe('Almacén Central');
      expect(detail.destination.branch.name).toBe('Norte');
      expect(detail.summary).toMatchObject({ products: 2, pieces: 7, value: '27.50', errors: 1 });
      expect(detail.lines.find((l) => l.productId === b.id)).toMatchObject({ available: 2, status: 'INSUFFICIENT_STOCK' });
      expect(detail.lines.find((l) => l.productId === a.id)?.status).toBe('OK');
      expect(await base.auditLog.count({ where: { companyId, action: 'inventory.transfer.create', entityId: detail.id } })).toBe(1);
      expect(await base.stockMovement.count({ where: { productId: a.id, type: 'TRANSFER_OUT' } })).toBe(0);
    });

    it('numbers drafts in sequence', async () => {
      const a = await save([]);
      const b = await save([]);
      expect(Number(b.number.slice(3))).toBe(Number(a.number.slice(3)) + 1);
    });

    it('hides the value from a viewer without cost permission', async () => {
      const p = await productWithStock(5);
      const created = await save([{ productId: p.id, quantity: 2 }]);
      granted = new Set(['inventory.transfers.create']);
      const detail = await service.get(created.id);
      expect(detail.summary.value).toBeNull();
      const list = await service.list({});
      expect(list.items.find((i) => i.id === created.id)?.value).toBeNull();
    });

    it('refuses the same warehouse, an inactive one, a repeated product, an unknown product and too many lines', async () => {
      const p = await productWithStock(5);
      expect(await codeOf(save([], { destinationWarehouseId: central }))).toBe('SAME_WAREHOUSE');
      expect(await codeOf(save([], { destinationWarehouseId: inactive }))).toBe('WAREHOUSE_INACTIVE');
      expect(
        await codeOf(
          save([
            { productId: p.id, quantity: 1 },
            { productId: p.id, quantity: 2 },
          ]),
        ),
      ).toBe('VALIDATION_FAILED');
      expect(await codeOf(save([{ productId: randomUUID(), quantity: 1 }]))).toBe('PRODUCT_NOT_FOUND');

      await setSetting('transfers.maxLines', 1);
      const q = await productWithStock(5);
      expect(
        await codeOf(
          save([
            { productId: p.id, quantity: 1 },
            { productId: q.id, quantity: 1 },
          ]),
        ),
      ).toBe('TOO_MANY_LINES');
      await clearSetting('transfers.maxLines');
    });

    it('updates a draft with the optimistic lock and refuses edits after it was sent', async () => {
      const a = await productWithStock(10);
      const b = await productWithStock(10);
      const draft = await save([{ productId: a.id, quantity: 1 }]);

      const updated = await service.update(draft.id, {
        originWarehouseId: central,
        destinationWarehouseId: north,
        note: 'urgente',
        lines: [{ productId: b.id, quantity: 5 }],
        expectedUpdatedAt: draft.updatedAt,
      });
      expect(updated.lines.map((l) => l.productId)).toEqual([b.id]);
      expect(updated.note).toBe('urgente');

      // the first editor still holds the old updatedAt
      expect(
        await codeOf(
          service.update(draft.id, { originWarehouseId: central, destinationWarehouseId: north, lines: [], expectedUpdatedAt: draft.updatedAt }),
        ),
      ).toBe('TRANSFER_MODIFIED');

      await service.send(draft.id, {});
      expect(
        await codeOf(
          service.update(draft.id, { originWarehouseId: central, destinationWarehouseId: north, lines: [], expectedUpdatedAt: (await service.get(draft.id)).updatedAt }),
        ),
      ).toBe('TRANSFER_NOT_EDITABLE');
    });

    it('saves and sends a draft of 500 lines, the default maximum', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 500; i++) {
        seq += 1;
        ids.push(
          (
            await base.product.create({
              data: { companyId, sku: `B-${run}-${seq}`, manufacturerCode: `BC-${run}-${seq}`, brandId, categoryId, name: 'Bulk', salePrice: '1.00', cost: '1.0000' },
            })
          ).id,
        );
      }
      await base.tenant.$transaction(
        async (tx) => {
          for (const productId of ids) {
            await stockService.apply(tx, { productId, warehouseId: central, type: 'INITIAL', quantity: 3, reason: 'Initial load' });
          }
        },
        // loading 500 products is the slow part of this test; the send itself has its own window in the service
        { timeout: 120_000 },
      );

      const draft = await save(ids.map((productId) => ({ productId, quantity: 2 })));
      expect(draft.summary).toMatchObject({ products: 500, pieces: 1000, value: '1000.00', errors: 0 });
      const sent = await service.send(draft.id, {});
      expect(sent.status).toBe('IN_TRANSIT');
      expect(await base.stockMovement.count({ where: { refId: draft.id, type: 'TRANSFER_OUT' } })).toBe(500);
    }, 180_000);
  });

  describe('list', () => {
    it('filters by status, origin, destination, number and date, and paginates', async () => {
      const p = await productWithStock(5);
      const draft = await save([{ productId: p.id, quantity: 1 }]);
      const other = await save([], { destinationWarehouseId: northAnnex });
      await service.cancel(other.id);

      const all = await service.list({ pageSize: 100 });
      expect(all.items.map((i) => i.id)).toEqual(expect.arrayContaining([draft.id, other.id]));
      expect(all.items[0]).toMatchObject({ origin: { name: 'Almacén Central' }, createdBy: 'Transferor' });

      expect((await service.list({ status: 'CANCELLED', pageSize: 100 })).items.map((i) => i.id)).toContain(other.id);
      expect((await service.list({ status: 'CANCELLED', pageSize: 100 })).items.map((i) => i.id)).not.toContain(draft.id);
      expect((await service.list({ destinationWarehouseId: northAnnex, pageSize: 100 })).items.map((i) => i.id)).toEqual([other.id]);
      expect((await service.list({ originWarehouseId: north, pageSize: 100 })).total).toBe(0);
      expect((await service.list({ q: draft.number })).items.map((i) => i.id)).toEqual([draft.id]);
      // the search box also takes a branch name, from either side of the transfer
      expect((await service.list({ q: 'Norte', pageSize: 100 })).items.map((i) => i.id)).toEqual(expect.arrayContaining([draft.id, other.id]));
      expect((await service.list({ q: 'no-such-branch' })).total).toBe(0);

      const today = new Date().toISOString().slice(0, 10);
      expect((await service.list({ from: today, to: today, pageSize: 100 })).total).toBeGreaterThanOrEqual(2);
      expect(await codeOf(service.list({ from: '2026-02-02', to: '2026-01-01' }))).toBe('INVALID_FILTER');

      const page = await service.list({ pageSize: 1, page: 2 });
      expect(page).toMatchObject({ page: 2, pageSize: 1 });
      expect(page.items).toHaveLength(1);
    });

    it('is limited to the member\'s branches and to the company', async () => {
      const visible = await save([]);
      const hidden = await save([], { originWarehouseId: north, destinationWarehouseId: northAnnex });

      currentMembership = restrictedMembershipId;
      const ids = (await service.list({ pageSize: 100 })).items.map((i) => i.id);
      expect(ids).toContain(visible.id);
      expect(ids).not.toContain(hidden.id);
      expect(await codeOf(service.get(hidden.id))).toBe('TRANSFER_NOT_FOUND');
      // writing from a branch the member does not operate is forbidden
      expect(await codeOf(save([], { originWarehouseId: north, destinationWarehouseId: central }))).toBe('BRANCH_FORBIDDEN');

      currentMembership = membershipId;
      current = otherCompanyId;
      expect((await service.list({ pageSize: 100 })).total).toBe(0);
      expect(await codeOf(service.get(visible.id))).toBe('TRANSFER_NOT_FOUND');
    });

    it('is refused without a transfer permission', async () => {
      granted = new Set(['inventory.products.view']);
      expect(await codeOf(service.list({}))).toBe('NO_PERMISSION');
      granted = new Set(['inventory.transfers.receive']);
      await expect(service.list({})).resolves.toMatchObject({ page: 1 });
      expect(await codeOf(save([]))).toBe('NO_PERMISSION');
    });
  });

  describe('warehouse options', () => {
    it('lists every active warehouse and flags the ones the member can send from', async () => {
      const all = (await service.warehouses()).items;
      expect(all.map((w) => w.id)).toEqual(expect.arrayContaining([central, north, northAnnex]));
      expect(all.map((w) => w.id)).not.toContain(inactive);
      expect(all.every((w) => w.canSendFrom)).toBe(true);

      currentMembership = restrictedMembershipId;
      const restricted = (await service.warehouses()).items;
      expect(restricted.find((w) => w.id === central)?.canSendFrom).toBe(true);
      expect(restricted.find((w) => w.id === north)).toMatchObject({ canSendFrom: false, branch: { name: 'Norte' } });
    });
  });

  describe('product search and resolving lists', () => {
    it('finds by code with the stock at the origin and puts the exact code first', async () => {
      const exact = await productWithStock(7);
      const found = await service.productSearch({ warehouseId: central, q: exact.manufacturerCode });
      expect(found.items[0]).toMatchObject({ id: exact.id, available: 7, brand: `Marca ${run}`, unitCost: '5.0000' });
      granted = new Set(['inventory.transfers.create']);
      expect((await service.productSearch({ warehouseId: central, q: exact.manufacturerCode })).items[0].unitCost).toBeNull();
      granted = new Set(['inventory.transfers.create', 'inventory.costs.view']);
      expect((await service.productSearch({ warehouseId: central, q: `Marca ${run}` })).items.length).toBeGreaterThan(0);
      expect((await service.productSearch({ warehouseId: central, q: 'zzz-no-such-code' })).items).toEqual([]);
      const inactiveProduct = await productWithStock(1, { status: 'INACTIVE' });
      expect((await service.productSearch({ warehouseId: central, q: inactiveProduct.manufacturerCode })).items).toEqual([]);
    });

    it('classifies a pasted list before anything is added', async () => {
      const ok = await productWithStock(10);
      const low = await productWithStock(1);
      const off = await productWithStock(10, { status: 'INACTIVE' });
      const text = [`${ok.manufacturerCode}, 3`, `${low.manufacturerCode}\t5`, `${off.manufacturerCode};1`, 'NOPE-123,2', 'bad line', `${ok.manufacturerCode},2`].join('\n');

      const result = await service.resolveLines({ warehouseId: central, text }, undefined);
      expect(result.counts).toEqual({ RECOGNIZED: 1, INSUFFICIENT_STOCK: 1, INACTIVE: 1, NOT_FOUND: 1 });
      expect(result.errors).toEqual([expect.objectContaining({ line: 5, reason: 'MISSING_QUANTITY' })]);
      // the repeated code was summed into its first line
      expect(result.lines.find((l) => l.group === 'RECOGNIZED')).toMatchObject({ quantity: 5, available: 10 });
      expect(result.lines.find((l) => l.group === 'INSUFFICIENT_STOCK')).toMatchObject({ available: 1 });
      expect(result.lines.find((l) => l.group === 'NOT_FOUND')?.product).toBeNull();
      expect(await base.transfer.count({ where: { companyId, items: { some: { productId: ok.id } } } })).toBe(0);
    });

    it('merges the manufacturer code and the SKU of one product into a single line checked against the stock together', async () => {
      const p = await productWithStock(5);
      const result = await service.resolveLines({ warehouseId: central, text: `${p.manufacturerCode}, 3\n${p.sku}, 3` }, undefined);
      expect(result.lines).toHaveLength(1);
      expect(result.lines[0]).toMatchObject({ group: 'INSUFFICIENT_STOCK', quantity: 6, available: 5 });
      expect(result.counts).toMatchObject({ INSUFFICIENT_STOCK: 1, RECOGNIZED: 0 });
    });

    it('puts a product found by its exact SKU first', async () => {
      const p = await productWithStock(2);
      expect((await service.productSearch({ warehouseId: central, q: p.sku })).items[0]).toMatchObject({ id: p.id, sku: p.sku });
    });

    it('reads an uploaded .xlsx and a .csv with the same rules, and refuses other files', async () => {
      const p = await productWithStock(10);
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Lista');
      sheet.addRow(['Código', 'Cantidad']);
      sheet.addRow([p.manufacturerCode, 4]);
      sheet.addRow(['NOPE-9', 1]);
      const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());

      const fromXlsx = await service.resolveLines({ warehouseId: central }, { buffer: xlsx, size: xlsx.length, originalname: 'lista.xlsx' });
      expect(fromXlsx.counts).toMatchObject({ RECOGNIZED: 1, NOT_FOUND: 1 });

      const csv = Buffer.from(`code,quantity\r\n${p.manufacturerCode},2\r\n`);
      const fromCsv = await service.resolveLines({ warehouseId: central }, { buffer: csv, size: csv.length, originalname: 'lista.csv' });
      expect(fromCsv.lines).toEqual([expect.objectContaining({ group: 'RECOGNIZED', quantity: 2 })]);

      // Excel saves a UTF-8 CSV with a byte order mark; it must not end up glued to the first code
      const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), csv]);
      const fromBom = await service.resolveLines({ warehouseId: central }, { buffer: withBom, size: withBom.length, originalname: 'excel.csv' });
      expect(fromBom.lines).toEqual([expect.objectContaining({ group: 'RECOGNIZED', quantity: 2 })]);

      const binary = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]);
      expect(await codeOf(service.resolveLines({ warehouseId: central }, { buffer: binary, size: binary.length, originalname: 'x.pdf' }))).toBe('FILE_INVALID');
      const huge = Buffer.alloc(1024 * 1024 + 1, 'a');
      expect(await codeOf(service.resolveLines({ warehouseId: central }, { buffer: huge, size: huge.length, originalname: 'x.csv' }))).toBe('FILE_TOO_LARGE');
      expect(await codeOf(service.resolveLines({ warehouseId: central }, undefined))).toBe('VALIDATION_FAILED');
    });
  });

  describe('send', () => {
    it('takes the stock out of the origin, freezes totals, and writes audit and outbox in the same transaction', async () => {
      const a = await productWithStock(10, { cost: '5.0000' });
      const b = await productWithStock(4, { cost: null });
      const draft = await save([
        { productId: a.id, quantity: 6 },
        { productId: b.id, quantity: 4 },
      ]);

      const sent = await service.send(draft.id, { expectedUpdatedAt: draft.updatedAt });

      expect(sent.status).toBe('IN_TRANSIT');
      expect(sent.sentAt).not.toBeNull();
      expect(sent.summary).toMatchObject({ pieces: 10, value: '30.00' });
      expect(await levelOf(a.id)).toBe(4);
      expect(await levelOf(b.id)).toBe(0);
      expect(await levelOf(a.id, north)).toBe(0);

      const movement = await base.stockMovement.findFirstOrThrow({ where: { productId: a.id, type: 'TRANSFER_OUT' } });
      expect(movement).toMatchObject({ quantity: -6, balanceAfter: 4, refType: 'TRANSFER', refId: draft.id, refNumber: draft.number, warehouseId: central });
      expect(movement.unitCost?.toFixed(4)).toBe('5.0000');
      expect((await base.transferItem.findFirstOrThrow({ where: { transferId: draft.id, productId: a.id } })).unitCost?.toFixed(4)).toBe('5.0000');
      expect(await base.auditLog.count({ where: { companyId, action: 'inventory.transfer.send', entityId: draft.id } })).toBe(1);
      expect(await base.outboxEvent.count({ where: { companyId, type: 'inventory.transfer.sent', idempotencyKey: `inventory.transfer.sent:${draft.id}` } })).toBe(1);
      const saved = await base.transfer.findFirstOrThrow({ where: { id: draft.id } });
      expect(saved).toMatchObject({ sentById: userId, totalPieces: 10 });
      expect(saved.totalValue.toFixed(2)).toBe('30.00');

      // the list names who sent it (the "Detalle" column of IN-05)
      expect((await service.list({ q: draft.number })).items[0]).toMatchObject({ status: 'IN_TRANSIT', createdBy: 'Transferor', sentBy: 'Transferor' });

      // the pieces show as incoming at the destination until HU-INV-21 receives them
      const stock = await queries.stockByWarehouse(a.id);
      expect(stock.items.find((i) => i.warehouse.id === north)).toMatchObject({ inTransit: 6, quantity: 0 });
      expect(stock.items.find((i) => i.warehouse.id === central)).toMatchObject({ inTransit: 0, quantity: 4 });
    });

    it('refuses a send with an erroring line, writes nothing, and says which line', async () => {
      const ok = await productWithStock(10);
      const low = await productWithStock(1);
      const draft = await save([
        { productId: ok.id, quantity: 2 },
        { productId: low.id, quantity: 5 },
      ]);

      let details: { lines: { productId: string; status: string }[] } | undefined;
      try {
        await service.send(draft.id, {});
      } catch (err) {
        const body = (err as { getResponse(): { code: string; details: typeof details } }).getResponse();
        expect(body.code).toBe('TRANSFER_HAS_ERRORS');
        details = body.details;
      }
      expect(details?.lines).toEqual([expect.objectContaining({ productId: low.id, status: 'INSUFFICIENT_STOCK' })]);
      expect(await levelOf(ok.id)).toBe(10);
      expect(await base.stockMovement.count({ where: { refId: draft.id } })).toBe(0);
      expect((await base.transfer.findFirstOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
    });

    it('refuses an empty transfer, an inactive product, a stale draft and a second send', async () => {
      const p = await productWithStock(5);
      expect(await codeOf(service.send((await save([])).id, {}))).toBe('TRANSFER_EMPTY');

      const off = await productWithStock(5);
      const withOff = await save([{ productId: off.id, quantity: 1 }]);
      await base.product.update({ where: { id: off.id }, data: { status: 'INACTIVE' } });
      expect(await codeOf(service.send(withOff.id, {}))).toBe('TRANSFER_HAS_ERRORS');

      const draft = await save([{ productId: p.id, quantity: 1 }]);
      expect(await codeOf(service.send(draft.id, { expectedUpdatedAt: new Date(0).toISOString() }))).toBe('TRANSFER_MODIFIED');
      await service.send(draft.id, {});
      expect(await codeOf(service.send(draft.id, {}))).toBe('INVALID_TRANSITION');
      expect(await levelOf(p.id)).toBe(4);
    });

    it('has no approval step: a transfer of any size goes straight to in transit', async () => {
      const p = await productWithStock(20);
      // a threshold left over in the company settings from before is ignored
      await setSetting('transfers.approvalThresholdPieces', 1);
      try {
        const big = await save([{ productId: p.id, quantity: 12 }]);
        const sent = await service.send(big.id, {});

        expect(sent.status).toBe('IN_TRANSIT');
        expect(await levelOf(p.id)).toBe(8);
        expect(await base.stockMovement.count({ where: { refId: big.id, type: 'TRANSFER_OUT' } })).toBe(1);
        expect(await base.outboxEvent.count({ where: { companyId, type: 'inventory.transfer.sent', idempotencyKey: `inventory.transfer.sent:${big.id}` } })).toBe(1);
        expect(await base.outboxEvent.count({ where: { companyId, idempotencyKey: `inventory.transfer.approval-requested:${big.id}` } })).toBe(0);
        expect(await base.auditLog.count({ where: { companyId, entityId: big.id, action: { contains: 'approval' } } })).toBe(0);
      } finally {
        await clearSetting('transfers.approvalThresholdPieces');
      }
    });

    it('rolls back every movement when a later line cannot be taken', async () => {
      const [a, b, c] = [await productWithStock(10), await productWithStock(10), await productWithStock(10)];
      const draft = await save([a, b, c].map((p) => ({ productId: p.id, quantity: 4 })));

      // the stock of the third product is taken by someone else between the pre-check and its movement
      const original = stockService.apply.bind(stockService);
      let calls = 0;
      const spy = jest.spyOn(stockService, 'apply').mockImplementation((tx, input) => {
        calls += 1;
        if (calls === 3) throw new UnprocessableEntityException({ code: 'INSUFFICIENT_STOCK', message: 'Not enough stock in the warehouse' });
        return original(tx, input);
      });
      try {
        expect(await codeOf(service.send(draft.id, {}))).toBe('INSUFFICIENT_STOCK');
      } finally {
        spy.mockRestore();
      }

      expect(calls).toBe(3);
      for (const p of [a, b, c]) expect(await levelOf(p.id)).toBe(10);
      expect(await base.stockMovement.count({ where: { refId: draft.id } })).toBe(0);
      expect((await base.transfer.findFirstOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
      expect(await base.outboxEvent.count({ where: { companyId, idempotencyKey: `inventory.transfer.sent:${draft.id}` } })).toBe(0);
      expect(await base.auditLog.count({ where: { companyId, action: 'inventory.transfer.send', entityId: draft.id } })).toBe(0);
    });

    it('refuses to send to a destination that was closed after the draft was saved', async () => {
      const p = await productWithStock(5);
      const closing = (await base.warehouse.create({ data: { companyId, branchId: (await base.warehouse.findFirstOrThrow({ where: { id: north } })).branchId, code: `Z-${run}`, name: 'Por cerrar' } })).id;
      const draft = await save([{ productId: p.id, quantity: 1 }], { destinationWarehouseId: closing });
      await base.warehouse.update({ where: { id: closing }, data: { status: 'INACTIVE' } });

      expect(await codeOf(service.send(draft.id, {}))).toBe('WAREHOUSE_INACTIVE');
      expect(await levelOf(p.id)).toBe(5);
      expect(await base.stockMovement.count({ where: { refId: draft.id } })).toBe(0);
    });

    it('cancels a draft, and refuses to cancel one that is already in transit', async () => {
      const p = await productWithStock(5);
      const draft = await save([{ productId: p.id, quantity: 1 }]);
      expect((await service.cancel(draft.id)).status).toBe('CANCELLED');
      expect(await base.auditLog.count({ where: { companyId, action: 'inventory.transfer.cancel', entityId: draft.id } })).toBe(1);

      const sent = await save([{ productId: p.id, quantity: 1 }]);
      await service.send(sent.id, {});
      expect(await codeOf(service.cancel(sent.id))).toBe('INVALID_TRANSITION');
    });
  });

  describe('open count', () => {
    it('counts the transfers still open that the member can see, and no draft, cancelled or received one', async () => {
      const p = await productWithStock(30);
      const before = (await service.openCount()).count;

      const draft = await save([{ productId: p.id, quantity: 1 }]);
      expect((await service.openCount()).count).toBe(before); // a draft is not open

      await service.send(draft.id, {});
      expect((await service.openCount()).count).toBe(before + 1);

      await base.transfer.update({ where: { id: draft.id }, data: { status: 'RECEIVED' } });
      expect((await service.openCount()).count).toBe(before);
      await base.transfer.update({ where: { id: draft.id }, data: { status: 'PARTIALLY_RECEIVED' } });
      expect((await service.openCount()).count).toBe(before + 1);

      // a member who operates neither branch of it does not count it
      currentMembership = restrictedMembershipId;
      const restrictedBefore = (await service.openCount()).count;
      expect(restrictedBefore).toBeGreaterThanOrEqual(1); // central is one of the sides
      current = otherCompanyId;
      expect((await service.openCount()).count).toBe(0);
    });

    it('is refused without a transfer permission', async () => {
      granted = new Set(['inventory.products.view']);
      expect(await codeOf(service.openCount())).toBe('NO_PERMISSION');
    });
  });

  describe('in transit', () => {
    it('counts only the sent, not yet received pieces of IN_TRANSIT and PARTIALLY_RECEIVED transfers', async () => {
      const p = await productWithStock(10);
      const transit = async (warehouseId: string) => (await queries.stockByWarehouse(p.id)).items.find((i) => i.warehouse.id === warehouseId)?.inTransit;

      const draft = await save([{ productId: p.id, quantity: 4 }]);
      expect(await transit(north)).toBeUndefined(); // a draft has sent nothing

      await service.send(draft.id, {});
      expect(await transit(north)).toBe(4);

      await base.transferItem.updateMany({ where: { transferId: draft.id }, data: { receivedQuantity: 1 } });
      await base.transfer.update({ where: { id: draft.id }, data: { status: 'PARTIALLY_RECEIVED' } });
      expect(await transit(north)).toBe(3);

      await base.transfer.update({ where: { id: draft.id }, data: { status: 'CANCELLED' } });
      expect(await transit(north)).toBeUndefined();
      await base.transfer.update({ where: { id: draft.id }, data: { status: 'RECEIVED' } });
      expect(await transit(north)).toBeUndefined();
    });
  });

  describe('concurrency', () => {
    it('two sends over the same scarce stock: one succeeds, the other is refused, and the level never goes negative', async () => {
      const p = await productWithStock(5);
      const first = await save([{ productId: p.id, quantity: 4 }]);
      const second = await save([{ productId: p.id, quantity: 4 }]);

      const results = await Promise.allSettled([service.send(first.id, {}), service.send(second.id, {})]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // depending on the interleaving the loser is stopped by the pre-check or by the locked movement; both are 422
      expect(['TRANSFER_HAS_ERRORS', 'INSUFFICIENT_STOCK']).toContain(rejected[0].reason.getResponse().code);

      expect(await levelOf(p.id)).toBe(1);
      expect(await base.stockMovement.count({ where: { productId: p.id, type: 'TRANSFER_OUT' } })).toBe(1);
      const statuses = (await base.transfer.findMany({ where: { id: { in: [first.id, second.id] } }, select: { status: true } })).map((t) => t.status).sort();
      expect(statuses).toEqual(['DRAFT', 'IN_TRANSIT']);
    });

    it('many sends over the same product in different line order never deadlock or oversell', async () => {
      const a = await productWithStock(10);
      const b = await productWithStock(10);
      const drafts = await Promise.all(
        Array.from({ length: 6 }, (_, i) =>
          save(i % 2 === 0 ? [{ productId: a.id, quantity: 2 }, { productId: b.id, quantity: 2 }] : [{ productId: b.id, quantity: 2 }, { productId: a.id, quantity: 2 }]),
        ),
      );
      const results = await Promise.allSettled(drafts.map((d) => service.send(d.id, {})));
      const sent = results.filter((r) => r.status === 'fulfilled').length;
      expect(sent).toBe(5);
      expect(await levelOf(a.id)).toBe(0);
      expect(await levelOf(b.id)).toBe(0);
    });

    it('a send racing a draft edit: whichever runs second sees the other (TRANSFER_MODIFIED or the edited lines)', async () => {
      const p = await productWithStock(10);
      const draft = await save([{ productId: p.id, quantity: 3 }]);

      const [edit, send] = await Promise.allSettled([
        service.update(draft.id, { originWarehouseId: central, destinationWarehouseId: north, lines: [{ productId: p.id, quantity: 7 }], expectedUpdatedAt: draft.updatedAt }),
        service.send(draft.id, { expectedUpdatedAt: draft.updatedAt }),
      ]);

      // the edit commits first -> the send holds the old updatedAt and is refused; the send commits first -> the edit finds it not editable
      if (edit.status === 'fulfilled') {
        expect(send.status).toBe('rejected');
        expect((send as PromiseRejectedResult).reason.getResponse().code).toBe('TRANSFER_MODIFIED');
        expect(await levelOf(p.id)).toBe(10);
      } else {
        expect(send.status).toBe('fulfilled');
        expect(['TRANSFER_MODIFIED', 'TRANSFER_NOT_EDITABLE']).toContain(edit.reason.getResponse().code);
        expect(await levelOf(p.id)).toBe(7);
      }
    });
  });
});
