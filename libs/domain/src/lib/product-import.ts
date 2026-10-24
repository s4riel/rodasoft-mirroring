/** Rules of the product Excel importer (HU-INV-10): columns, row validation and the stock plan. Pure, no I/O. */
import { COST_SCALE, Decimal } from './money';
import type { AttributeKind } from './product-catalog';
import {
  type AttributeRule,
  type ProductDraftInput,
  type ProductFieldError,
  validateProductDraft,
} from './product-creation';
import type { StockMovementType } from './stock';

/** `create_only` refuses a product that already exists; `create_or_update` updates it (decision: idempotent by brand + code). */
export type ImportMode = 'create_only' | 'create_or_update';
export const IMPORT_MODES: readonly ImportMode[] = ['create_only', 'create_or_update'];

/** Upload limits: the file size and the default number of rows (setting `inventory.import.maxRows`). */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_DEFAULT_MAX_ROWS = 2000;

export type ImportFixedField =
  | 'code'
  | 'brand'
  | 'category'
  | 'subcategory'
  | 'name'
  | 'price'
  | 'innerDiameter'
  | 'outerDiameter'
  | 'width'
  | 'unitCost';

/** Headers of the template, in Spanish as the user sees them in Excel. */
export const IMPORT_FIXED_COLUMNS: readonly { header: string; field: ImportFixedField; required: boolean }[] = [
  { header: 'Código', field: 'code', required: true },
  { header: 'Marca', field: 'brand', required: true },
  { header: 'Categoría', field: 'category', required: true },
  { header: 'Subcategoría', field: 'subcategory', required: false },
  { header: 'Descripción', field: 'name', required: false },
  { header: 'Precio', field: 'price', required: false },
  { header: 'd', field: 'innerDiameter', required: false },
  { header: 'D', field: 'outerDiameter', required: false },
  { header: 'B', field: 'width', required: false },
  { header: 'Costo unitario', field: 'unitCost', required: false },
];

/** Prefix of the per-warehouse stock columns: `Stock <warehouse code>`. */
export const IMPORT_STOCK_HEADER_PREFIX = 'Stock';
/** Header of the column the error report adds. */
export const IMPORT_ERRORS_HEADER = 'Errores';

/** Lower case, without accents, with collapsed spaces: brands, categories and headers are matched this way. */
export function normalizeImportText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export type ImportColumn =
  | { index: number; kind: 'fixed'; field: ImportFixedField }
  | { index: number; kind: 'attribute'; key: string }
  | { index: number; kind: 'stock'; warehouseCode: string }
  | { index: number; kind: 'unknown'; header: string };

export interface ImportHeaderMap {
  columns: ImportColumn[];
  /** Required headers that the sheet does not have. */
  missing: string[];
  /** Headers that mean nothing to the importer: they are ignored and reported as a warning. */
  unknown: string[];
}

const STOCK_HEADER = new RegExp(`^${IMPORT_STOCK_HEADER_PREFIX}\\s+(.+)$`, 'i');

/**
 * Maps the header row to fields. `d`, `D` and `B` are compared as typed (`d` and `D` are different columns); every other
 * header ignores case and accents. Attribute columns use the `attribute_definitions.key` of any category.
 */
export function mapImportHeaders(headers: readonly string[], attributeKeys: Iterable<string>): ImportHeaderMap {
  const keyByNormal = new Map<string, string>();
  for (const key of attributeKeys) keyByNormal.set(normalizeImportText(key), key);
  const fixedExact = new Map(IMPORT_FIXED_COLUMNS.filter((c) => c.header.length === 1).map((c) => [c.header, c.field]));
  const fixedNormal = new Map(IMPORT_FIXED_COLUMNS.filter((c) => c.header.length > 1).map((c) => [normalizeImportText(c.header), c.field]));

  const columns: ImportColumn[] = [];
  const seen = new Set<ImportFixedField>();
  headers.forEach((raw, index) => {
    const header = raw.trim();
    if (!header) return;
    const exact = fixedExact.get(header);
    const normal = normalizeImportText(header);
    const field = exact ?? fixedNormal.get(normal);
    if (field && !seen.has(field)) {
      seen.add(field);
      columns.push({ index, kind: 'fixed', field });
      return;
    }
    const stock = STOCK_HEADER.exec(header);
    if (stock) {
      columns.push({ index, kind: 'stock', warehouseCode: stock[1].trim().toUpperCase() });
      return;
    }
    const key = keyByNormal.get(normal);
    columns.push(key ? { index, kind: 'attribute', key } : { index, kind: 'unknown', header });
  });
  return {
    columns,
    missing: IMPORT_FIXED_COLUMNS.filter((c) => c.required && !seen.has(c.field)).map((c) => c.header),
    unknown: columns.flatMap((c) => (c.kind === 'unknown' ? [c.header] : [])),
  };
}

