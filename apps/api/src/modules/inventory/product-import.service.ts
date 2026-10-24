import {
  ConflictException,
  ForbiddenException,
  Injectable,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  type AttributeRule,
  describeImportIssue,
  emptyImportRow,
  IMPORT_ERRORS_HEADER,
  IMPORT_FIXED_COLUMNS,
  IMPORT_MAX_BYTES,
  IMPORT_STOCK_HEADER_PREFIX,
  type ImportCategoryMatch,
  type ImportCommitResponse,
  type ImportExistingProduct,
  type ImportHeaderMap,
  type ImportLookups,
  type ImportMode,
  type ImportPreviewResponse,
  type ImportRow,
  type ImportRowResult,
  mapImportHeaders,
  normalizeImportText,
  planStockChanges,
  SPEC_STEP_DIMENSIONS,
  summarizeImport,
  toPreviewRow,
  validateImportRows,
} from '@rodasoft/domain';
import ExcelJS from 'exceljs';
import { ClsService } from 'nestjs-cls';
import { AuditService } from '../../common/audit/audit.service';
import type { AppClsStore } from '../../common/cls';
import { PrismaService, type TenantTransaction } from '../../common/prisma/prisma.service';
import { SettingsService } from '../../common/settings/settings.service';
import { MembershipService } from '../access/membership.service';
import { ProductCommandsService } from './product-commands.service';
import type { ProductUpdateDto, ProductWriteDto } from './product-write.dto';
import { StockMovementService } from './stock-movement.service';

/** The reason, reference type and file name every movement of an import carries (kardex shows them). */
const IMPORT_REASON = 'Importación Excel';
const IMPORT_REF_TYPE = 'IMPORT';
/** An .xlsx is a zip archive: the first bytes tell it apart from a renamed file. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** A file as multer keeps it in memory. */
export interface ImportFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

interface ParsedSheet {
  headers: string[];
  map: ImportHeaderMap;
  rows: ImportRow[];
  /** The cells of each row as text, in sheet order, for the error report. */
  cells: string[][];
}

/**
 * Excel product import (HU-INV-10). The import is stateless: preview parses and validates the file and writes nothing;
 * commit receives the same file again, validates it again inside its transaction and writes. Products go through the
 * wizard's write path (`ProductCommandsService`) and stock through `StockMovementService`, the only writer of the levels
 * (design-notes rule 1).
 */
