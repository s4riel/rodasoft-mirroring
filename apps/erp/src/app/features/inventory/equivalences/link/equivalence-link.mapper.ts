import {
  type EquivalenceKind,
  type EquivalenceMeasures,
  type EquivalenceValidationResponse,
  type ProductBrandSummary,
  type ProductCountrySummary,
  type ProductDetail,
  type ProductListItem,
} from '@rodasoft/domain';
import type { SelectOption } from '@rodasoft/ui';
import { formatMeasure } from '../../products/product-list.mapper';

/** A product as the link form draws it: picked from the search or handed in by the screen that opens the form. */
export interface LinkProduct {
  id: string;
  manufacturerCode: string;
  brand: ProductBrandSummary;
  country: ProductCountrySummary | null;
  photoUrl: string | null;
  /** Glyph of the root category, drawn when there is no photo. */
  categoryIcon: string;
  dimensions: EquivalenceMeasures | null;
}

export function linkProductOfListItem(item: ProductListItem): LinkProduct {
  return {
    id: item.id,
    manufacturerCode: item.manufacturerCode,
    brand: item.brand,
    country: item.country,
    photoUrl: item.photoUrl,
    categoryIcon: item.category.icon,
    dimensions: item.dimensions
      ? { innerDiameter: item.dimensions.innerDiameter, outerDiameter: item.dimensions.outerDiameter, width: item.dimensions.width }
      : null,
  };
}

export function linkProductOfDetail(detail: ProductDetail): LinkProduct {
  return {
    id: detail.id,
    manufacturerCode: detail.manufacturerCode,
    brand: detail.brand,
    country: detail.country,
    photoUrl: detail.photos[0] ?? null,
    categoryIcon: detail.category.icon,
    dimensions: detail.dimensions
      ? { innerDiameter: detail.dimensions.innerDiameter, outerDiameter: detail.dimensions.outerDiameter, width: detail.dimensions.width }
      : null,
  };
}

/** "25×52×15 mm"; a product without all three measures gives an en dash. */
export function measuresText(dimensions: EquivalenceMeasures | null): string {
  if (!dimensions?.innerDiameter || !dimensions.outerDiameter || !dimensions.width) return '–';
  return `${[dimensions.innerDiameter, dimensions.outerDiameter, dimensions.width].map(formatMeasure).join('×')} mm`;
}

/** "6205-2RS · SKF": what the field shows for a picked product (Figma IN-15c). */
export function productLabel(product: Pick<LinkProduct, 'manufacturerCode' | 'brand'>): string {
  return `${product.manufacturerCode} · ${product.brand.name}`;
}

/** The three classifications of the "Tipo de equivalencia" field. */
export type LinkType = 'EXACT' | 'WITH_DIFFERENCES' | 'SUBSTITUTE';

export const TYPE_OPTIONS: readonly SelectOption<LinkType>[] = [
  { value: 'EXACT', label: 'Exacta' },
  { value: 'WITH_DIFFERENCES', label: 'Con diferencias' },
  { value: 'SUBSTITUTE', label: 'Sustituto' },
];

/**
 * The type the field shows: "Sustituto" when the user chose it, else what the products say (exact or with differences),
 * which is computed and never typed. Without a verdict, or when it is incompatible, there is nothing to show.
 */
export function shownType(substitute: boolean, kind: EquivalenceKind | null): LinkType | null {
  if (substitute) return 'SUBSTITUTE';
  return kind === 'EXACT' || kind === 'WITH_DIFFERENCES' ? kind : null;
}

/** Figma IN-15d, under "Rodamiento equivalente": the pair is already linked. */
export function existsMessage(origin: LinkProduct, equivalent: LinkProduct): string {
  return `Ya existe el vínculo ${origin.manufacturerCode} → ${equivalent.manufacturerCode}. Edítalo desde la lista.`;
}

/** Figma IN-15e, under "Rodamiento equivalente": the measures differ; a different type with the same measures says so. */
export function incompatibleMessage(
  origin: LinkProduct,
  equivalent: LinkProduct,
  validation: Pick<EquivalenceValidationResponse, 'measureDifferences'>,
): string {
  if (!validation.measureDifferences.length) return 'No son del mismo tipo de rodamiento.';
  return `Medidas: ${measuresText(origin.dimensions)} (origen) frente a ${measuresText(equivalent.dimensions)} (equivalente).`;
}

/** A found product is offered as the equivalent unless it is the origin itself or is already linked to it. */
export function isAvailableEquivalent(candidate: LinkProduct, origin: LinkProduct, linkedIds: ReadonlySet<string>): boolean {
  return candidate.id !== origin.id && !linkedIds.has(candidate.id);
}

export const SAME_BRAND_MESSAGE = 'Debe ser de una marca distinta al origen.';
