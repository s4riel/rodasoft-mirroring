/** Pure calendar logic of the date range picker. Days are `YYYY-MM-DD` strings, so no timezone ever shifts them. */

export interface DateRangeValue {
  from: string | null;
  to: string | null;
}

export type DateRangePreset = 'last-week' | 'last-month' | 'last-year';

export const EMPTY_DATE_RANGE: DateRangeValue = { from: null, to: null };

export const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
] as const;

/** Monday first, as in the Figma calendar. */
export const WEEKDAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

export interface CalendarDay {
  iso: string;
  day: number;
  /** Belongs to the shown month (the others are the grey days of the neighbours). */
  inMonth: boolean;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function toIso(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** `[year, month0, day]` of a valid ISO day, or null. */
export function parseIso(iso: string | null): [number, number, number] | null {
  const m = iso === null ? null : ISO.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  return toIso(y, mo, d) === iso ? [y, mo, d] : null;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parseIso(iso) ?? [1970, 0, 1];
  return toIso(y, m, d + days);
}

/** The local day of `date` as ISO. */
export function localIso(date: Date): string {
  return toIso(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Weeks (Monday first) that cover the month, completed with the days of the neighbour months. */
export function monthGrid(year: number, month: number): CalendarDay[][] {
  const lead = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const weeks = Math.ceil((lead + days) / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => {
      const date = new Date(Date.UTC(year, month, 1 + w * 7 + d - lead));
      return { iso: date.toISOString().slice(0, 10), day: date.getUTCDate(), inMonth: date.getUTCMonth() === month };
    }),
  );
}

/** The calendar week, month or year before the one `today` is in. */
export function presetRange(preset: DateRangePreset, today: string): DateRangeValue {
  const [y, m, d] = parseIso(today) ?? [1970, 0, 1];
  switch (preset) {
    case 'last-week': {
      const monday = d - ((new Date(Date.UTC(y, m, d)).getUTCDay() + 6) % 7);
      return { from: toIso(y, m, monday - 7), to: toIso(y, m, monday - 1) };
    }
    case 'last-month':
      return { from: toIso(y, m - 1, 1), to: toIso(y, m, 0) };
    case 'last-year':
      return { from: toIso(y - 1, 0, 1), to: toIso(y - 1, 11, 31) };
  }
}

/** The range a click on `iso` leads to: the first click starts it, the second ends it, a third starts again. */
export function pickDay(range: DateRangeValue, iso: string): DateRangeValue {
  if (!range.from || range.to) return { from: iso, to: null };
  return iso < range.from ? { from: iso, to: range.from } : { from: range.from, to: iso };
}

/** `15/10/2023` from `2023-10-15`. */
export function formatDay(iso: string): string {
  const p = parseIso(iso);
  return p ? `${String(p[2]).padStart(2, '0')}/${String(p[1] + 1).padStart(2, '0')}/${p[0]}` : '';
}

export function formatRange(range: DateRangeValue): string {
  if (range.from && range.to) return `${formatDay(range.from)} – ${formatDay(range.to)}`;
  if (range.from) return `Desde ${formatDay(range.from)}`;
  if (range.to) return `Hasta ${formatDay(range.to)}`;
  return '';
}
