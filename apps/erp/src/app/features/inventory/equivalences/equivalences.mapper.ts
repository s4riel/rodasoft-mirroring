import type { EquivalenceFilters, EquivalenceKind, EquivalenceListItem, EquivalenceListProduct } from '@rodasoft/domain';
import type { DocTableRow, SelectOption } from '@rodasoft/ui';
import { formatMeasure } from '../products/product-list.mapper';
import { equivalencePill } from '../products/sheet/equivalents/equivalence-pill';

/** Rows per page of the table (Figma DocTable with a 10-row pagination). */
export const EQUIVALENCES_PAGE_SIZE = 10;

export const KIND_OPTIONS: SelectOption[] = [
  { value: 'EXACT', label: 'Exacta' },
  { value: 'WITH_DIFFERENCES', label: 'Con diferencias' },
  { value: 'INCOMPATIBLE', label: 'Medidas distintas' },
];

/** What the URL holds: every filter is optional and the page starts at 1. */
export interface EquivalenceUrlFilters {
  q: string;
  brandId: string | null;
  categoryId: string | null;
  kind: EquivalenceKind | null;
  page: number;
}

export function parseKind(raw: string | null): EquivalenceKind | null {
  return raw === 'EXACT' || raw === 'WITH_DIFFERENCES' || raw === 'INCOMPATIBLE' ? raw : null;
}

/** The filters of the URL as the API query; an empty filter is left out. */
export function toQuery(f: EquivalenceUrlFilters): EquivalenceFilters {
  return {
    q: f.q || undefined,
    brandId: f.brandId ?? undefined,
    categoryId: f.categoryId ?? undefined,
    kind: f.kind ?? undefined,
    page: f.page,
    pageSize: EQUIVALENCES_PAGE_SIZE,
  };
}

/** "25×52×15 mm"; a product without all three measures gives an en dash. */
export function measuresLabel(product: Pick<EquivalenceListProduct, 'dimensions'>): string {
  const d = product.dimensions;
  if (!d?.innerDiameter || !d.outerDiameter || !d.width) return '–';
  return `${[d.innerDiameter, d.outerDiameter, d.width].map(formatMeasure).join('×')} mm`;
}

/** Row of the table: the kind pill carries the differences in its tooltip; the sides are drawn by cell templates. */
export function toRow(item: EquivalenceListItem): DocTableRow {
  return {
    id: item.id,
    cells: {
      measures: measuresLabel(item.productA),
      kind: equivalencePill(item, 'short'),
    },
  };
}
