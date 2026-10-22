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
}

export interface ProductListQuery extends ProductListFilters {
  page: number;
  pageSize: number;
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
  category: { id: string; name: string };
  subcategory: { id: string; name: string } | null;
  /** d × D × B in mm, as strings to avoid float rounding. */
  dimensions: { innerDiameter: string | null; outerDiameter: string | null; width: string | null } | null;
  totalStock: number;
  /** Stock in the warehouses of the current branch. */
  branchStock: number;
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
    filters.countryId || filters.categoryId || filters.subcategoryId || filters.brandId || filters.status,
  );
}
