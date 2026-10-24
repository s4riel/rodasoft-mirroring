/**
 * Integration test of the Excel product import (HU-INV-10) against the real Postgres (DATABASE_URL).
 * Creates throw-away companies and removes them at the end, so it is safe to run against the dev database.
 */
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../../common/audit/audit.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import { tenantExtension } from '../../common/prisma/tenant.extension';
import { SettingsService } from '../../common/settings/settings.service';
import { ProductCommandsService } from './product-commands.service';
import { type ImportFile, ProductImportService } from './product-import.service';
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
let granted = new Set<string>();
const ALL = ['inventory.costs.view', 'inventory.adjustments.create'];
const membership = { permissions: async () => granted, operableBranchIds: async () => null } as never;
const settings = new SettingsService(prisma);
const stock = new StockMovementService(cls, settings);
const audit = new AuditService(prisma, cls);
const outbox = new OutboxService(prisma, cls);
const commands = new ProductCommandsService(prisma, cls, audit, membership, settings, stock, outbox);
const importer = new ProductImportService(prisma, cls, audit, membership, settings, stock, commands);

interface Fixture {
  companyId: string;
  userId: string;
  hk01: string;
  hk02: string;
}

async function createCompany(tag: string): Promise<Fixture> {
  const company = await base.company.create({
    data: { slug: `imp-${tag}-${run}`, legalName: tag, tradeName: tag, nit: `I${tag}${run}`.slice(0, 20) },
  });
  const companyId = company.id;
  const branch = await base.branch.create({ data: { companyId, code: 0, name: 'Central' } });
  const hk01 = await base.warehouse.create({ data: { companyId, branchId: branch.id, code: 'HK-01', name: 'Principal', isMain: true } });
  const hk02 = await base.warehouse.create({ data: { companyId, branchId: branch.id, code: 'HK-02', name: 'Secundario' } });
  await base.warehouse.create({ data: { companyId, branchId: branch.id, code: 'OLD', name: 'Cerrado', status: 'INACTIVE' } });
  await base.brand.create({ data: { companyId, name: 'SKF' } });
  await base.brand.create({ data: { companyId, name: 'FAG' } });
  const category = await base.category.create({ data: { companyId, name: 'Rodamientos' } });
  await base.category.create({ data: { companyId, name: 'Rígidos de bolas', parentId: category.id } });
  await base.attributeDefinition.create({
    data: { companyId, categoryId: category.id, key: 'seal', label: 'Sello', type: 'ENUM', options: ['Abierto', '2RS'], step: 3 },
  });
  const role = await base.role.create({ data: { companyId, key: 'it', name: 'it' } });
  const user = await base.user.create({ data: { email: `imp-${tag}-${run}@test.local`, name: 'it' } });
  const member = await base.membership.create({ data: { companyId, userId: user.id, roleId: role.id, allBranches: true } });
  memberships.set(companyId, { membershipId: member.id, userId: user.id });
  return { companyId, userId: user.id, hk01: hk01.id, hk02: hk02.id };
}

/** The immutability trigger blocks DELETE on stock_movements; test cleanup bypasses it inside its own transaction. */
async function removeCompany(companyId: string) {
  await base.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.stockMovement.deleteMany({ where: { companyId } });
  });
  await base.outboxEvent.deleteMany({ where: { companyId } });
  await base.auditLog.deleteMany({ where: { companyId } });
  await base.companySetting.deleteMany({ where: { companyId } });
  await base.stockThreshold.deleteMany({ where: { companyId } });
  await base.stockLevel.deleteMany({ where: { companyId } });
  await base.productDimension.deleteMany({ where: { companyId } });
  await base.product.deleteMany({ where: { companyId } });
  await base.attributeDefinition.deleteMany({ where: { companyId } });
  await base.category.deleteMany({ where: { companyId, parentId: { not: null } } });
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

type Cell = string | number | null;
const HEAD: Cell[] = ['Código', 'Marca', 'Categoría', 'Precio', 'seal', 'Stock HK-01', 'Stock HK-02', 'Costo unitario'];

