import { Decimal, type PriceChangeEntry, type PricedFilter, type PriceListRow } from '@rodasoft/domain';

const TIME_ZONE = 'America/La_Paz';
const dateOnly = new Intl.DateTimeFormat('es-BO', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });

export const PRICE_PAGE_SIZE = 20;

/** `+4,1 %` / `−4,0 %` from the signed percent the API sends; empty when there is none (the old price was zero). */
export function formatPercent(percent: string | null | undefined): string {
  if (percent === null || percent === undefined) return '';
  const negative = percent.startsWith('-');
  const digits = percent.replace('-', '').replace('.', ',');
  return `${negative ? '−' : '+'}${digits} %`;
}

/** `45,2 %` for a margin; `—` when it cannot be computed. */
export function formatMargin(percent: string | null | undefined): string {
  if (percent === null || percent === undefined) return '—';
  return `${percent.replace('-', '−').replace('.', ',')} %`;
}

/** `+ Bs 10,00` / `− Bs 10,00` for the change in Bs. */
export function formatSignedAmount(amount: string): string {
  const value = Decimal.of(amount);
  if (value.isZero()) return value.format();
  return value.isNegative() ? `− ${value.neg().format()}` : `+ ${value.format()}`;
}

/** Who a change is attributed to: the user, or "lista importada" for a price that came from the Excel import. */
export function changeAuthor(change: Pick<PriceChangeEntry, 'source' | 'by'>): string {
  if (change.source === 'IMPORT') return 'lista importada';
  return change.by?.name || 'usuario eliminado';
}

/** "Última actualización": `14/10/2026 · Ana Gerente · +4,1 %`, or `—` for a price that never changed. */
export function lastChangeText(change: PriceChangeEntry | null): string {
  if (!change) return '—';
  const parts = [dateOnly.format(new Date(change.at)), changeAuthor(change)];
  const percent = formatPercent(change.percent);
  if (percent) parts.push(percent);
  return parts.join(' · ');
}

/** `SKF · Suecia`, or only the brand when the product has no country. */
export function brandLine(row: Pick<PriceListRow, 'brand' | 'country'>): string {
  return row.country ? `${row.brand.name} · ${row.country.name}` : row.brand.name;
}

/** The pill of the "Estado" column. */
export function priceStatusPill(row: Pick<PriceListRow, 'hasPrice' | 'status'>): { label: string; status: 'success' | 'warning' | 'idle' } {
  if (!row.hasPrice) return { label: 'Sin precio', status: 'warning' };
  return row.status === 'INACTIVE' ? { label: 'Inactivo', status: 'idle' } : { label: 'Con precio', status: 'success' };
}

export const PRICED_OPTIONS: { value: PricedFilter; label: string }[] = [
  { value: 'with', label: 'Con precio' },
  { value: 'without', label: 'Sin precio' },
];

export const parsePriced = (raw: string | null): PricedFilter | null => (raw === 'with' || raw === 'without' ? raw : null);
