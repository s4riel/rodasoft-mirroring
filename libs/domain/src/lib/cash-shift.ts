/** Opening the cash register (HU-VEN-01): the opening float rules and the contracts of the cash shift API. */
import { Decimal, MONEY_SCALE } from './money';

/** `refType` of cash shifts in the outbox payloads (the audit log names the entity by its model, `CashShift`). */
export const CASH_SHIFT_REF_TYPE = 'CASH_SHIFT';

/** `cash_shifts.opening_float` is `Decimal(14,2)`: at most 12 integer digits. */
export const OPENING_FLOAT_MAX = Decimal.of('9999999999.99');

export type OpeningFloatError = 'REQUIRED' | 'INVALID_FORMAT' | 'NEGATIVE' | 'TOO_MANY_DECIMALS' | 'TOO_LARGE';

export type OpeningFloatResult = { ok: true; value: Decimal } | { ok: false; error: OpeningFloatError };

/** `1.500,50`: dots group thousands and the comma is the decimal mark. */
const GROUPED_BOLIVIAN = /^\d{1,3}(\.\d{3})+,\d+$/;
const PLAIN_DECIMAL = /^\d+([.,]\d+)?$/;

/**
 * Parses what the cashier types as the starting float. Accepts the Bolivian format (`500,00`, `1.500,50`) and the
 * plain API format (`500.00`); the amount must be ≥ 0 and have at most 2 decimals. The result is a `Decimal`, never a
 * `number`.
 */
export function validateOpeningFloat(text: string | null | undefined): OpeningFloatResult {
  const raw = (text ?? '').trim();
  if (raw === '') return { ok: false, error: 'REQUIRED' };
  if (raw.startsWith('-')) return { ok: false, error: 'NEGATIVE' };

  const plain = GROUPED_BOLIVIAN.test(raw) ? raw.replace(/\./g, '') : raw;
  if (!PLAIN_DECIMAL.test(plain)) return { ok: false, error: 'INVALID_FORMAT' };
  const fraction = plain.split(/[.,]/)[1] ?? '';
  if (fraction.length > MONEY_SCALE) return { ok: false, error: 'TOO_MANY_DECIMALS' };

  const value = Decimal.of(plain);
  if (value.cmp(OPENING_FLOAT_MAX) > 0) return { ok: false, error: 'TOO_LARGE' };
  return { ok: true, value };
}

/** Whether the new float equals the cash the previous shift left in the register; `true` when there is no previous close. */
export function floatMatchesLastClose(openingFloat: Decimal, lastClosingFloat: Decimal | null): boolean {
  return lastClosingFloat === null || openingFloat.eq(lastClosingFloat);
}

export interface CashRegisterLastClose {
  shiftId: string;
  closedAt: string;
  closedByName: string | null;
  /** Counted minus expected, as a decimal string. */
  differenceAmount: string | null;
  /** Cash left in the register at close, as a decimal string. */
  closingFloat: string | null;
}

export interface CashRegisterOpenShift {
  id: string;
  openedAt: string;
  openedByName: string | null;
}

/** One register as the opening form (VP-05) lists it. */
export interface CashRegisterOption {
  id: string;
  name: string;
  branch: { id: string; name: string };
  warehouse: { id: string; name: string };
  /** Set while the register already has an `OPEN` shift (it cannot be opened again). */
  openShift: CashRegisterOpenShift | null;
  lastClose: CashRegisterLastClose | null;
}

export interface CashRegisterListResponse {
  items: CashRegisterOption[];
}

/** The caller's open shift with where it runs (POS header, Caja tab). */
export interface CurrentCashShift {
  id: string;
  /** `T-0142` */
  number: string;
  openingFloat: string;
  openedAt: string;
  openedBy: { id: string; name: string };
  register: { id: string; name: string };
  branch: { id: string; name: string };
  warehouse: { id: string; name: string };
}

export interface CurrentCashShiftResponse {
  shift: CurrentCashShift | null;
}

export interface OpenCashShiftInput {
  registerId: string;
  /** Decimal string with a dot (`"500.00"`), never a JSON number. */
  openingFloat: string;
}

export interface OpenCashShiftResponse {
  shift: CurrentCashShift;
  /** `true` when the float differs from the cash the previous shift left; Accounting was notified. */
  floatMismatch: boolean;
}
