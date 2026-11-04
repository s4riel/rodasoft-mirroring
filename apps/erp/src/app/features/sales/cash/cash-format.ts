import { Decimal } from '@rodasoft/domain';

const dateTime = new Intl.DateTimeFormat('es-BO', {
  timeZone: 'America/La_Paz',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `02/11/2026 18:30` in the business timezone. */
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso)).replace(',', '');

/** `Bs 1.500,00` from the decimal string the API sends. */
export const formatBs = (amount: string): string => Decimal.of(amount).format();

const TIME_ZONE = 'America/La_Paz';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE });
const dateOnly = new Intl.DateTimeFormat('es-BO', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeOnly = new Intl.DateTimeFormat('es-BO', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });

/** `Hoy 09:15`, `Ayer 19:02`, or `02/11/2026 18:30` for older dates, in the business timezone. */
export function formatRelativeDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const key = dayKey.format(date);
  const when =
    key === dayKey.format(now) ? 'Hoy' : key === dayKey.format(new Date(now.getTime() - 86_400_000)) ? 'Ayer' : dateOnly.format(date);
  return `${when} ${timeOnly.format(date)}`;
}

/** `sin diferencia` or `diferencia Bs 5,00` from the decimal string of a closing difference; `null` when unknown. */
export function formatDifference(amount: string | null): string | null {
  if (amount === null) return null;
  const value = Decimal.of(amount);
  return value.isZero() ? 'sin diferencia' : `diferencia ${value.format()}`;
}

/** `Caja 1 · Sucursal`, without repeating the branch when the register name already carries it. */
export function registerPlace(register: { name: string; branch: { name: string } }): string {
  return register.name.includes(register.branch.name) ? register.name : `${register.name} · ${register.branch.name}`;
}
