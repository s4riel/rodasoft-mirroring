import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  clampPage,
  HOMOLOGATION_IMPORT_COLUMNS,
  HOMOLOGATION_IMPORT_MAX_ROWS,
  type HomologationImportPreview,
  type HomologationImportResult,
  type HomologationListQuery,
  type HomologationResponse,
  type HomologationRow,
  type HomologationUpdateInput,
  homologationProgress,
  INVOICE_PAGE_SIZE_DEFAULT,
  INVOICE_PAGE_SIZE_MAX,
  parseHomologationLines,
  SIAT_CATALOGS,
  validateHomologationRows,
} from '@rodasoft/domain';
import ExcelJS from 'exceljs';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { readListFile, type ListUploadFile } from '../inventory/list-file';
import { invoicingErrors } from './invoicing.errors';

/** The SKUs a file names, as typed and in capitals (the stored SKU may be either). */
const skusOf = (rows: readonly { sku: string }[]): string[] => [...new Set(rows.flatMap((row) => [row.sku.trim(), row.sku.trim().toUpperCase()]).filter((sku) => sku !== ''))];

const ACTIVE_PRODUCTS = { status: 'ACTIVE' } satisfies Prisma.ProductWhereInput;
const HOMOLOGATED = { sinProductCode: { not: null }, NOT: { sinProductCode: '' } } satisfies Prisma.ProductWhereInput;
const NOT_HOMOLOGATED = { OR: [{ sinProductCode: null }, { sinProductCode: '' }] } satisfies Prisma.ProductWhereInput;

/**
 * The SIN code of every product (HU-FAC-26, "homologation"): the progress, the list with its status, setting one code by hand and
 * importing many from Excel. A code must exist in the synced SIN catalogue; the activity of the product comes with its code.
 * Importing is all-or-nothing: one row with an error and nothing is saved.
 */
