/**
 * Paying a sale in cash (HU-VEN-07): what the cashier typed, the change to give back, the amounts the screen suggests and
 * whether the payments cover the total. Money is always `Decimal`; the ERP and the API use the same functions.
 */
import { validateOpeningFloat } from './cash-shift';
import { Decimal, MONEY_SCALE } from './money';
import type { PaymentMethod } from './sale-receipt';

export type CashTenderedError = 'INVALID_AMOUNT' | 'INSUFFICIENT_CASH' | 'AMOUNT_TOO_LARGE';

export type CashTenderedResult = { ok: true; received: Decimal; change: Decimal } | { ok: false; error: CashTenderedError };

/** The change to give back: received minus total, never below 0. The total is the rounded one (decision #54). */
export function cashChange(total: Decimal, received: Decimal): Decimal {
  const change = received.sub(total).round(MONEY_SCALE);
  return change.isNegative() ? Decimal.zero(MONEY_SCALE) : change;
}

/**
 * Checks the amount the cashier received. Accepts the Bolivian format (`1.200,00`) and the API format (`1200.00`), with at
 * most 2 decimals. Less than the total is refused (`INSUFFICIENT_CASH`).
 */
export function validateCashTendered(total: Decimal, text: string | null | undefined): CashTenderedResult {
  const parsed = validateOpeningFloat(text);
  if (!parsed.ok) return { ok: false, error: parsed.error === 'TOO_LARGE' ? 'AMOUNT_TOO_LARGE' : 'INVALID_AMOUNT' };
  const received = parsed.value;
  if (received.cmp(total) < 0) return { ok: false, error: 'INSUFFICIENT_CASH' };
  return { ok: true, received, change: cashChange(total, received) };
}

/** Round amounts the cashier is likely to receive: the next multiple of each step, always above the total. */
const SUGGESTION_STEPS = [50n, 100n, 500n] as const;

/**
 * The quick amounts of the payment screen ("Montos rápidos"): the next multiples of Bs 50, 100 and 500 above the total, in
 * ascending order and without repeats. "Exacto" is not in the list: the screen draws it itself.
 */
export function suggestCashAmounts(total: Decimal): Decimal[] {
  const exact = total.round(MONEY_SCALE);
  const found = new Set<bigint>();
  for (const step of SUGGESTION_STEPS) {
    const stepUnits = step * 100n;
    found.add((exact.units / stepUnits + 1n) * stepUnits);
  }
  return [...found].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map((units) => Decimal.fromUnits(units, MONEY_SCALE));
}

export interface PaymentToCover {
  method: PaymentMethod;
  /** What the customer handed over. For cash this may exceed what the sale needs; for the other methods it is the charge. */
  amount: Decimal;
}

export type PaymentsCoverResult =
  | { ok: true; change: Decimal }
  | { ok: false; error: 'NON_CASH_EXCEEDS_TOTAL' | 'INSUFFICIENT_PAYMENT'; shortfall: Decimal };

/**
 * Whether the payments cover the sale total (decision #7): the non-cash payments are exact charges and cannot exceed the
 * total; cash covers what is left and may exceed it by the change. Mixed payment (HU-VEN-09) reuses it.
 */
export function paymentsCover(total: Decimal, payments: readonly PaymentToCover[]): PaymentsCoverResult {
  const sumOf = (list: readonly PaymentToCover[]) => list.reduce((acc, p) => acc.add(p.amount), Decimal.zero(MONEY_SCALE));
  const nonCash = sumOf(payments.filter((p) => p.method !== 'CASH'));
  const cash = sumOf(payments.filter((p) => p.method === 'CASH'));
  const remaining = total.sub(nonCash);
  if (remaining.isNegative()) return { ok: false, error: 'NON_CASH_EXCEEDS_TOTAL', shortfall: remaining.neg() };
  if (cash.cmp(remaining) < 0) return { ok: false, error: 'INSUFFICIENT_PAYMENT', shortfall: remaining.sub(cash) };
  return { ok: true, change: cash.sub(remaining) };
}

// --- API contracts (`/api/v1/sales/pos/checkout/*`). Money values are decimal strings. ---

/** `POST /sales/pos/checkout/pay`: the cart is now `PAYING` and its total is frozen for the payment screen. */
export interface PosPayResponse {
  total: string;
  suggestedAmounts: string[];
}

/** One line whose price changed since the cashier added it; the cart was updated to the new price. */
export interface PosPriceChange {
  lineId: string;
  code: string;
  oldPrice: string;
  newPrice: string;
}

export interface PosCashPaymentInput {
  method: 'CASH';
  /** The amount the customer handed over, as typed ("1.200,00") or as a decimal string ("1200.00"). */
  received: string;
}

/** Only cash for now; QR, card, transfer, credit and mixed arrive with HU-VEN-08, 09, 10 and 34. */
export type PosPaymentInput = PosCashPaymentInput;

export interface CompletePosCheckoutInput {
  payments: PosPaymentInput[];
  /** The total the cashier saw. The server recomputes it and refuses if it differs (`CHECKOUT_TOTAL_CHANGED`). */
  expectedTotal: string;
  /** Same key, same sale: a retry after a lost answer returns the stored sale instead of selling twice. */
  idempotencyKey: string;
}

export interface CompletedSale {
  saleId: string;
  /** `V-000125`. */
  number: string;
  createdAt: string;
  total: string;
  received: string;
  change: string;
  customerName: string;
  /** Status of the invoice record; `PENDING` until the SIAT epic issues it. */
  invoiceStatus: 'PENDING';
  customerEmail: string | null;
}

export interface CompletePosCheckoutResponse {
  sale: CompletedSale;
}
