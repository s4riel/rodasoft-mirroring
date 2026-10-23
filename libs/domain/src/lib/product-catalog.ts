/** Product catalog contracts and pure rules shared by the API and the ERP (HU-INV-01, 02, 03). */

import { Decimal } from './money';

export const PRODUCT_PAGE_SIZE_DEFAULT = 25;
export const PRODUCT_PAGE_SIZE_MAX = 100;

export type ProductStatusFilter = 'ACTIVE' | 'INACTIVE' | 'DRAFT';

/** Product status (mirrors the Prisma enum). DRAFT is an unfinished product from the creation wizard (HU-INV-06). */
export type ProductStatus = ProductStatusFilter;

/** Filters of the product list. There is intentionally no branch filter. */
export interface ProductListFilters {
  countryId?: string;
  categoryId?: string;
  subcategoryId?: string;
  brandId?: string;
  status?: ProductStatusFilter;
  /** Free text: code, SKU, name, brand or a measurement such as "25x52x15". */
  search?: string;
}

export interface ProductListQuery extends ProductListFilters {
  /** Branch whose stock is shown in `branchStock`. It is not a filter. */
  branchId?: string;
  page: number;
  pageSize: number;
}

/** Single source of the internal SKU prefix (decision #32); it moves to company settings with HU-INV-06. */
export const SKU_PREFIX = 'RL-';
const SKU_DIGITS = 6;