@Injectable()
export class HomologationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
  ) {}

  async list(query: HomologationListQuery): Promise<HomologationResponse> {
    const q = query.q?.trim();
    const where: Prisma.ProductWhereInput = {
      ...ACTIVE_PRODUCTS,
      ...(query.status === 'DONE' ? HOMOLOGATED : query.status === 'PENDING' ? NOT_HOMOLOGATED : {}),
      ...(q
        ? {
            AND: [
              {
                OR: [
                  { sku: { contains: q, mode: 'insensitive' } },
                  { manufacturerCode: { contains: q, mode: 'insensitive' } },
                  { name: { contains: q, mode: 'insensitive' } },
                  { sinProductCode: { contains: q } },
                ],
              },
            ],
          }
        : {}),
    };
    const pageSize = Math.min(Math.max(Math.floor(query.pageSize ?? INVOICE_PAGE_SIZE_DEFAULT), 1), INVOICE_PAGE_SIZE_MAX);
    const [total, all, done, synced, withoutUnit, lastSync] = await Promise.all([
      this.prisma.tenant.product.count({ where }),
      this.prisma.tenant.product.count({ where: ACTIVE_PRODUCTS }),
      this.prisma.tenant.product.count({ where: { ...ACTIVE_PRODUCTS, ...HOMOLOGATED } }),
      this.prisma.tenant.siatCatalogSync.count(),
      this.prisma.tenant.product.count({ where: { ...ACTIVE_PRODUCTS, sinUnitCode: null } }),
      this.prisma.tenant.siatCatalogSync.aggregate({ _max: { syncedAt: true } }),
    ]);
    const page = Math.min(clampPage(query.page), Math.max(1, Math.ceil(total / pageSize)));
    const [products, descriptions, units] = await Promise.all([
      this.prisma.tenant.product.findMany({
        where,
        orderBy: [{ sku: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { id: true, sku: true, manufacturerCode: true, name: true, sinProductCode: true, sinActivityCode: true, sinUnitCode: true, brand: { select: { name: true } } },
      }),
      this.prisma.tenant.siatCatalogEntry.findMany({ where: { catalog: 'PRODUCT_SERVICE' }, select: { code: true, description: true } }),
      this.prisma.tenant.siatCatalogEntry.findMany({ where: { catalog: 'UNIT_OF_MEASURE', active: true }, select: { code: true, description: true } }),
    ]);
    const described = new Map(descriptions.map((row) => [row.code, row.description]));
    const items = products.map(
      (product): HomologationRow => ({
        id: product.id,
        sku: product.sku,
        code: product.manufacturerCode,
        name: product.name,
        brand: product.brand.name,
        sinProductCode: product.sinProductCode || null,
        sinActivityCode: product.sinActivityCode,
        sinUnitCode: product.sinUnitCode,
        sinDescription: product.sinProductCode ? (described.get(product.sinProductCode) ?? null) : null,
        status: product.sinProductCode ? 'DONE' : 'PENDING',
      }),
    );
    return {
      items,
      total,
      page,
      pageSize,
      progress: homologationProgress(all, done),
      units: units.map((unit) => ({ code: Number(unit.code), description: unit.description })).filter((unit) => Number.isInteger(unit.code)).sort((a, b) => a.code - b.code),
      catalogsSynced: synced >= SIAT_CATALOGS.length,
      withoutUnit,
      syncedAt: lastSync._max.syncedAt?.toISOString() ?? null,
    };
  }

  /** Sets the SIN code (and unit) of one product; the code must be in the synced catalogue. */
  async update(productId: string, input: HomologationUpdateInput): Promise<HomologationRow> {
    if ((await this.prisma.tenant.siatCatalogSync.count()) === 0) throw invoicingErrors.catalogsNotSynced();
    const product = await this.prisma.tenant.product.findFirst({ where: { id: productId }, select: { id: true, sinProductCode: true, sinActivityCode: true, sinUnitCode: true } });
    if (!product) throw invoicingErrors.productNotFound();
    const code = input.sinProductCode.trim();
    const entry = await this.prisma.tenant.siatCatalogEntry.findFirst({ where: { catalog: 'PRODUCT_SERVICE', code, active: true }, select: { activityCode: true } });
    if (!entry) throw invoicingErrors.sinCodeUnknown('sinProductCode');
    const unit = input.sinUnitCode ?? null;
    if (unit !== null && !(await this.prisma.tenant.siatCatalogEntry.findFirst({ where: { catalog: 'UNIT_OF_MEASURE', code: String(unit), active: true }, select: { id: true } }))) {
      throw invoicingErrors.sinCodeUnknown('sinUnitCode');
    }
    const userId = this.cls.get('userId') ?? null;
    await this.prisma.tenant.$transaction(async (tx) => {
      await tx.product.update({ where: { id: productId }, data: { sinProductCode: code, sinActivityCode: entry.activityCode || null, sinUnitCode: unit, updatedById: userId } });
      await this.audit.log(
        {
          action: 'invoicing.product.homologate',
          entity: 'Product',
          entityId: productId,
          before: { sinProductCode: product.sinProductCode, sinUnitCode: product.sinUnitCode },
          after: { sinProductCode: code, sinActivityCode: entry.activityCode, sinUnitCode: unit },
        },
        tx as unknown as Prisma.TransactionClient,
      );
    });
    return (await this.rowOf(productId)) as HomologationRow;
  }

  /** The Excel template: the three columns and an example row. */
  async template(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Homologación');
    sheet.addRow([...HOMOLOGATION_IMPORT_COLUMNS]).font = { bold: true };
    sheet.addRow(['RL-000001', '84821', '58']);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Validates the file row by row against the products and the synced catalogue; saves nothing. */
  async preview(file: ListUploadFile): Promise<HomologationImportPreview> {
    return this.check(this.prisma.tenant, file);
  }

  /** Applies the file: every row or none. A file with errors is refused with the rows that have them. */
  async apply(file: ListUploadFile): Promise<HomologationImportResult> {
    const userId = this.cls.get('userId') ?? null;
    // the check runs inside the transaction, so the products and the catalogue it validated are the ones it writes
    const preview = await this.prisma.tenant.$transaction(
      async (tx) => {
        const checked = await this.check(tx, file);
        if (checked.withErrors > 0) throw invoicingErrors.importHasErrors({ rows: checked.rows.filter((row) => row.errors.length > 0) });
        const catalog = await tx.siatCatalogEntry.findMany({ where: { catalog: 'PRODUCT_SERVICE', active: true }, select: { code: true, activityCode: true } });
        const activityOf = new Map(catalog.map((row) => [row.code, row.activityCode]));
        const bySku = new Map((await tx.product.findMany({ where: { sku: { in: skusOf(checked.rows) } }, select: { id: true, sku: true } })).map((product) => [product.sku.toUpperCase(), product.id]));
        for (const row of checked.rows) {
          const id = bySku.get(row.sku.toUpperCase()) as string;
          await tx.product.update({
            where: { id },
            data: { sinProductCode: row.sinProductCode, sinActivityCode: activityOf.get(row.sinProductCode) || null, sinUnitCode: row.unit === '' ? null : Number(row.unit), updatedById: userId },
          });
        }
        await this.audit.log(
          { action: 'invoicing.homologation.import', entity: 'Product', after: { updated: checked.rows.length, fileName: file.originalname.slice(0, 200) } },
          tx as unknown as Prisma.TransactionClient,
        );
        return checked;
      },
      { timeout: 60_000 },
    );
    return { updated: preview.rows.length };
  }

  private async check(db: Pick<TenantTransaction, 'product' | 'siatCatalogEntry' | 'siatCatalogSync'>, file: ListUploadFile): Promise<HomologationImportPreview> {
    if ((await db.siatCatalogSync.count()) === 0) throw invoicingErrors.catalogsNotSynced();
    const text = await readListFile(file, HOMOLOGATION_IMPORT_COLUMNS.length);
    const rows = parseHomologationLines(text);
    if (rows.length === 0) throw invoicingErrors.invalidNote([{ field: 'file', error: 'FILE_EMPTY' }]);
    if (rows.length > HOMOLOGATION_IMPORT_MAX_ROWS) throw invoicingErrors.invalidNote([{ field: 'file', error: 'TOO_MANY_ROWS' }]);
    const [products, sin, units] = await Promise.all([
      db.product.findMany({ where: { sku: { in: skusOf(rows) } }, select: { sku: true } }),
      db.siatCatalogEntry.findMany({ where: { catalog: 'PRODUCT_SERVICE', active: true }, select: { code: true } }),
      db.siatCatalogEntry.findMany({ where: { catalog: 'UNIT_OF_MEASURE', active: true }, select: { code: true } }),
    ]);
    const results = validateHomologationRows(rows, {
      skus: new Set(products.map((product) => product.sku.toUpperCase())),
      sinProductCodes: new Set(sin.map((row) => row.code)),
      unitCodes: new Set(units.map((row) => row.code)),
    });
    const withErrors = results.filter((row) => row.errors.length > 0).length;
    return { rows: results, total: results.length, valid: results.length - withErrors, withErrors };
  }

  private async rowOf(productId: string): Promise<HomologationRow | null> {
    const product = await this.prisma.tenant.product.findFirst({
      where: { id: productId },
      select: { id: true, sku: true, manufacturerCode: true, name: true, sinProductCode: true, sinActivityCode: true, sinUnitCode: true, brand: { select: { name: true } } },
    });
    if (!product) return null;
    const entry = product.sinProductCode ? await this.prisma.tenant.siatCatalogEntry.findFirst({ where: { catalog: 'PRODUCT_SERVICE', code: product.sinProductCode }, select: { description: true } }) : null;
    return {
      id: product.id,
      sku: product.sku,
      code: product.manufacturerCode,
      name: product.name,
      brand: product.brand.name,
      sinProductCode: product.sinProductCode || null,
      sinActivityCode: product.sinActivityCode,
      sinUnitCode: product.sinUnitCode,
      sinDescription: entry?.description ?? null,
      status: product.sinProductCode ? 'DONE' : 'PENDING',
    };
  }
}
