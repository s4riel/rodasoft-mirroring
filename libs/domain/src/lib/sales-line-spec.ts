/**
 * The measures and type of a product as quotes, orders and sales show them under each line (HU-VEN-36): "25 × 52 × 15 mm ·
 * Rodamientos · Rígidos de bolas · Sello: 2RS". Read live from the product, so editing a product changes how old documents read.
 */
import type { EquivalenceMeasures } from './equivalence';

export interface SalesLineSpec {
  measures: EquivalenceMeasures | null;
  /** Root category name. */
  category: string | null;
  subcategory: string | null;
  /** Filled technical values, "Label: value" (see `summarizeSpecs`). */
  details: string[];
}

export const EMPTY_SALES_LINE_SPEC: SalesLineSpec = { measures: null, category: null, subcategory: null, details: [] };

/** "25" or "19,25": trailing zeros dropped, comma as the decimal separator. */
function measureText(value: string): string {
  const trimmed = value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
  return trimmed.replace('.', ',');
}

/** "25 × 52 × 15 mm" (inner Ø × outer Ø × width); `null` while one of the three is missing. */
export function formatMeasures(measures: EquivalenceMeasures | null | undefined): string | null {
  if (!measures?.innerDiameter || !measures.outerDiameter || !measures.width) return null;
  return `${[measures.innerDiameter, measures.outerDiameter, measures.width].map(measureText).join(' × ')} mm`;
}

/** The measures, the type (category · subcategory) and the first `detailsShown` technical values, joined with " · ". */
export function salesLineSpecText(spec: SalesLineSpec | null | undefined, { detailsShown = 2 }: { detailsShown?: number } = {}): string {
  if (!spec) return '';
  return [formatMeasures(spec.measures), spec.category, spec.subcategory, ...spec.details.slice(0, Math.max(0, detailsShown))]
    .filter((part): part is string => !!part)
    .join(' · ');
}
