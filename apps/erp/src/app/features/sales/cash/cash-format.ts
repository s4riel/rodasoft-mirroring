import {
  Decimal,
  type CashMovementStatus,
  type CashMovementType,
  type CashShiftDisplayStatus,
  type CashShiftTimelineEntry,
  type ManualCashMovementType,
  type PaymentMethod,
} from '@rodasoft/domain';

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
const dateOnly = new Intl.DateTimeFormat('es-BO', {
  timeZone: TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const dayMonth = new Intl.DateTimeFormat('es-BO', { timeZone: TIME_ZONE, day: '2-digit', month: '2-digit' });
const timeOnly = new Intl.DateTimeFormat('es-BO', {
  timeZone: TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `Hoy 09:15`, `Ayer 19:02`, or `02/11/2026 18:30` for older dates, in the business timezone. */
export function formatRelativeDateTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const key = dayKey.format(date);
  const when =
    key === dayKey.format(now)
      ? 'Hoy'
      : key === dayKey.format(new Date(now.getTime() - 86_400_000))
        ? 'Ayer'
        : dateOnly.format(date);
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
  return register.name.includes(register.branch.name)
    ? register.name
    : `${register.name} · ${register.branch.name}`;
}

// ── Cash movements and closing (HU-VEN-22, HU-VEN-23) ──

/** Spanish label of each concept code, per type. */
export const CONCEPT_LABELS: Record<ManualCashMovementType, Record<string, string>> = {
  INCOME: { BALANCE_COLLECTION: 'Cobro de saldo', FLOAT_TOP_UP: 'Aporte al fondo de caja', OTHER: 'Otro' },
  EXPENSE: {
    FREIGHT: 'Pago de flete',
    PACKAGING: 'Material de embalaje',
    SERVICES: 'Servicios',
    TRAVEL: 'Pasajes y viáticos',
    SUPPLIES: 'Insumos y útiles',
    OTHER: 'Otro',
  },
};

/** `Pago de flete`, or the movement type when the movement has no concept (a refund). */
export function movementConceptLabel(row: {
  type: CashMovementType;
  concept: string | null;
  detail: string | null;
}): string {
  if (row.type === 'REFUND') return row.detail ?? 'Devolución';
  if (row.type !== 'INCOME' && row.type !== 'EXPENSE') return row.detail ?? '';
  const label = row.concept ? (CONCEPT_LABELS[row.type][row.concept] ?? row.concept) : '';
  return row.concept === 'OTHER' && row.detail ? `${label}: ${row.detail}` : label;
}

export const MOVEMENT_TYPE_LABELS: Record<CashMovementType, string> = {
  INCOME: 'Ingreso',
  EXPENSE: 'Egreso',
  SALE_PAYMENT: 'Venta',
  REFUND: 'Devolución',
};

/** The pill of a movement that is not simply posted; `null` for a posted one. */
export function movementStatusPill(
  status: CashMovementStatus,
): { label: string; status: 'warning' | 'danger' | 'idle' } | null {
  switch (status) {
    case 'PENDING':
      return { label: 'Por aprobar', status: 'warning' };
    case 'REJECTED':
      return { label: 'Rechazada', status: 'danger' };
    case 'WITHDRAWN':
      return { label: 'Retirada', status: 'idle' };
    default:
      return null;
  }
}

/** `+ Bs 50,00` for money in and `− Bs 30,00` for money out, as the movements table shows it. */
export function signedAmount(type: CashMovementType, amount: string): string {
  const out = type === 'EXPENSE' || type === 'REFUND';
  return `${out ? '−' : '+'} ${Decimal.of(amount).format()}`;
}

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  QR: 'QR',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  CREDIT: 'Crédito',
};

/** `08:02` in the business timezone. */
export const formatTime = (iso: string): string => timeOnly.format(new Date(iso));

/** `Abierta hoy a las 08:02` / `Abierta ayer a las 19:02` / `Abierta el 02/11/2026 a las 18:30`. */
export function formatOpenedAt(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const key = dayKey.format(date);
  if (key === dayKey.format(now)) return `hoy a las ${timeOnly.format(date)}`;
  if (key === dayKey.format(new Date(now.getTime() - 86_400_000)))
    return `ayer a las ${timeOnly.format(date)}`;
  return `el ${dateOnly.format(date)} a las ${timeOnly.format(date)}`;
}

// ── Review of a closing and shift history (HU-VEN-24, HU-VEN-25) ──

/** The pills of the shift history (Figma VP-23). */
export const SHIFT_STATUS_PILLS: Record<
  CashShiftDisplayStatus,
  { label: string; status: 'success' | 'warning' | 'danger' | 'info' | 'idle' }
> = {
  OPEN: { label: 'Abierto', status: 'info' },
  PENDING_REVIEW: { label: 'Por revisar', status: 'warning' },
  CLOSED_CLEAN: { label: 'Cerrado', status: 'success' },
  DIFFERENCE_APPROVED: { label: 'Diferencia aprobada', status: 'info' },
  OBSERVED: { label: 'Observado', status: 'danger' },
};

/** The status filter of the history, in the order a reviewer needs it. */
export const SHIFT_STATUS_OPTIONS: { value: CashShiftDisplayStatus; label: string }[] = (
  ['PENDING_REVIEW', 'OBSERVED', 'DIFFERENCE_APPROVED', 'CLOSED_CLEAN', 'OPEN'] as const
).map((value) => ({ value, label: SHIFT_STATUS_PILLS[value].label }));

export const parseShiftStatus = (raw: string | null): CashShiftDisplayStatus | null =>
  raw !== null && Object.hasOwn(SHIFT_STATUS_PILLS, raw) ? (raw as CashShiftDisplayStatus) : null;

/** A difference with its sign: `− Bs 20,00` is a shortage, `+ Bs 5,00` a surplus, `Bs 0,00` none; `—` while unknown. */
export function formatSignedBs(amount: string | null): string {
  if (amount === null) return '—';
  const value = Decimal.of(amount);
  if (value.isZero()) return value.format();
  return value.isNegative() ? `− ${value.neg().format()}` : `+ ${value.format()}`;
}

/** `14/10/2026 08:02 a 19:05`; the closing day is written too when it is another day, and an open shift says so. */
export function formatSchedule(openedAt: string, closedAt: string | null): string {
  const opened = new Date(openedAt);
  const start = `${dateOnly.format(opened)} ${timeOnly.format(opened)}`;
  if (closedAt === null) return `${start} · abierto`;
  const closed = new Date(closedAt);
  const sameDay = dayKey.format(opened) === dayKey.format(closed);
  return `${start} a ${sameDay ? '' : `${dateOnly.format(closed)} `}${timeOnly.format(closed)}`;
}

/** `14/10 08:02–19:05`, the compact form of the history table; the closing day is written too when it is another day. */
export function formatScheduleShort(openedAt: string, closedAt: string | null): string {
  const opened = new Date(openedAt);
  const start = `${dayMonth.format(opened)} ${timeOnly.format(opened)}`;
  if (closedAt === null) return `${start} · abierto`;
  const closed = new Date(closedAt);
  const sameDay = dayKey.format(opened) === dayKey.format(closed);
  return `${start}–${sameDay ? '' : `${dayMonth.format(closed)} `}${timeOnly.format(closed)}`;
}

/** One line of the "Auditoría" card. */
export function timelineText(entry: Pick<CashShiftTimelineEntry, 'action' | 'by' | 'automatic'>): string {
  const who = entry.by?.name || 'un usuario eliminado';
  switch (entry.action) {
    case 'OPEN':
      return `Apertura de caja por ${who}`;
    case 'CLOSE':
      return `Cierre de caja por ${who}`;
    case 'APPROVE':
      return entry.automatic
        ? 'Cierre aprobado por el sistema: sin diferencias'
        : `Cierre aprobado por ${who}`;
    default:
      return `Recuento pedido por ${who}`;
  }
}