/** `formatSku('RL-', 7)` → `RL-000007`. */
export function formatSku(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(SKU_DIGITS, '0')}`;
}

/** Number of a SKU built by `formatSku`; null for any other shape (imported or legacy SKUs). */
export function parseSkuNumber(sku: string, prefix: string): number | null {
  if (!sku.startsWith(prefix)) return null;
  const digits = sku.slice(prefix.length);
  return digits.length >= SKU_DIGITS && /^\d+$/.test(digits) ? Number(digits) : null;
}

export type ProductCopyPart = 'dimensions' | 'specifications' | 'price' | 'media' | 'equivalences';

/** Parts copied by default in the duplicate dialog (Figma IN-19). */
export const DEFAULT_COPY_PARTS: readonly ProductCopyPart[] = ['dimensions', 'specifications', 'price'];

export interface DuplicateProductRequest {
  manufacturerCode: string;
  brandId: string;
  /** Industry (country of origin) of the copy. */
  countryId: string | null;
  copy: ProductCopyPart[];
}

export interface DuplicateProductResponse {
  id: string;
  sku: string;
}

export interface ProductDimensionValues {
  innerDiameter: string | null;
  outerDiameter: string | null;
  width: string | null;
  weight: string | null;
}

/** The fields of a product that a copy can inherit. Money travels as decimal strings. */
export interface DuplicateSource {
  name: string;
  categoryId: string;
  unit: string;
  salePrice: string;
  cost: string | null;
  attributes: Record<string, unknown>;
  photos: string[];
  datasheetUrl: string | null;
  dimensions: ProductDimensionValues | null;
}

export interface DuplicatePayload {
  manufacturerCode: string;
  brandId: string;
  countryId: string | null;
  categoryId: string;
  name: string;
  unit: string;
  status: 'ACTIVE';
  salePrice: string;
  cost: string | null;
  attributes: Record<string, unknown>;
  photos: string[];
  datasheetUrl: string | null;
  dimensions: ProductDimensionValues | null;
}

/**
 * What the copy of a product contains. Name, category and unit are always copied; the rest only with its
 * part. The copy is ACTIVE and never inherits stock. Without `price` the copy starts at 0.00 (HU-INV-06 warns).
 */
export function buildDuplicate(source: DuplicateSource, request: DuplicateProductRequest): DuplicatePayload {
  const has = (part: ProductCopyPart) => request.copy.includes(part);
  return {
    manufacturerCode: request.manufacturerCode.trim(),
    brandId: request.brandId,
    countryId: request.countryId,
    categoryId: source.categoryId,
    name: source.name,
    unit: source.unit,
    status: 'ACTIVE',
    salePrice: has('price') ? source.salePrice : '0.00',
    cost: has('price') ? source.cost : null,
    attributes: has('specifications') ? { ...source.attributes } : {},
    photos: has('media') ? [...source.photos] : [],
    datasheetUrl: has('media') ? source.datasheetUrl : null,
    dimensions: has('dimensions') && source.dimensions ? { ...source.dimensions } : null,
  };
}

export interface ProductBrandSummary {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface ProductCountrySummary {
  id: string;
  code: string;
  name: string;
}

export interface ProductListItem {
  id: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  photoUrl: string | null;
  brand: ProductBrandSummary;
  country: ProductCountrySummary | null;
  /** Root category; `icon` is the glyph name the ERP draws when the product has no photo. */
  category: { id: string; name: string; icon: string };
  subcategory: { id: string; name: string } | null;
  /** d × D × B in mm, as strings to avoid float rounding. */
  dimensions: { innerDiameter: string | null; outerDiameter: string | null; width: string | null } | null;
  totalStock: number;
  /** Stock in the warehouses of the selected branch; null when no branch is selected ("all branches"). */
  branchStock: number | null;
  /** Decimal string, scale 2. */
  salePrice: string;
  status: ProductStatus;
}

export interface ProductListResponse {
  items: ProductListItem[];
  page: number;
  pageSize: number;
  total: number;
  /** True when the company has no products at all (first use), regardless of the filters. */
  catalogEmpty: boolean;
}

export interface ProductFilterOptions {
  countries: { id: string; code: string; name: string }[];
  brands: { id: string; name: string; logoUrl: string | null; countryId: string | null }[];
  categories: { id: string; name: string; icon: string; subcategories: { id: string; name: string }[] }[];
}

export interface Measurement {
  innerDiameter: string;
  outerDiameter: string;
  width: string;
}

const MEASUREMENT_RE =
  /^\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(?:mm)?\s*$/i;

/** Reads "25x52x15" (also "25×52×15 mm", "17,5x40x12") as d × D × B; null when the text is not a measurement. */
export function parseMeasurement(term: string): Measurement | null {
  const m = MEASUREMENT_RE.exec(term);
  if (!m) return null;
  const [d, D, B] = [m[1], m[2], m[3]].map((v) => v.replace(',', '.'));
  return { innerDiameter: d, outerDiameter: D, width: B };
}

export function clampPageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return PRODUCT_PAGE_SIZE_DEFAULT;
  return Math.min(Math.floor(value), PRODUCT_PAGE_SIZE_MAX);
}

export function clampPage(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return 1;
  return Math.floor(value);
}

export function hasActiveFilters(filters: ProductListFilters): boolean {
  return Boolean(
    filters.countryId ||
      filters.categoryId ||
      filters.subcategoryId ||
      filters.brandId ||
      filters.status ||
      filters.search?.trim(),
  );
}

export type StockAvailability = 'available' | 'low' | 'out';

/** Out at zero or below, low at or under the branch minimum (when there is one), otherwise available. */
export function stockAvailability(quantity: number, minStock: number | null): StockAvailability {
  if (quantity <= 0) return 'out';
  return minStock !== null && quantity <= minStock ? 'low' : 'available';
}

/** (price − cost) / price × 100 with one decimal ("40.0"); null without cost or with a price of 0. */
export function marginPercent(salePrice: string, cost: string | null): string | null {
  if (cost === null) return null;
  const price = Decimal.of(salePrice, 4);
  if (price.isZero()) return null;
  return price.sub(Decimal.of(cost, 4)).mul(100).div(price).round(1).toString();
}

export type AttributeKind = 'TEXT' | 'NUMBER' | 'ENUM' | 'BOOLEAN';

/** Creation step whose fields feed the sheet's "Dimensiones" card. */
export const SPEC_STEP_DIMENSIONS = 2;
/** Creation step whose fields feed the sheet's "Especificaciones técnicas" card. */
export const SPEC_STEP_SPECIFICATIONS = 3;

export interface ProductSpec {
  key: string;
  /** Creation step of the field (see SPEC_STEP_*). */
  step: number;
  label: string;
  type: AttributeKind;
  unit: string | null;
  value: string | number | boolean | null;
}

export interface ProductBranchStock {
  branchId: string;
  branchName: string;
  /** Names of the branch's warehouses, in code order. */
  warehouses: string[];
  quantity: number;
  minStock: number | null;
  maxStock: number | null;
  location: string | null;
  availability: StockAvailability;
}

export interface ProductActor {
  id: string;
  name: string;
}

/** Product sheet (IN-02a). `cost` and `marginPercent` are present only with `inventory.costs.view`. */
export interface ProductDetail {
  id: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  unit: string;
  status: ProductStatus;
  brand: ProductBrandSummary;
  country: ProductCountrySummary | null;
  category: { id: string; name: string; icon: string };
  subcategory: { id: string; name: string } | null;
  dimensions: (Measurement & { weight: string | null }) | null;
  specs: ProductSpec[];
  /** Read from `attributes` when present (Purchasing and Web define their real sources later). */
  extra: { tariffCode: string | null; supplierName: string | null; sectors: string | null };
  pricing: { salePrice: string; cost?: string | null; marginPercent?: string | null };
  totalStock: number;
  stockByBranch: ProductBranchStock[];
  photos: string[];
  datasheetUrl: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: ProductActor | null;
  updatedBy: ProductActor | null;
}

export type FieldIconName = 'barcode' | 'hash' | 'diameter' | 'ruler' | 'package' | 'currency' | 'percent' | 'calendar' | 'warehouse' | 'tag' | 'info' | 'check' | 'user';

export interface FieldIconInput {
  type: AttributeKind | 'CODE' | 'SKU' | 'MONEY' | 'PERCENT' | 'DATE' | 'LOCATION' | 'USER';
  unit?: string | null;
  key?: string;
}

/** Icon that tells the data type of a sheet field (HU-INV-03). */
export function fieldIconOf({ type, unit, key = '' }: FieldIconInput): FieldIconName {
  switch (type) {
    case 'CODE':
      return 'barcode';
    case 'SKU':
      return 'hash';
    case 'MONEY':
      return 'currency';
    case 'PERCENT':
      return 'percent';
    case 'DATE':
      return 'calendar';
    case 'LOCATION':
      return 'warehouse';
    case 'USER':
      return 'user';
    case 'ENUM':
      return 'tag';
    case 'BOOLEAN':
      return 'check';
    case 'TEXT':
      return 'info';
    case 'NUMBER':
      if (unit === 'kg') return 'package';
      if (unit === 'mm') return /diameter|radius/i.test(key) ? 'diameter' : 'ruler';
      return 'hash';
  }
}
