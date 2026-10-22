import type { ProductListItem } from '@rodasoft/domain';
import { FLAG_COUNTRIES, FlagCountry, ICON_NAMES, IconName, ProductAvailability, ProductTableRow } from '@rodasoft/ui';

/** Product list rows per page (Figma ProductTable10). */
export const PRODUCTS_PAGE_SIZE = 10;

/** "25.000" -> "25", "16.250" -> "16,25" (es-BO decimal comma). */
export function formatMeasure(value: string): string {
  const trimmed = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return trimmed.replace('.', ',');
}

/** "Rodillos cónicos, 40×80×19,25 mm"; the measurement part is omitted when the product has none. */
export function describeProduct(item: ProductListItem): string {
  const kind = (item.subcategory ?? item.category).name;
  const d = item.dimensions;
  if (!d?.innerDiameter || !d.outerDiameter || !d.width) return kind;
  const measure = [d.innerDiameter, d.outerDiameter, d.width].map(formatMeasure).join('×');
  return `${kind}, ${measure} mm`;
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

export function toTableRow(item: ProductListItem): ProductTableRow {
  return {
    id: item.id,
    photoUrl: item.photoUrl,
    thumbIcon: thumbIconOf(item.category.icon),
    code: item.manufacturerCode,
    name: item.name,
    brandName: item.brand.name,
    brandLogoUrl: item.brand.logoUrl,
    country: flagOf(item.country?.code),
    description: describeProduct(item),
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