async function sheet(rows: Cell[][], head: Cell[] = HEAD, name = 'productos.xlsx'): Promise<ImportFile> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Productos');
  worksheet.addRow(head);
  rows.forEach((r) => worksheet.addRow(r));
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return { buffer, size: buffer.length, originalname: name };
}
/** A good row: code, brand, category, price and seal, then the given stock and cost cells. */
const good = (code: string, extra: Cell[] = []): Cell[] => [code, 'SKF', 'Rodamientos', 45.5, '2RS', ...extra];

async function rejection(promise: Promise<unknown>): Promise<{ status: number; code: string; details?: unknown }> {
  try {
    await promise;
  } catch (err) {
    const e = err as { getStatus(): number; getResponse(): { code: string; details?: unknown } };
    return { status: e.getStatus(), code: e.getResponse().code, details: e.getResponse().details };
  }
  throw new Error('expected the call to be rejected');
}

describe('ProductImportService (integration, real Postgres)', () => {
  let a: Fixture;
  let b: Fixture;
  const level = async (code: string, warehouseId: string) => {
    const product = await base.product.findFirstOrThrow({ where: { companyId: a.companyId, manufacturerCode: code } });
    return (await base.stockLevel.findFirst({ where: { productId: product.id, warehouseId } }))?.quantity ?? null;
  };
  const movements = async (code: string) => {
    const product = await base.product.findFirstOrThrow({ where: { companyId: a.companyId, manufacturerCode: code } });
    return base.stockMovement.findMany({ where: { productId: product.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  };
  const productCount = (prefix: string) => base.product.count({ where: { companyId: a.companyId, manufacturerCode: { startsWith: prefix } } });

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
    granted = new Set(ALL);
  });

  describe('the file', () => {
    it('rejects a file that is not an Excel workbook', async () => {
      const file = { buffer: Buffer.from('code,brand\n1,SKF'), size: 16, originalname: 'productos.xlsx' };
      expect(await rejection(importer.preview(file, 'create_only'))).toMatchObject({ status: 415, code: 'UNSUPPORTED_FILE_TYPE' });
    });

    it('rejects a file over the size limit', async () => {
      const file = await sheet([good('BIG-1')]);
      expect(await rejection(importer.preview({ ...file, size: 6 * 1024 * 1024 }, 'create_only'))).toMatchObject({ status: 413, code: 'FILE_TOO_LARGE' });
    });

    it('rejects a sheet without the required columns', async () => {
      const file = await sheet([['X1', 'SKF']], ['Código', 'Marca']);
      expect(await rejection(importer.preview(file, 'create_only'))).toMatchObject({
        status: 422,
        code: 'IMPORT_INVALID_TEMPLATE',
        details: { missing: ['Categoría'] },
      });
    });

    it('rejects a sheet with a header and no rows', async () => {
      expect(await rejection(importer.preview(await sheet([]), 'create_only'))).toMatchObject({ status: 422, code: 'IMPORT_INVALID_TEMPLATE' });
    });

    it('rejects more rows than the company limit', async () => {
      await base.companySetting.create({ data: { companyId: a.companyId, key: 'inventory.import.maxRows', value: 2 } });
      try {
        const file = await sheet([good('M-1'), good('M-2'), good('M-3')]);
        expect(await rejection(importer.preview(file, 'create_only'))).toMatchObject({ status: 422, code: 'IMPORT_TOO_MANY_ROWS', details: { max: 2 } });
      } finally {
        await base.companySetting.deleteMany({ where: { companyId: a.companyId, key: 'inventory.import.maxRows' } });
      }
    });

    it('refuses to create missing brands, which is not supported yet (#33)', async () => {
      await base.companySetting.create({ data: { companyId: a.companyId, key: 'inventory.import.createMissingBrands', value: true } });
      try {
        expect(await rejection(importer.preview(await sheet([good('NS-1')]), 'create_only'))).toMatchObject({ status: 409, code: 'NOT_SUPPORTED' });
      } finally {
        await base.companySetting.deleteMany({ where: { companyId: a.companyId, key: 'inventory.import.createMissingBrands' } });
      }
    });

    it('gives a template with the headers and one stock column per active warehouse', async () => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await importer.template()) as unknown as ArrayBuffer);
      const headers = (workbook.worksheets[0].getRow(1).values as string[]).slice(1);
      expect(headers).toEqual(['Código', 'Marca', 'Categoría', 'Subcategoría', 'Descripción', 'Precio', 'd', 'D', 'B', 'Costo unitario', 'Stock HK-01', 'Stock HK-02']);
    });
  });

  describe('preview', () => {
    it('reports every row and writes nothing', async () => {
      const file = await sheet([good('PV-1'), ['PV-2', 'Nueva', 'Rodamientos', 10], ['PV-3', 'SKF', 'Rodamientos', null]]);

      const result = await importer.preview(file, 'create_only');

      expect(result.summary).toMatchObject({ total: 3, valid: 1, withError: 2, toCreate: 1 });
      expect(result.rows.map((r) => [r.rowNumber, r.status, r.errors.map((e) => e.code)])).toEqual([
        [2, 'valid', []],
        [3, 'error', ['BRAND_NOT_FOUND']],
        [4, 'error', ['PRICE_REQUIRED']],
      ]);
      expect(await productCount('PV-')).toBe(0);
      expect(await base.stockMovement.count({ where: { companyId: a.companyId } })).toBe(0);
      expect(await base.auditLog.count({ where: { companyId: a.companyId, action: { startsWith: 'inventory.product' } } })).toBe(0);
    });

    it('flags a code repeated inside the file, in any case', async () => {
      const result = await importer.preview(await sheet([good('DUP-1'), good('dup-1')]), 'create_only');
      expect(result.rows.map((r) => r.errors.map((e) => e.code))).toEqual([[], ['DUPLICATE_IN_FILE']]);
    });

    it('counts a brand of another company as not found (tenant isolation)', async () => {
      await base.brand.create({ data: { companyId: b.companyId, name: 'NSK' } });
      const result = await importer.preview(await sheet([['TI-1', 'NSK', 'Rodamientos', 10]]), 'create_only');
      expect(result.rows[0].errors.map((e) => e.code)).toEqual(['BRAND_NOT_FOUND']);
    });

    it('makes an unknown or inactive stock warehouse a row error', async () => {
      const head = [...HEAD, 'Stock OLD', 'Stock XX'];
      const file = await sheet([[...good('WH-1', [null, null, null]), 3, null], [...good('WH-2', [null, null, null]), null, 2]], head);
      const result = await importer.preview(file, 'create_only');
      expect(result.rows.map((r) => r.errors.map((e) => e.code))).toEqual([['WAREHOUSE_INACTIVE'], ['WAREHOUSE_NOT_FOUND']]);
    });
  });

  describe('commit', () => {
    it('creates only the valid rows, with SKU, audit and outbox events', async () => {
      const file = await sheet([good('CM-1'), good('CM-2'), ['CM-3', 'Nueva', 'Rodamientos', 10], ['CM-4', 'SKF', 'Rodamientos', null]]);

      const result = await importer.commit(file, 'create_only');

      expect(result).toEqual({ created: 2, updated: 0, skipped: 2, stockMovements: 0 });
      const products = await base.product.findMany({ where: { companyId: a.companyId, manufacturerCode: { startsWith: 'CM-' } }, orderBy: { manufacturerCode: 'asc' } });
      expect(products.map((p) => p.manufacturerCode)).toEqual(['CM-1', 'CM-2']);
      expect(products.every((p) => /^RL-\d{6}$/.test(p.sku))).toBe(true);
      expect(products[0]).toMatchObject({ status: 'ACTIVE', attributes: { seal: '2RS' } });
      expect(products[0].salePrice.toFixed(2)).toBe('45.50');
      const ids = products.map((p) => p.id);
      expect(await base.auditLog.count({ where: { companyId: a.companyId, action: 'inventory.product.create', entityId: { in: ids } } })).toBe(2);
      const summary = await base.auditLog.findFirstOrThrow({ where: { companyId: a.companyId, action: 'inventory.product.import' } });
      expect(summary.after).toMatchObject({ file: 'productos.xlsx', mode: 'create_only', created: 2, skipped: 2 });
      const events = await base.outboxEvent.findMany({ where: { companyId: a.companyId, type: 'inventory.product-created' } });
      expect(events.filter((e) => ids.includes((e.payload as { productId: string }).productId))).toHaveLength(2);
    });

    it('is idempotent: running the same file in create-only mode creates nothing', async () => {
      const file = await sheet([good('ID-1'), good('ID-2')]);
      expect((await importer.commit(file, 'create_only')).created).toBe(2);

      const again = await importer.commit(file, 'create_only');

      expect(again).toEqual({ created: 0, updated: 0, skipped: 2, stockMovements: 0 });
      expect(await productCount('ID-')).toBe(2);
    });

    it('updates by brand and code in create-or-update mode and leaves blank cells alone', async () => {
      await importer.commit(await sheet([good('UP-1')]), 'create_only');

      const result = await importer.commit(await sheet([['up-1', 'SKF', 'Rodamientos', 60, null]]), 'create_or_update');

      expect(result).toMatchObject({ created: 0, updated: 1 });
      const product = await base.product.findFirstOrThrow({ where: { companyId: a.companyId, manufacturerCode: 'UP-1' } });
      expect(product.salePrice.toFixed(2)).toBe('60.00');
      expect(product.attributes).toMatchObject({ seal: '2RS' });
      expect(await base.auditLog.count({ where: { companyId: a.companyId, action: 'inventory.product.update', entityId: product.id } })).toBe(1);
    });

    it('two commits of the same file at once create every product exactly once', async () => {
      const file = await sheet([good('CC-1'), good('CC-2'), good('CC-3')]);

      const results = await Promise.all([importer.commit(file, 'create_only'), importer.commit(file, 'create_only')]);

      expect(results.map((r) => r.created).sort()).toEqual([0, 3]);
      expect(await productCount('CC-')).toBe(3);
    });

    it('does not let another company see the products', async () => {
      await importer.commit(await sheet([good('TN-1')]), 'create_only');
      current = b.companyId;
      const result = await importer.preview(await sheet([good('TN-1')]), 'create_only');
      expect(result.rows[0].errors).toEqual([]);
      expect(result.summary.toCreate).toBe(1);
    });
  });

  describe('stock', () => {
    it('opens the stock of a new product with an INITIAL movement and a matching level', async () => {
      const result = await importer.commit(await sheet([good('SK-1', [12, 3, 30])]), 'create_only');

      expect(result).toMatchObject({ created: 1, stockMovements: 2 });
      expect(await level('SK-1', a.hk01)).toBe(12);
      expect(await level('SK-1', a.hk02)).toBe(3);
      const rows = await movements('SK-1');
      expect(rows.map((m) => [m.type, m.quantity, m.balanceAfter, m.refType, m.refNumber, m.reason])).toEqual(
        expect.arrayContaining([
          ['INITIAL', 12, 12, 'IMPORT', 'productos.xlsx', 'Importación Excel'],
          ['INITIAL', 3, 3, 'IMPORT', 'productos.xlsx', 'Importación Excel'],
        ]),
      );
      expect(rows[0].unitCost?.toFixed(4)).toBe('30.0000');
    });

    it('adjusts an existing level to the target, and the kardex balance equals the level', async () => {
      await importer.commit(await sheet([good('SK-2', [10])]), 'create_only');

      const result = await importer.commit(await sheet([good('SK-2', [4])]), 'create_or_update');

      expect(result).toMatchObject({ updated: 1, stockMovements: 1 });
      expect(await level('SK-2', a.hk01)).toBe(4);
      const rows = await movements('SK-2');
      expect(rows.map((m) => [m.type, m.quantity])).toEqual([['INITIAL', 10], ['ADJUSTMENT_OUT', -6]]);
      expect(rows[rows.length - 1].balanceAfter).toBe(4);
    });

    it('creates no movement when the quantities are the same', async () => {
      await importer.commit(await sheet([good('SK-3', [7])]), 'create_only');

      const result = await importer.commit(await sheet([good('SK-3', [7])]), 'create_or_update');

      expect(result.stockMovements).toBe(0);
      expect(await movements('SK-3')).toHaveLength(1);
    });

    it('keeps a sale that races the import: the level always equals the sum of its movements', async () => {
      await importer.commit(await sheet([good('SK-4', [20])]), 'create_only');
      const product = await base.product.findFirstOrThrow({ where: { companyId: a.companyId, manufacturerCode: 'SK-4' } });

      await Promise.all([
        importer.commit(await sheet([good('SK-4', [10])]), 'create_or_update'),
        prisma.tenant.$transaction((tx) =>
          stock.apply(tx, { productId: product.id, warehouseId: a.hk01, type: 'SALE', quantity: -5, reason: 'Venta de prueba' }),
        ),
      ]);

      const rows = await movements('SK-4');
      const total = rows.reduce((sum, m) => sum + m.quantity, 0);
      expect(await level('SK-4', a.hk01)).toBe(total);
      expect([5, 10]).toContain(total);
    });

    it('rolls back the products and the stock together when a movement fails', async () => {
      const file = await sheet([good('RB-1', [5]), good('RB-2', [6])]);
      const real = stock.apply.bind(stock);
      const spy = jest.spyOn(stock, 'apply').mockImplementationOnce(real).mockRejectedValueOnce(new Error('boom'));
      try {
        await expect(importer.commit(file, 'create_only')).rejects.toThrow('boom');
      } finally {
        spy.mockRestore();
      }

      expect(await productCount('RB-')).toBe(0);
      expect(await base.stockLevel.count({ where: { companyId: a.companyId, product: { manufacturerCode: { startsWith: 'RB-' } } } })).toBe(0);
    });

    it('asks for the adjustments permission when the file has stock', async () => {
      granted = new Set(['inventory.costs.view']);
      expect(await rejection(importer.commit(await sheet([good('NP-1', [5])]), 'create_only'))).toMatchObject({
        status: 403,
        code: 'NO_PERMISSION',
        details: { missing: ['inventory.adjustments.create'], rows: 1 },
      });
      expect(await productCount('NP-1')).toBe(0);
      // a file without stock does not need it
      expect((await importer.commit(await sheet([good('NP-2')]), 'create_only')).created).toBe(1);
    });

    it('does not store the unit cost of someone who cannot see costs', async () => {
      granted = new Set(['inventory.adjustments.create']);
      await importer.commit(await sheet([good('NC-1', [5, null, 30])]), 'create_only');
      const product = await base.product.findFirstOrThrow({ where: { companyId: a.companyId, manufacturerCode: 'NC-1' } });
      expect(product.cost).toBeNull();
      expect((await movements('NC-1'))[0].unitCost).toBeNull();
    });
  });

  describe('error report', () => {
    it('lists only the rows with errors, with their problems in the Errores column', async () => {
      const file = await sheet([good('ER-1'), ['ER-2', 'Nueva', 'Rodamientos', 10]]);

      const report = new ExcelJS.Workbook();
      await report.xlsx.load((await importer.errorReport(file, 'create_only')) as unknown as ArrayBuffer);

      const errors = report.worksheets[0];
      expect(errors.rowCount).toBe(2);
      expect((errors.getRow(1).values as string[]).slice(1)).toEqual([...HEAD, 'Errores']);
      expect(errors.getRow(2).getCell(1).value).toBe('ER-2');
      expect(String(errors.getRow(2).getCell(HEAD.length + 1).value)).toContain('Marca no existe');
    });
  });
});