/** A sheet row as text, before any validation. Blank cells are empty strings. */
export interface ImportRow {
  /** 1-based row number in the sheet (the header is row 1). */
  rowNumber: number;
  code: string;
  brand: string;
  category: string;
  subcategory: string;
  name: string;
  price: string;
  innerDiameter: string;
  outerDiameter: string;
  width: string;
  unitCost: string;
  attributes: Record<string, string>;
  /** Raw stock cell per warehouse code (upper case). */
  stock: Record<string, string>;
}

export type ImportIssueCode =
  | ProductFieldError['code']
  | 'BRAND_NOT_FOUND'
  | 'CATEGORY_NOT_FOUND'
  | 'SUBCATEGORY_NOT_FOUND'
  | 'DUPLICATE_IN_FILE'
  | 'PRODUCT_EXISTS'
  | 'EXISTING_IS_DRAFT'
  | 'CATEGORY_LOCKED'
  | 'WAREHOUSE_NOT_FOUND'
  | 'WAREHOUSE_INACTIVE'
  | 'WAREHOUSE_NOT_ALLOWED'
  | 'STOCK_INVALID'
  | 'STOCK_ON_SKIPPED_ROW'
  | 'PRODUCT_WILL_UPDATE'
  | 'STOCK_WILL_ADJUST';

export interface ImportIssue {
  /** Sheet field the issue is about (`code`, `brand`, `price`, an attribute key, `Stock HK-01`…). */
  field: string;
  code: ImportIssueCode;
  params?: Record<string, string | number>;
}

export type ImportAction = 'create' | 'update' | 'skip';

export interface StockTarget {
  warehouseId: string;
  warehouseCode: string;
  quantity: number;
}

/** The product fields the row carries, normalized (dots for decimals, null for a blank cell): what the write path takes. */
export interface ImportProductData {
  name: string | null;
  salePrice: string | null;
  innerDiameter: string | null;
  outerDiameter: string | null;
  width: string | null;
  cost: string | null;
  attributes: Record<string, unknown>;
}

export interface ImportRowResult {
  rowNumber: number;
  code: string;
  brand: string;
  status: 'valid' | 'error';
  action: ImportAction;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Resolved references, set when the row got far enough to have them. */
  brandId: string | null;
  categoryId: string | null;
  productId: string | null;
  /** Wanted on-hand quantity per warehouse (blank cells are not here). */
  stockTargets: StockTarget[];
  unitCost: string | null;
  data: ImportProductData;
}

export interface ImportCategoryMatch {
  id: string;
  rules: readonly AttributeRule[];
  isBearing: boolean;
}

export interface ImportWarehouseMatch {
  id: string;
  code: string;
  active: boolean;
  /** Whether the member may operate the warehouse's branch. */
  allowed: boolean;
}

export interface ImportExistingProduct {
  id: string;
  status: string;
  categoryId: string;
  hasMovements: boolean;
  /** Current on-hand quantity per warehouse id. */
  stock: ReadonlyMap<string, number>;
}

/** Everything the validation needs from the database, already loaded: the domain does no I/O. */
export interface ImportLookups {
  brandId(name: string): string | null;
  /** The leaf category: the subcategory under the category when `subcategory` is given, else the category itself. */
  category(category: string, subcategory: string): ImportCategoryMatch | 'CATEGORY_NOT_FOUND' | 'SUBCATEGORY_NOT_FOUND';
  warehouse(code: string): ImportWarehouseMatch | null;
  existing(brandId: string, code: string): ImportExistingProduct | null;
}

const isBlank = (value: string): boolean => value.trim() === '';
const decimalText = (value: string): string => value.trim().replace(',', '.');

/** A row with every cell blank: the parser fills in what the sheet has. */
export function emptyImportRow(rowNumber: number): ImportRow {
  return {
    rowNumber,
    code: '',
    brand: '',
    category: '',
    subcategory: '',
    name: '',
    price: '',
    innerDiameter: '',
    outerDiameter: '',
    width: '',
    unitCost: '',
    attributes: {},
    stock: {},
  };
}

