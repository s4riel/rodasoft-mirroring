import type { EquivalenceComparisonColumn, EquivalenceComparisonGroup, EquivalenceComparisonRow } from '@rodasoft/domain';
import type { IconName, Status } from '@rodasoft/ui';
import { describeDifference } from '../../products/sheet/equivalents/equivalence-pill';

/** Ids of the `ids` query parameter: trimmed, without blanks or repeats, in the order given. */
export function parseIds(raw: string | null): string[] {
  return [...new Set((raw ?? '').split(',').map((id) => id.trim()).filter(Boolean))];
}

export const GROUP_TITLES: Record<EquivalenceComparisonGroup, string> = {
  MEASURES: 'Medidas',
  SPECS: 'Características',
};

const ROW_TITLES: Record<string, string> = {
  innerDiameter: 'Diámetro interior',
  outerDiameter: 'Diámetro exterior',
  country: 'Industria',
};

/** "Diámetro interior (d)"; the width is B, T (total width of tapered bearings) or both. Fields of the category keep their label. */
export function rowTitle(row: EquivalenceComparisonRow): string {
  if (row.key === 'width') return `${row.label === 'T' ? 'Ancho total' : 'Ancho'} (${row.label})`;
  const title = ROW_TITLES[row.key];
  if (!title) return row.label;
  return row.group === 'MEASURES' ? `${title} (${row.label})` : title;
}

/** A value with its unit; a missing one is an em dash. */
export function cellText(row: EquivalenceComparisonRow, value: string | null): string {
  if (value === null) return '—';
  return row.unit && !value.includes(row.unit) ? `${value} ${row.unit}` : value;
}

export interface ColumnPill {
  label: string;
  status: Status;
  icon: IconName;
  tooltip: string | null;
}

/** The pill under a product: the reference (first column) or how it compares with it. */
export function columnPill(column: EquivalenceComparisonColumn, index: number): ColumnPill {
  if (index === 0) return { label: 'Referencia', status: 'info', icon: 'check', tooltip: null };
  switch (column.kind) {
    case 'EXACT':
      return { label: 'Exacta', status: 'success', icon: 'check', tooltip: null };
    case 'WITH_DIFFERENCES':
      return { label: 'Con diferencias', status: 'warning', icon: 'alert', tooltip: column.differences.map(describeDifference).join(' · ') };
    case 'INCOMPATIBLE':
      return { label: 'Incompatible', status: 'danger', icon: 'alert', tooltip: 'Otro tipo o distintas medidas d × D × B' };
  }
}
