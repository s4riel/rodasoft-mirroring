import { Decimal, type BulkPriceDirection, type PriceChangeEntry, type PricedFilter, type PriceListRow, type RoundingMode } from '@rodasoft/domain';

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

/** Who a change is attributed to: the user, or "lista importada" / "actualización masiva" for a price that came from there. */
export function changeAuthor(change: Pick<PriceChangeEntry, 'source' | 'by'>): string {
  if (change.source === 'IMPORT') return 'lista importada';
  if (change.source === 'BULK') return 'actualización masiva';
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

// ── Bulk update (HU-VEN-27, VP-11c) ──

export const BULK_PAGE_SIZE = 20;

export const BULK_DIRECTIONS: { value: BulkPriceDirection; label: string }[] = [
  { value: 'INCREASE', label: 'Aumentar %' },
  { value: 'DECREASE', label: 'Rebajar %' },
];

export const BULK_ROUNDINGS: { value: RoundingMode; label: string }[] = [
  { value: 'NONE', label: 'Sin redondeo' },
  { value: 'HALF_BOLIVIANO', label: 'A Bs 0,50' },
  { value: 'INTEGER', label: 'A Bs 1' },
];

/** What the "Nuevo" column says for a product that is not going to change. */
export function bulkSkipLabel(status: 'UNCHANGED' | 'INVALID'): string {
  return status === 'INVALID' ? 'Sin precio' : 'Sin cambio';
}

/** `142 productos coinciden con el filtro`. */
export function matchCountText(count: number): string {
  return count === 1 ? '1 producto coincide con el filtro' : `${count} productos coinciden con el filtro`;
}

/** The label of the apply button. */
export function applyLabel(count: number): string {
  return count === 1 ? 'Aplicar a 1 producto' : `Aplicar a ${count} productos`;
}

/** The sentence under "Vista previa" about the products that will not change. */
export function skippedText(unchanged: number, invalid: number): string {
  const parts: string[] = [];
  if (unchanged > 0) parts.push(`${unchanged} con el mismo precio tras el ajuste`);
  if (invalid > 0) parts.push(`${invalid} sin precio`);
  return parts.length ? `No se modifican: ${parts.join(' y ')}.` : '';
}