/** Technical fields come as text: numbers and booleans are converted so the wizard rules can check them. */
export function coerceAttribute(kind: AttributeKind, raw: string): unknown {
  const text = raw.trim();
  if (kind === 'NUMBER') return /^-?\d+([.,]\d+)?$/.test(text) ? text.replace(',', '.') : text;
  if (kind === 'BOOLEAN') {
    const normal = normalizeImportText(text);
    if (['si', 'sí', 'true', '1', 'x', 'yes'].includes(normal)) return true;
    if (['no', 'false', '0'].includes(normal)) return false;
  }
  return text;
}

/** A stock cell: a whole number of pieces, zero or more. Returns null when the text is not one. */
export function parseStockQuantity(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,7}$/.test(text)) return null;
  return Number(text);
}

/**
 * Validates one sheet row. Errors keep the row out of the import; warnings do not. The product rules are the ones of the
 * creation wizard (`validateProductDraft`, HU-INV-06), so an imported product is as complete as a hand-made one.
 */
export function validateImportRow(row: ImportRow, lookups: ImportLookups, mode: ImportMode): ImportRowResult {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const result: ImportRowResult = {
    rowNumber: row.rowNumber,
    code: row.code.trim(),
    brand: row.brand.trim(),
    status: 'valid',
    action: 'create',
    errors,
    warnings,
    brandId: null,
    categoryId: null,
    productId: null,
    stockTargets: [],
    unitCost: isBlank(row.unitCost) ? null : decimalText(row.unitCost),
    data: { name: null, salePrice: null, innerDiameter: null, outerDiameter: null, width: null, cost: null, attributes: {} },
  };

  // references: a brand is never created by the import (decision #33)
  const brandId = isBlank(row.brand) ? null : lookups.brandId(row.brand);
  if (!isBlank(row.brand) && !brandId) errors.push({ field: 'brand', code: 'BRAND_NOT_FOUND', params: { brand: row.brand.trim() } });
  result.brandId = brandId;

  let category: ImportCategoryMatch | null = null;
  if (!isBlank(row.category)) {
    const match = lookups.category(row.category, row.subcategory);
    if (match === 'CATEGORY_NOT_FOUND') errors.push({ field: 'category', code: 'CATEGORY_NOT_FOUND', params: { category: row.category.trim() } });
    else if (match === 'SUBCATEGORY_NOT_FOUND') {
      errors.push({ field: 'subcategory', code: 'SUBCATEGORY_NOT_FOUND', params: { subcategory: row.subcategory.trim() } });
    } else category = match;
  }
  result.categoryId = category?.id ?? null;

  // the wizard rules; an unresolved reference was already reported, so a stand-in keeps it from being "required" as well
  const attributes: Record<string, unknown> = {};
  const kinds = new Map((category?.rules ?? []).map((r) => [r.key, r.type]));
  for (const [key, raw] of Object.entries(row.attributes)) {
    if (!isBlank(raw)) attributes[key] = coerceAttribute(kinds.get(key) ?? 'TEXT', raw);
  }
  const text = (value: string): string | null => (isBlank(value) ? null : decimalText(value));
  result.data = {
    name: row.name.trim() || null,
    salePrice: text(row.price),
    innerDiameter: text(row.innerDiameter),
    outerDiameter: text(row.outerDiameter),
    width: text(row.width),
    cost: result.unitCost,
    attributes,
  };
  const input: ProductDraftInput = {
    manufacturerCode: row.code.trim() || null,
    brandId: brandId ?? (isBlank(row.brand) ? null : 'unresolved'),
    categoryId: category?.id ?? (isBlank(row.category) ? null : 'unresolved'),
    isBearing: category?.isBearing ?? false,
    salePrice: result.data.salePrice,
    dimensions: { innerDiameter: result.data.innerDiameter, outerDiameter: result.data.outerDiameter, width: result.data.width },
    attributes,
    cost: result.unitCost,
  };
  // without a resolved category the technical fields cannot be checked: only the rest of the row is
  const productErrors = validateProductDraft(input, category?.rules ?? [], { draft: false }).filter(
    (e) => category || !(e.code === 'ATTRIBUTE_UNKNOWN' || e.code === 'DIMENSIONS_REQUIRED'),
  );
  const fieldOf = (e: ProductFieldError): string => (e.field === 'dimensions' ? 'd' : e.field);
  for (const e of productErrors) {
    // a reference that does not exist is already an error; "required" would say the same twice
    if (e.code === 'BRAND_REQUIRED' && !isBlank(row.brand)) continue;
    if (e.code === 'CATEGORY_REQUIRED' && !isBlank(row.category)) continue;
    errors.push({ field: fieldOf(e), code: e.code });
  }

  // the product that is already there
  const existing = brandId && result.code ? lookups.existing(brandId, result.code) : null;
  if (existing) {
    result.productId = existing.id;
    if (mode === 'create_only') {
      result.action = 'skip';
      errors.push({ field: 'code', code: 'PRODUCT_EXISTS' });
    } else if (existing.status === 'DRAFT') {
      result.action = 'skip';
      errors.push({ field: 'code', code: 'EXISTING_IS_DRAFT' });
    } else {
      result.action = 'update';
      warnings.push({ field: 'code', code: 'PRODUCT_WILL_UPDATE' });
      // a blank cell keeps the stored value, which already met the rules of the same category: only a category change needs them again
      if (category?.id === existing.categoryId) {
        const stored: ImportIssueCode[] = ['PRICE_REQUIRED', 'DIMENSIONS_REQUIRED', 'ATTRIBUTE_REQUIRED'];
        for (let i = errors.length - 1; i >= 0; i--) if (stored.includes(errors[i].code)) errors.splice(i, 1);
      }
      if (category && category.id !== existing.categoryId && existing.hasMovements) {
        errors.push({ field: 'category', code: 'CATEGORY_LOCKED' });
      }
    }
  }

  validateStock(row, lookups, result, existing);
  if (errors.length) result.status = 'error';
  return result;
}

