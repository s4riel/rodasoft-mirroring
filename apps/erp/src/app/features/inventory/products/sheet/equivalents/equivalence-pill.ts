import type { EquivalenceDifference, ProductEquivalentItem } from '@rodasoft/domain';
import type { DocTableStatus } from '@rodasoft/ui';

/** "Sello: 2RS → DDU"; a missing value reads as an em dash. */
export function describeDifference(d: EquivalenceDifference): string {
  return `${d.label}: ${d.source ?? '—'} → ${d.other ?? '—'}`;
}

/**
 * Pill of an equivalent (Figma IN-02b "Diferencia"). The long form names the first difference and counts the
 * rest, with every difference in the tooltip; the short form (sheet card) only says there are differences.
 */
export function equivalencePill(item: Pick<ProductEquivalentItem, 'kind' | 'differences'>, form: 'long' | 'short' = 'long'): DocTableStatus {
  switch (item.kind) {
    case 'EXACT':
      return { label: 'Exacta', status: 'success', icon: 'check' };
    case 'INCOMPATIBLE':
      return { label: 'Medidas distintas', status: 'danger', icon: 'alert', tooltip: 'Otro tipo o distintas medidas d × D × B' };
    case 'WITH_DIFFERENCES': {
      const [first, ...rest] = item.differences;
      const long = rest.length ? `${first.label} +${rest.length}` : first.label;
      return {
        label: form === 'short' ? 'Con diferencias' : long,
        status: 'warning',
        icon: 'alert',
        tooltip: item.differences.map(describeDifference).join(' · '),
      };
    }
  }
}

export const ORIGINAL_PILL: DocTableStatus = { label: 'Original', status: 'idle', icon: 'alert' };