@Injectable()
export class ProductImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly audit: AuditService,
    private readonly membership: MembershipService,
    private readonly settings: SettingsService,
    private readonly stock: StockMovementService,
    private readonly commands: ProductCommandsService,
  ) {}

  /** The template: the fixed headers, one stock column per active warehouse and an example row. */
  async template(): Promise<Buffer> {
    const warehouses = await this.prisma.tenant.warehouse.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { code: 'asc' },
      select: { code: true },
    });
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Productos');
    const headers = [
      ...IMPORT_FIXED_COLUMNS.map((c) => c.header),
      ...warehouses.map((w) => `${IMPORT_STOCK_HEADER_PREFIX} ${w.code}`),
    ];
    sheet.addRow(headers).font = { bold: true };
    const example: Record<string, string> = {
      Código: '6205-2RS',
      Marca: 'SKF',
      Categoría: 'Rodamientos',
      Subcategoría: 'Rígidos de bolas',
      Descripción: 'Rodamiento 6205-2RS',
      Precio: '45.50',
      d: '25',
      D: '52',
      B: '15',
      'Costo unitario': '30.00',
    };
    sheet.addRow(headers.map((h) => example[h] ?? (h.startsWith(IMPORT_STOCK_HEADER_PREFIX) ? '10' : '')));
    headers.forEach((_, i) => (sheet.getColumn(i + 1).width = 16));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async preview(file: ImportFile, mode: ImportMode): Promise<ImportPreviewResponse> {
    await this.assertSupported();
    return this.prisma.tenant.$transaction(async (tx) => {
      const sheet = await this.parse(tx, file);
      const results = await this.validate(tx, sheet, mode);
      return { mode, summary: summarizeImport(results), rows: results.map(toPreviewRow), unknownColumns: sheet.map.unknown };
    });
  }

  /** An .xlsx with the rows that have errors, the original cells first and the problems in an "Errores" column. */
  async errorReport(file: ImportFile, mode: ImportMode): Promise<Buffer> {
    await this.assertSupported();
    const { sheet, results } = await this.prisma.tenant.$transaction(async (tx) => {
      const parsed = await this.parse(tx, file);
      return { sheet: parsed, results: await this.validate(tx, parsed, mode) };
    });
    const workbook = new ExcelJS.Workbook();
    const out = workbook.addWorksheet('Errores');
    out.addRow([...sheet.headers, IMPORT_ERRORS_HEADER]).font = { bold: true };
    results.forEach((result, i) => {
      if (result.status === 'valid') return;
      const messages = result.errors.map((e) => `${e.field}: ${describeImportIssue(e)}`).join('; ');
      out.addRow([...sheet.cells[i], messages]);
    });
    sheet.headers.forEach((_, i) => (out.getColumn(i + 1).width = 16));
    out.getColumn(sheet.headers.length + 1).width = 60;
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /**
   * Writes the valid rows in one transaction: if any row fails (a stock movement, a concurrent duplicate) nothing is
   * written. Rows with errors are skipped, not fatal. The company-wide advisory lock makes two imports run one after the
   * other, so the second one validates against what the first one wrote.
   */
  async commit(file: ImportFile, mode: ImportMode): Promise<ImportCommitResponse> {
    await this.assertSupported();
    const companyId = this.companyId();
    const granted = await this.granted();
    const canViewCosts = granted.has('inventory.costs.view');

    try {
      return await this.prisma.tenant.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${companyId}::text || ':product-import'))`;
          const sheet = await this.parse(tx, file);
          const wantsStock = sheet.rows.some((r) => Object.values(r.stock).some((v) => v.trim() !== ''));
          if (wantsStock && !granted.has('inventory.adjustments.create')) {
            throw new ForbiddenException({
              code: 'NO_PERMISSION',
              message: 'You do not have permission for this action',
              details: { missing: ['inventory.adjustments.create'], rows: sheet.rows.length },
            });
          }
          const results = await this.validate(tx, sheet, mode);

          let created = 0;
          let updated = 0;
          let stockMovements = 0;
          for (const result of results) {
            if (result.status === 'error') continue;
            const productId = await this.writeProduct(tx, result, canViewCosts);
            if (result.action === 'create') created++;
            else updated++;
            stockMovements += await this.writeStock(tx, productId, result, file.originalname, canViewCosts);
          }
          const skipped = results.length - created - updated;
          await this.audit.log(
            {
              action: 'inventory.product.import',
              entity: 'ProductImport',
              after: { file: file.originalname, mode, created, updated, skipped, stockMovements },
            },
            tx as unknown as Prisma.TransactionClient,
          );
          return { created, updated, skipped, stockMovements };
        },
        { timeout: 120_000, maxWait: 30_000 },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({
          code: 'DUPLICATE_MANUFACTURER_CODE',
          message: 'A product with this manufacturer code already exists for the brand',
        });
      }
      throw err;
    }
  }

  /** Creates or updates the product of a valid row through the same path as the wizard and the edit form. */
  private async writeProduct(tx: TenantTransaction, result: ImportRowResult, canViewCosts: boolean): Promise<string> {
    const { data } = result;
    // a blank cell never overwrites a stored value
    const fields = {
      manufacturerCode: result.code,
      brandId: result.brandId ?? undefined,
      categoryId: result.categoryId ?? undefined,
      ...(data.name ? { name: data.name } : {}),
      ...(data.salePrice ? { salePrice: data.salePrice } : {}),
      ...(data.innerDiameter ? { innerDiameter: data.innerDiameter } : {}),
      ...(data.outerDiameter ? { outerDiameter: data.outerDiameter } : {}),
      ...(data.width ? { width: data.width } : {}),
      ...(canViewCosts && data.cost ? { cost: data.cost } : {}),
      attributes: data.attributes,
    };
    if (result.action === 'create') {
      const created = await this.commands.create(fields as ProductWriteDto, tx);
      return created.id;
    }
    const productId = result.productId;
    if (!productId) throw new Error('Update row without a product');
    const companyId = this.companyId();
    // the update checks the `updatedAt` the form loaded with; the import has no form, so it takes the one under the lock
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${productId}::uuid AND company_id = ${companyId}::uuid FOR UPDATE`;
    const stored = await tx.product.findFirst({ where: { id: productId, companyId }, select: { updatedAt: true } });
    // deleted between the validation and the write: a clean error instead of a 500 (the whole import rolls back)
    if (!stored) throw new ConflictException({ code: 'PRODUCT_NOT_FOUND', message: 'A product of the file was deleted during the import' });
    // the code is how the row found the product (in any case): the stored spelling stays
    await this.commands.update(productId, { ...fields, manufacturerCode: undefined, expectedUpdatedAt: stored.updatedAt.toISOString() } as ProductUpdateDto, tx);
    return productId;
  }

  /** Sets the wanted quantity of each warehouse: the difference is decided under the level lock, so a sale in between is kept. */
  private async writeStock(
    tx: TenantTransaction,
    productId: string,
    result: ImportRowResult,
    fileName: string,
    canViewCosts: boolean,
  ): Promise<number> {
    let written = 0;
    for (const target of result.stockTargets) {
      const current = await this.stock.lockedQuantity(tx, productId, target.warehouseId);
      const plan = planStockChanges(target.quantity, current);
      if (!plan) continue;
      await this.stock.apply(tx, {
        productId,
        warehouseId: target.warehouseId,
        type: plan.type,
        quantity: plan.quantity,
        reason: IMPORT_REASON,
        refType: IMPORT_REF_TYPE,
        refNumber: fileName.slice(0, 120),
        unitCost: canViewCosts ? result.unitCost : null,
      });
      written++;
    }
    return written;
  }

  /** `true` for creating brands is a client decision that is still open (#33): it is refused instead of ignored. */
  private async assertSupported(): Promise<void> {
    if (await this.settings.get('inventory.import.createMissingBrands')) {
      throw new ConflictException({ code: 'NOT_SUPPORTED', message: 'Creating missing brands on import is not supported yet' });
    }
  }

  private async granted(): Promise<ReadonlySet<string>> {
    const membershipId = this.cls.get('membershipId');
    return membershipId ? this.membership.permissions(membershipId) : new Set<string>();
  }

  private companyId(): string {
    const companyId = this.cls.get('companyId');
    if (!companyId) throw new Error('Missing company in context');
    return companyId;
  }

  // ── Parsing ────────────────────────────────────────────────────────────────

  /** Reads the first sheet: header in row 1, one product per row. Blank rows are skipped, the others keep their sheet number. */
  private async parse(tx: TenantTransaction, file: ImportFile): Promise<ParsedSheet> {
    if (file.size > IMPORT_MAX_BYTES) {
      throw new PayloadTooLargeException({ code: 'FILE_TOO_LARGE', message: 'The file is larger than the limit' });
    }
    if (file.buffer.length < ZIP_MAGIC.length || !file.buffer.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) {
      throw new UnsupportedMediaTypeException({ code: 'UNSUPPORTED_FILE_TYPE', message: 'Only .xlsx files are accepted' });
    }
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw new UnprocessableEntityException({ code: 'IMPORT_INVALID_TEMPLATE', message: 'The file cannot be read as an Excel workbook' });
    }
    const worksheet = workbook.worksheets[0];
    if (!worksheet || worksheet.rowCount < 1) {
      throw new UnprocessableEntityException({ code: 'IMPORT_INVALID_TEMPLATE', message: 'The sheet has no header row', details: { reason: 'EMPTY' } });
    }

    const headers: string[] = [];
    worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
      headers[col - 1] = cellText(cell.value);
    });
    for (let i = 0; i < headers.length; i++) headers[i] ??= '';
    const attributeKeys = (await tx.attributeDefinition.findMany({ distinct: ['key'], select: { key: true } })).map((d) => d.key);
    const map = mapImportHeaders(headers, attributeKeys);
    if (map.missing.length) {
      throw new UnprocessableEntityException({
        code: 'IMPORT_INVALID_TEMPLATE',
        message: 'The sheet lacks required columns',
        details: { missing: map.missing },
      });
    }

    const maxRows = await this.settings.get('inventory.import.maxRows', tx);
    // blank rows are skipped, but a far-away cell would still make the loop below walk every row in between
    if (worksheet.rowCount > maxRows + 1000) {
      throw new UnprocessableEntityException({ code: 'IMPORT_TOO_MANY_ROWS', message: 'The file has too many rows', details: { max: maxRows } });
    }
    const rows: ImportRow[] = [];
    const cells: string[][] = [];
    for (let n = 2; n <= worksheet.rowCount; n++) {
      const line = headers.map((_, i) => cellText(worksheet.getRow(n).getCell(i + 1).value));
      if (line.every((c) => c.trim() === '')) continue;
      if (rows.length >= maxRows) {
        throw new UnprocessableEntityException({ code: 'IMPORT_TOO_MANY_ROWS', message: 'The file has too many rows', details: { max: maxRows } });
      }
      const row = emptyImportRow(n);
      for (const column of map.columns) {
        const value = line[column.index] ?? '';
        if (column.kind === 'fixed') row[column.field] = value;
        else if (column.kind === 'attribute') row.attributes[column.key] = value;
        else if (column.kind === 'stock') row.stock[column.warehouseCode] = value;
      }
      rows.push(row);
      cells.push(line);
    }
    if (!rows.length) {
      throw new UnprocessableEntityException({ code: 'IMPORT_INVALID_TEMPLATE', message: 'The sheet has no rows', details: { reason: 'EMPTY' } });
    }
    return { headers, map, rows, cells };
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  private async validate(tx: TenantTransaction, sheet: ParsedSheet, mode: ImportMode): Promise<ImportRowResult[]> {
    return validateImportRows(sheet.rows, await this.loadLookups(tx, sheet.rows), mode);
  }

  /** Loads what the rows refer to in a few queries, then answers the domain's lookups from memory. */
  private async loadLookups(tx: TenantTransaction, rows: readonly ImportRow[]): Promise<ImportLookups> {
    const companyId = this.companyId();
    const [brands, categories, definitions, warehouses] = await Promise.all([
      tx.brand.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true } }),
      tx.category.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true, parentId: true } }),
      tx.attributeDefinition.findMany({ orderBy: [{ step: 'asc' }, { sortOrder: 'asc' }] }),
      tx.warehouse.findMany({ select: { id: true, code: true, status: true, branchId: true } }),
    ]);

    const brandByName = new Map(brands.map((b) => [normalizeImportText(b.name), b.id]));
    const roots = new Map(categories.filter((c) => !c.parentId).map((c) => [normalizeImportText(c.name), c]));
    const children = new Map(categories.filter((c) => c.parentId).map((c) => [`${c.parentId}|${normalizeImportText(c.name)}`, c]));
    const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
    const rulesOf = new Map<string, (AttributeRule & { step: number })[]>();
    for (const d of definitions) {
      const list = rulesOf.get(d.categoryId) ?? [];
      list.push({ key: d.key, type: d.type, required: d.required, options: Array.isArray(d.options) ? (d.options as string[]) : null, step: d.step });
      rulesOf.set(d.categoryId, list);
    }
    // a category without its own technical fields uses its parent's, as the wizard shows them
    const match = (id: string): ImportCategoryMatch => {
      const parent = parentOf.get(id);
      const rules = rulesOf.get(id) ?? (parent ? rulesOf.get(parent) : undefined) ?? [];
      return { id, rules, isBearing: rules.some((r) => r.step === SPEC_STEP_DIMENSIONS) };
    };

    const membershipId = this.cls.get('membershipId');
    const operable = membershipId ? await this.membership.operableBranchIds(membershipId) : [];
    const warehouseByCode = new Map(warehouses.map((w) => [w.code.toUpperCase(), w]));

    const existing = await this.loadExisting(tx, companyId, rows, brandByName);
    return {
      brandId: (name) => brandByName.get(normalizeImportText(name)) ?? null,
      category: (category, subcategory) => {
        const root = roots.get(normalizeImportText(category));
        if (!root) return 'CATEGORY_NOT_FOUND';
        if (!subcategory.trim()) return match(root.id);
        const child = children.get(`${root.id}|${normalizeImportText(subcategory)}`);
        return child ? match(child.id) : 'SUBCATEGORY_NOT_FOUND';
      },
      warehouse: (code) => {
        const w = warehouseByCode.get(code.toUpperCase());
        if (!w) return null;
        return { id: w.id, code: w.code, active: w.status === 'ACTIVE', allowed: operable === null || operable.includes(w.branchId) };
      },
      existing: (brandId, code) => existing.get(`${brandId}|${code.trim().toLowerCase()}`) ?? null,
    };
  }

  /** The products the file's (brand, code) pairs already have, with the stock and history the rules need. */
  private async loadExisting(
    tx: TenantTransaction,
    companyId: string,
    rows: readonly ImportRow[],
    brandByName: ReadonlyMap<string, string>,
  ): Promise<Map<string, ImportExistingProduct>> {
    const brandIds = [...new Set(rows.flatMap((r) => brandByName.get(normalizeImportText(r.brand)) ?? []))];
    const codes = [...new Set(rows.map((r) => r.code.trim().toLowerCase()).filter(Boolean))];
    const found = new Map<string, ImportExistingProduct>();
    if (!brandIds.length || !codes.length) return found;

    const products = await tx.$queryRaw<{ id: string; brand_id: string; manufacturer_code: string; status: string; category_id: string }[]>`
      SELECT id, brand_id, manufacturer_code, status::text AS status, category_id FROM products
      WHERE company_id = ${companyId}::uuid AND brand_id = ANY(${brandIds}::uuid[]) AND lower(manufacturer_code) = ANY(${codes}::text[])`;
    if (!products.length) return found;
    const ids = products.map((p) => p.id);
    const [levels, moved] = await Promise.all([
      tx.stockLevel.findMany({ where: { productId: { in: ids } }, select: { productId: true, warehouseId: true, quantity: true } }),
      tx.stockMovement.groupBy({ by: ['productId'], where: { productId: { in: ids } } }),
    ]);
    const withMovements = new Set(moved.map((m) => m.productId));
    for (const p of products) {
      const stock = new Map(levels.filter((l) => l.productId === p.id).map((l) => [l.warehouseId, l.quantity]));
      found.set(`${p.brand_id}|${p.manufacturer_code.toLowerCase()}`, {
        id: p.id,
        status: p.status,
        categoryId: p.category_id,
        hasMovements: withMovements.has(p.id),
        stock,
      });
    }
    return found;
  }
}

/** A cell as the text the user sees: numbers lose Excel's float noise, formulas give their result, rich text is joined. */
function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if ('richText' in value) return value.richText.map((part) => part.text).join('');
  if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
  if ('text' in value) return String(value.text);
  return '';
}
