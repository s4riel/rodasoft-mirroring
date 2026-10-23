/** Equivalences between products (HU-INV-04): the comparison rule and the response contracts. */
import { Decimal } from './money';
import type { ProductBrandSummary, ProductCountrySummary, ProductStatus } from './product-catalog';

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