function validateStock(row: ImportRow, lookups: ImportLookups, result: ImportRowResult, existing: ImportExistingProduct | null): void {
  for (const [code, raw] of Object.entries(row.stock)) {
    if (isBlank(raw)) continue;
    const field = `${IMPORT_STOCK_HEADER_PREFIX} ${code}`;
    if (result.action === 'skip') {
      result.errors.push({ field, code: 'STOCK_ON_SKIPPED_ROW' });
      continue;
    }
    const quantity = parseStockQuantity(raw);
    if (quantity === null) {
      result.errors.push({ field, code: 'STOCK_INVALID' });
      continue;
    }
    const warehouse = lookups.warehouse(code);
    if (!warehouse) result.errors.push({ field, code: 'WAREHOUSE_NOT_FOUND', params: { warehouse: code } });
    else if (!warehouse.active) result.errors.push({ field, code: 'WAREHOUSE_INACTIVE', params: { warehouse: code } });
    else if (!warehouse.allowed) result.errors.push({ field, code: 'WAREHOUSE_NOT_ALLOWED', params: { warehouse: code } });
    else {
      result.stockTargets.push({ warehouseId: warehouse.id, warehouseCode: warehouse.code, quantity });
      const current = existing?.stock.get(warehouse.id) ?? 0;
      if (existing && current > 0 && current !== quantity) {
        result.warnings.push({ field, code: 'STOCK_WILL_ADJUST', params: { warehouse: warehouse.code, from: current, to: quantity } });
      }
    }
  }
}

/**
 * Validates every row and adds the checks that need the whole file: the same (brand, code) twice is an error from the
 * second occurrence on, so the file never writes one product twice.
 */
export function validateImportRows(rows: readonly ImportRow[], lookups: ImportLookups, mode: ImportMode): ImportRowResult[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const result = validateImportRow(row, lookups, mode);
    if (result.code) {
      const key = `${result.brandId ?? normalizeImportText(row.brand)}|${normalizeImportText(result.code)}`;
      if (seen.has(key)) {
        result.errors.push({ field: 'code', code: 'DUPLICATE_IN_FILE' });
        result.status = 'error';
      }
      seen.add(key);
    }
    return result;
  });
}

export interface StockPlan {
  type: StockMovementType;
  /** Signed, as the movements service takes it. */
  quantity: number;
}

/**
 * The movement that takes a warehouse from `current` to the wanted `target`: INITIAL when the product never had stock
 * there, an adjustment for the difference otherwise, nothing when the quantity is already right.
 */
