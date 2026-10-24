/** Equivalences between products (HU-INV-04): the comparison rule and the response contracts. */
import { Decimal } from './money';
import { type AttributeKind, attributeValueText, type ProductBrandSummary, type ProductCountrySummary, type ProductStatus } from './product-catalog';

/**
 * - EXACT: same type and d × D × B, and none of the compared specifications differs.
 * - WITH_DIFFERENCES: same type and d × D × B, but at least one compared specification differs.
 * - INCOMPATIBLE: the type or d × D × B differ, so it is not an equivalent (HU-INV-13 uses this to warn).
 */
export type EquivalenceKind = 'EXACT' | 'WITH_DIFFERENCES' | 'INCOMPATIBLE';

/**
 * Specifications compared once type and measurements match (design-notes §Equivalences): seal, internal clearance,
 * tolerance, cage and load capacity. They are the bearing `attribute_definitions` keys.
 */
export const EQUIVALENCE_COMPARED_KEYS = [
  'seal',
  'internalClearance',
  'toleranceClass',
  'cage',
  'dynamicLoad',
  'staticLoad',
] as const;

export interface EquivalenceMeasures {
  /** d, inner diameter (mm), decimal string. */
  innerDiameter: string | null;
  /** D, outer diameter (mm), decimal string. */
  outerDiameter: string | null;
  /** B, width (mm); T for tapered bearings, stored in the same column. */
  width: string | null;
}

export interface EquivalenceComparable {
  /** Leaf category: two products are of the same type when it matches. */
  categoryId: string;
  dimensions: EquivalenceMeasures | null;
  attributes: Record<string, unknown>;
}

export interface EquivalenceDifference {
  key: string;
  label: string;
  /** Value on the product being viewed; null when it has none. */
  source: string | null;
  /** Value on the equivalent; null when it has none. */
  other: string | null;
}

export interface EquivalenceComparison {
  kind: EquivalenceKind;
  differences: EquivalenceDifference[];
}

