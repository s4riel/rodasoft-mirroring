/** Product catalog contracts and pure rules shared by the API and the ERP (HU-INV-01). */

export const PRODUCT_PAGE_SIZE_DEFAULT = 25;
export const PRODUCT_PAGE_SIZE_MAX = 100;

export type ProductStatusFilter = 'ACTIVE' | 'INACTIVE';

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
  status: ProductStatusFilter;
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