export function planStockChanges(target: number, current: { quantity: number; hasHistory: boolean }): StockPlan | null {
  if (target === current.quantity) return null;
  if (current.quantity === 0 && !current.hasHistory) return { type: 'INITIAL', quantity: target };
  const difference = target - current.quantity;
  return { type: difference > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', quantity: difference };
}

export interface ImportSummary {
  total: number;
  valid: number;
  withError: number;
  withWarning: number;
  toCreate: number;
  toUpdate: number;
  /** Pieces the valid rows leave on hand, and what they are worth at the unit cost of each row. */
  pieces: number;
  value: string;
}

export function summarizeImport(results: readonly ImportRowResult[]): ImportSummary {
  const valid = results.filter((r) => r.status === 'valid');
  let value = Decimal.zero(COST_SCALE);
  let pieces = 0;
  for (const r of valid) {
    const quantity = r.stockTargets.reduce((total, t) => total + t.quantity, 0);
    pieces += quantity;
    if (r.unitCost && quantity > 0) {
      try {
        value = value.add(Decimal.of(r.unitCost, COST_SCALE).mul(quantity, COST_SCALE));
      } catch {
        // a malformed cost is already a row error, and such a row is not valid
      }
    }
  }
  return {
    total: results.length,
    valid: valid.length,
    withError: results.length - valid.length,
    withWarning: results.filter((r) => r.warnings.length > 0).length,
    toCreate: valid.filter((r) => r.action === 'create').length,
    toUpdate: valid.filter((r) => r.action === 'update').length,
    pieces,
    value: value.round(2).toString(),
  };
}

export interface ImportPreviewRow {
  rowNumber: number;
  code: string;
  brand: string;
  status: 'valid' | 'error';
  action: ImportAction;
  errors: ImportIssue[];
  warnings: ImportIssue[];
}

/** `POST /inventory/products/import/preview`. */
export interface ImportPreviewResponse {
  mode: ImportMode;
  summary: ImportSummary;
  rows: ImportPreviewRow[];
  /** Headers of the sheet the importer ignored. */
  unknownColumns: string[];
}

/** `POST /inventory/products/import/commit`. */
export interface ImportCommitResponse {
  created: number;
  updated: number;
  skipped: number;
  /** Movements written (initial stock and adjustments). */
  stockMovements: number;
}

export function toPreviewRow(r: ImportRowResult): ImportPreviewRow {
  return { rowNumber: r.rowNumber, code: r.code, brand: r.brand, status: r.status, action: r.action, errors: r.errors, warnings: r.warnings };
}

type IssueText = string | ((params: Record<string, string | number>) => string);

const ISSUE_TEXT: Record<ImportIssueCode, IssueText> = {
  CODE_REQUIRED: 'Falta el código',
  BRAND_REQUIRED: 'Falta la marca',
  CATEGORY_REQUIRED: 'Falta la categoría',
  DIMENSIONS_REQUIRED: 'Faltan las medidas d, D y B',
  PRICE_REQUIRED: 'Falta el precio de venta',
  ATTRIBUTE_REQUIRED: 'Falta un dato técnico obligatorio',
  ATTRIBUTE_TYPE: 'El dato técnico no tiene el tipo correcto',
  ATTRIBUTE_OPTION: 'El dato técnico no es una de las opciones permitidas',
  ATTRIBUTE_UNKNOWN: 'La categoría no tiene este dato técnico',
  PRICE_FORMAT: 'El precio no es válido (hasta 2 decimales)',
  COST_FORMAT: 'El costo unitario no es válido (hasta 4 decimales)',
  MEASURE_FORMAT: 'La medida no es válida',
  DIAMETER_ORDER: 'El diámetro exterior debe ser mayor que el interior',
  TARIFF_FORMAT: 'La partida arancelaria no es válida',
  DATE_INVALID: 'La fecha no es válida',
  DATE_FUTURE: 'La fecha no puede ser futura',
  STOCK_RANGE: 'El máximo no puede ser menor que el mínimo',
  BRAND_NOT_FOUND: 'Marca no existe',
  CATEGORY_NOT_FOUND: 'Categoría no existe',
  SUBCATEGORY_NOT_FOUND: 'Subcategoría no existe',
  DUPLICATE_IN_FILE: 'Código repetido en el archivo',
  PRODUCT_EXISTS: 'El producto ya existe',
  EXISTING_IS_DRAFT: 'El producto existente es un borrador',
  CATEGORY_LOCKED: 'El producto tiene movimientos: no se puede cambiar la categoría',
  WAREHOUSE_NOT_FOUND: 'Almacén no existe',
  WAREHOUSE_INACTIVE: 'Almacén inactivo',
  WAREHOUSE_NOT_ALLOWED: 'No puedes operar este almacén',
  STOCK_INVALID: 'El stock debe ser un número entero de 0 o más',
  STOCK_ON_SKIPPED_ROW: 'El stock de una fila omitida no se importa',
  PRODUCT_WILL_UPDATE: 'Se actualizará el producto existente',
  STOCK_WILL_ADJUST: (p) => `Ajustará el stock de ${p['from']} a ${p['to']}`,
};

/** The Spanish text of an issue, for the preview table and the error report. */
export function describeImportIssue(issue: ImportIssue): string {
  const text = ISSUE_TEXT[issue.code];
  return typeof text === 'function' ? text(issue.params ?? {}) : text;
}
