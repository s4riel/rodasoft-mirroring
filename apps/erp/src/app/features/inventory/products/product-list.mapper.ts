import { type EquivalenceMeasures, type ProductListItem, sameMeasures } from '@rodasoft/domain';
import { FLAG_COUNTRIES, FlagCountry, ICON_NAMES, IconName, ProductAvailability, ProductTableRow } from '@rodasoft/ui';

/** Product list rows per page (Figma ProductTable10). */
export const PRODUCTS_PAGE_SIZE = 10;

/** "25.000" -> "25", "16.250" -> "16,25" (es-BO decimal comma). */
export function formatMeasure(value: string): string {
  const trimmed = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return trimmed.replace('.', ',');
}

/**
 * "Medidas: 40×80×19,25 mm · Peso: 0,13 kg · Sello: 2RS · Material: Acero": the measures and weight when the product has
 * them and its filled technical fields (dimension fields such as the series, and specifications), each with its label. The type is not repeated: the "Producto" column already shows it. The table clamps the text
 * to two lines and shows all of it in a tooltip; a product with neither measures nor fields gives an empty text.
 */
export function describeProduct(item: ProductListItem): string {
  const d = item.dimensions;
  const parts: string[] = [];
  if (d?.innerDiameter && d.outerDiameter && d.width) {
    parts.push(`Medidas: ${[d.innerDiameter, d.outerDiameter, d.width].map(formatMeasure).join('×')} mm`);
  }
  if (d?.weight) parts.push(`Peso: ${formatMeasure(d.weight)} kg`);
  for (const spec of item.specs ?? []) parts.push(`${spec.label}: ${spec.value}`);
  return parts.join(' · ');
}

/**
 * Availability shown in the Status column. "Low stock" needs per-branch minimums (HU-INV-27), which do not
 * exist yet, so only available / out / inactive are derived. Without a selected branch the total stock decides.
 */
export function availabilityOf(item: ProductListItem): ProductAvailability {
  if (item.status === 'INACTIVE') return 'inactive';
  const stock = item.branchStock ?? item.totalStock;
  return stock <= 0 ? 'out' : 'available';
}

export function flagOf(code: string | undefined): FlagCountry | null {
  return code && (FLAG_COUNTRIES as readonly string[]).includes(code) ? (code as FlagCountry) : null;
}

/** Category glyph for the photo placeholder; an unknown name falls back to the bearing. */
export function thumbIconOf(name: string): IconName {
  return (ICON_NAMES as readonly string[]).includes(name) ? (name as IconName) : 'bearing';
}

/** A product found by "Buscar otra referencia" (equivalence step and "Producto creado"): photo, code and its data line. */
export interface ReferenceSearchResult {
  productId: string;
  code: string;
  brand: string;
  /** Leaf category: a link needs the same type. */
  categoryId: string;
  /** d × D × B as the API knows them; null when the product has none. */
  measures: EquivalenceMeasures | null;
  /** First photo; null while the product has none. */
  photoUrl: string | null;
  /** Glyph of the root category, drawn when there is no photo. */
  icon: IconName;
  /** "25×52×15 mm"; null when the product has no measures. */
  dimensions: string | null;
  /** "Sello: 2RS · Material: Acero"; null when no technical field is filled. */
  specs: string | null;
  /** Industry (country of origin) with its flag, when known. */
  industry: { name: string; flag: FlagCountry | null } | null;
}

export function toReferenceSearchResult(item: ProductListItem): ReferenceSearchResult {
  const d = item.dimensions;
  const specs = (item.specs ?? []).map((s) => `${s.label}: ${s.value}`).join(' · ');
  return {
    productId: item.id,
    code: item.manufacturerCode,
    brand: item.brand.name,
    categoryId: item.subcategory?.id ?? item.category.id,
    measures: d ? { innerDiameter: d.innerDiameter, outerDiameter: d.outerDiameter, width: d.width } : null,
    photoUrl: item.photoUrl,
    icon: thumbIconOf(item.category.icon),
    dimensions: d?.innerDiameter && d.outerDiameter && d.width ? `${[d.innerDiameter, d.outerDiameter, d.width].map(formatMeasure).join('×')} mm` : null,
    specs: specs || null,
    industry: item.country ? { name: item.country.name, flag: flagOf(item.country.code) } : null,
  };
}

/**
 * Whether a search result can be linked to the product being created: the API only links products of the same type and
 * d × D × B (EQUIVALENCE_INCOMPATIBLE otherwise), so the others are shown but not offered.
 */
export function canLinkReference(result: Pick<ReferenceSearchResult, 'categoryId' | 'measures'>, product: { categoryId: string | null; measures: EquivalenceMeasures | null }): boolean {
  return !!product.categoryId && result.categoryId === product.categoryId && sameMeasures(result.measures, product.measures);
}

export function toTableRow(item: ProductListItem): ProductTableRow {
  return {
    id: item.id,
    photoUrl: item.photoUrl,
    thumbIcon: thumbIconOf(item.category.icon),
    code: item.manufacturerCode,
    // the "Producto" column shows the type of product: the subcategory, or the category when there is none
    name: (item.subcategory ?? item.category).name,
    brandName: item.brand.name,
    brandLogoUrl: item.brand.logoUrl,
    country: flagOf(item.country?.code),
    countryName: item.country?.name ?? null,
    description: describeProduct(item) || '–',
    totalStock: item.totalStock,
    branchStock: item.branchStock,
    price: item.salePrice,
    availability: availabilityOf(item),
  };
}

/** Sum of the branch stock of the visible rows; null when no branch is selected. */
export function branchStockSubtotal(items: readonly ProductListItem[]): number | null {
  if (!items.length || items.some((i) => i.branchStock === null)) return null;
  return items.reduce((sum, i) => sum + (i.branchStock ?? 0), 0);
}