/** Display text of an attribute value; a missing value is `null`. */
function attributeText(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

/** "25" and "25.000" are the same measurement; a missing one never matches. */
function sameMeasure(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return Decimal.of(a, 3).eq(Decimal.of(b, 3));
}

export function sameMeasures(a: EquivalenceMeasures | null, b: EquivalenceMeasures | null): boolean {
  if (!a || !b) return false;
  return (
    sameMeasure(a.innerDiameter, b.innerDiameter) &&
    sameMeasure(a.outerDiameter, b.outerDiameter) &&
    sameMeasure(a.width, b.width)
  );
}

/**
 * Compares `other` against `source`. `labels` maps a specification key to its display label (from the category's
 * attribute definitions); a key without a label falls back to the key. A specification present on one side only
 * counts as a difference; absent on both sides it does not.
 */
export function compareEquivalents(
  source: EquivalenceComparable,
  other: EquivalenceComparable,
  labels: Readonly<Record<string, string>> = {},
): EquivalenceComparison {
  if (source.categoryId !== other.categoryId || !sameMeasures(source.dimensions, other.dimensions)) {
    return { kind: 'INCOMPATIBLE', differences: [] };
  }
  const differences: EquivalenceDifference[] = [];
  for (const key of EQUIVALENCE_COMPARED_KEYS) {
    const a = attributeText(source.attributes[key]);
    const b = attributeText(other.attributes[key]);
    if (a !== b) differences.push({ key, label: labels[key] ?? key, source: a, other: b });
  }
  return { kind: differences.length ? 'WITH_DIFFERENCES' : 'EXACT', differences };
}

/** Canonical order of a pair, as stored (`productAId < productBId`); the same order Postgres uses for uuids. */
export function normalizePair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** One row of the equivalents table: the original product or an equivalent. */
export interface ProductEquivalentItem {
  productId: string;
  manufacturerCode: string;
  brand: ProductBrandSummary;
  country: ProductCountrySummary | null;
  totalStock: number;
  /** Decimal string, scale 2. */
  salePrice: string;
  status: ProductStatus;
  kind: EquivalenceKind;
  differences: EquivalenceDifference[];
}

export interface ProductEquivalentsSummary {
  /** Distinct brands among the equivalents (the sheet KPI "2 marcas"). */
  brandCount: number;
  exact: number;
  withDifferences: number;
  incompatible: number;
}

export interface ProductEquivalentsResponse {
  /** The product being viewed (shown first, as "Original"); its `kind` is EXACT and it has no differences. */
  source: ProductEquivalentItem;
  /** The page of equivalents: exact first, then by brand name. */
  items: ProductEquivalentItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: ProductEquivalentsSummary;
  /** Footer of the table: the original plus every equivalent (not only this page). */
  totals: { codes: number; stock: number };
}

/** A product that could be linked to the one being created (HU-INV-06): same type and d×D×B, not linked yet. */
export interface EquivalenceSuggestion {
  productId: string;
  manufacturerCode: string;
  brand: ProductBrandSummary;
  kind: EquivalenceKind;
  differences: EquivalenceDifference[];
}

export interface EquivalenceSuggestionsResponse {
  items: EquivalenceSuggestion[];
}

export interface EquivalenceLinkResponse {
  id: string;
  productAId: string;
  productBId: string;
}

/** One side of a link in the company-wide equivalence table (HU-INV-11). Never carries cost. */
export interface EquivalenceListProduct {
  id: string;
  manufacturerCode: string;
  brand: ProductBrandSummary;
  country: ProductCountrySummary | null;
  /** First photo; null while the product has none. */
  photoUrl: string | null;
  /** Glyph of the root category, drawn when there is no photo. */
  categoryIcon: string;
  /** d × D × B in mm, decimal strings. */
  dimensions: EquivalenceMeasures | null;
  totalStock: number;
  status: ProductStatus;
}

/** A saved link, stored once as a canonical pair. `differences` read from side A to side B. */
export interface EquivalenceListItem {
  id: string;
  productA: EquivalenceListProduct;
  productB: EquivalenceListProduct;
  kind: EquivalenceKind;
  differences: EquivalenceDifference[];
  createdBy: { id: string; name: string } | null;
  /** ISO instant. */
  createdAt: string;
}

export interface EquivalenceFilters {
  /** Links where either side is of this brand. */
  brandId?: string;
  /** Links where either side is of this category (a root category also matches its subcategories). */
  categoryId?: string;
  kind?: EquivalenceKind;
  /** Manufacturer code of either side (contains, case-insensitive). */
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface EquivalenceListResponse {
  items: EquivalenceListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** True when the company has no links at all, regardless of the filters (first use). */
  linksEmpty: boolean;
}

/** Products the comparator accepts: the screen's limit, not a client setting. */
export const EQUIVALENCE_COMPARE_MIN = 2;
export const EQUIVALENCE_COMPARE_MAX = 4;

/** A product as the comparator reads it. */
export interface EquivalenceCompareProduct extends EquivalenceComparable {
  productId: string;
  /** Tapered bearings give T instead of B in the width. */
  tapered: boolean;
  /** Industry (country of origin) name. */
  country: string | null;
}

/** A technical field of a category, in the order the comparator lists it. */
export interface EquivalenceCompareDefinition {
  key: string;
  label: string;
  type: AttributeKind;
  unit: string | null;
}

export type EquivalenceComparisonGroup = 'MEASURES' | 'SPECS';

/** How one column compares with the reference (the first one). The reference itself is EXACT with no differences. */
export interface EquivalenceComparisonVerdict {
  productId: string;
  kind: EquivalenceKind;
  differences: EquivalenceDifference[];
}

/**
 * One attribute across the products. Measure rows use the keys `innerDiameter`, `outerDiameter` and `width` with the
 * symbols d, D and B / T as label (the screen names them); `country` is the industry; the rest are the category fields.
 */
export interface EquivalenceComparisonRow {
  key: string;
  label: string;
  unit: string | null;
  group: EquivalenceComparisonGroup;
  /** One per column, in column order; `null` when the product has no value. */
  values: (string | null)[];
  /** Some product's value differs from the others'. */
  differs: boolean;
}

export interface EquivalenceComparisonGrid {
  columns: EquivalenceComparisonVerdict[];
  rows: EquivalenceComparisonRow[];
}

const NUMERIC = /^-?\d+([.,]\d+)?$/;

/** Same value: numbers compare as decimals ("14.8" = "14,80"), anything else as text; missing never equals present. */
function sameValue(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  if (NUMERIC.test(a) && NUMERIC.test(b)) return Decimal.of(a, 4).eq(Decimal.of(b, 4));
  return a === b;
}

function rowOf(
  key: string,
  label: string,
  unit: string | null,
  group: EquivalenceComparisonGroup,
  values: (string | null)[],
): EquivalenceComparisonRow {
  return { key, label, unit, group, values, differs: values.some((v) => !sameValue(v, values[0])) };
}

function measureText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

/**
 * Lines the products up for the side-by-side comparison (HU-INV-12). The first product is the reference: each other
 * column is compared with it through `compareEquivalents`, and a row differs when any of its values differs. Rows:
 * the three measures, the industry, then the category fields with the compared keys first.
 */
export function buildEquivalenceComparison(
  products: readonly EquivalenceCompareProduct[],
  definitions: readonly EquivalenceCompareDefinition[],
): EquivalenceComparisonGrid {
  const [reference] = products;
  const labels = Object.fromEntries(definitions.map((d) => [d.key, d.label]));
  const columns = products.map<EquivalenceComparisonVerdict>((p, i) =>
    i === 0 ? { productId: p.productId, kind: 'EXACT', differences: [] } : { productId: p.productId, ...compareEquivalents(reference, p, labels) },
  );

  const taperedCount = products.filter((p) => p.tapered).length;
  const widthLabel = taperedCount === 0 ? 'B' : taperedCount === products.length ? 'T' : 'B / T';
  const rows: EquivalenceComparisonRow[] = [
    rowOf('innerDiameter', 'd', 'mm', 'MEASURES', products.map((p) => measureText(p.dimensions?.innerDiameter))),
    rowOf('outerDiameter', 'D', 'mm', 'MEASURES', products.map((p) => measureText(p.dimensions?.outerDiameter))),
    rowOf('width', widthLabel, 'mm', 'MEASURES', products.map((p) => measureText(p.dimensions?.width))),
    rowOf('country', 'country', null, 'SPECS', products.map((p) => measureText(p.country))),
  ];

  const compared = (key: string) => (EQUIVALENCE_COMPARED_KEYS as readonly string[]).indexOf(key);
  const ordered = [
    ...definitions.filter((d) => compared(d.key) >= 0).sort((a, b) => compared(a.key) - compared(b.key)),
    ...definitions.filter((d) => compared(d.key) < 0),
  ];
  for (const d of ordered) {
    rows.push(rowOf(d.key, d.label, d.unit, 'SPECS', products.map((p) => attributeValueText(p.attributes[d.key]))));
  }
  return { columns, rows };
}

/** Product detail of one column of the comparator. Never carries cost. */
export interface EquivalenceComparisonColumn extends EquivalenceComparisonVerdict {
  manufacturerCode: string;
  brand: ProductBrandSummary;
  country: ProductCountrySummary | null;
  /** First photo; null while the product has none. */
  photoUrl: string | null;
  /** Glyph of the root category, drawn when there is no photo. */
  categoryIcon: string;
  totalStock: number;
  /** Decimal string, scale 2. */
  salePrice: string;
  status: ProductStatus;
}

export interface EquivalenceComparisonResponse {
  /** In the order requested; the first one is the reference. */
  columns: EquivalenceComparisonColumn[];
  rows: EquivalenceComparisonRow[];
}

/** Tapered bearings measure T instead of B; they are told apart by their category name ("Rodillos cónicos"). */
export function isTaperedCategory(name: string): boolean {
  return /c[oó]nic|tapered/i.test(name);
}
