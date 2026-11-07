/**
 * Mixed payment (HU-VEN-09, decision #7): one sale paid with several methods. Today only cash and QR can be combined; the
 * rules below do not depend on the method, so another method joins the mix by adding it to `MIXABLE_METHODS`. Card (HU-VEN-10) is
 * a method on its own for now and is not in the list. Money is always `Decimal`.
 */
import { paymentsCover } from './cash-payment';
import { Decimal, MONEY_SCALE } from './money';
import type { PaymentMethod } from './sale-receipt';

/** The methods that can be part of a mix. Card, transfer and credit arrive with their own stories. */
export const MIXABLE_METHODS: readonly PaymentMethod[] = ['CASH', 'QR'];

export interface MixedLine {
  method: PaymentMethod;
  /** Cash: what the customer handed over (it may exceed what the sale needs). Any other method: the exact charge. */
  amount: Decimal;
}

export type MixedPaymentError =
  | 'MIXED_PAYMENT_DISABLED'
  | 'PAYMENT_METHOD_NOT_AVAILABLE'
  | 'PAYMENT_DUPLICATE_METHOD'
  | 'PAYMENT_INVALID_AMOUNT'
  | 'PAYMENT_NOT_COVERED';

export type MixedPaymentResult =
  | { ok: true; change: Decimal; cashDue: Decimal }
  | { ok: false; error: MixedPaymentError };

const zero = () => Decimal.zero(MONEY_SCALE);

/** How much of the total the lines leave uncovered; never below 0 ("Falta Bs X", and 0 means "Cubierto"). */
export function mixedRemaining(total: Decimal, lines: readonly MixedLine[]): Decimal {
  const paid = lines.reduce((acc, line) => acc.add(line.amount), zero());
  const left = total.sub(paid);
  return left.isNegative() ? zero() : left;
}

/** What the last line should charge to close the sale: the total minus the lines already set. */
export function suggestRemainder(total: Decimal, lines: readonly MixedLine[]): Decimal {
  return mixedRemaining(total, lines);
}

/**
 * Checks a mix against the sale total. Several lines, one per method, each of a mixable method and above zero. The non-cash
 * lines are exact charges and must leave something for the cash (`cashDue`, above 0), which must cover it and may exceed it
 * by the change. `allowMixed` is the company setting `sales.allowMixedPayment`.
 */
export function validateMixedPayments(
  total: Decimal,
  lines: readonly MixedLine[],
  allowMixed: boolean,
): MixedPaymentResult {
  if (!allowMixed) return { ok: false, error: 'MIXED_PAYMENT_DISABLED' };
  const seen = new Set<PaymentMethod>();
  for (const line of lines) {
    if (!MIXABLE_METHODS.includes(line.method)) return { ok: false, error: 'PAYMENT_METHOD_NOT_AVAILABLE' };
    if (seen.has(line.method)) return { ok: false, error: 'PAYMENT_DUPLICATE_METHOD' };
    seen.add(line.method);
    if (line.amount.cmp(zero()) <= 0) return { ok: false, error: 'PAYMENT_INVALID_AMOUNT' };
  }
  // a single line is not a mix; one that pays everything leaves nothing for the second one
  if (lines.length < 2) return { ok: false, error: 'PAYMENT_NOT_COVERED' };

  const nonCashPaid = lines
    .filter((line) => line.method !== 'CASH')
    .reduce((acc, line) => acc.add(line.amount), zero());
  const cashDue = total.sub(nonCashPaid);
  if (cashDue.cmp(zero()) <= 0) return { ok: false, error: 'PAYMENT_NOT_COVERED' };

  const cover = paymentsCover(total, lines);
  if (!cover.ok) return { ok: false, error: 'PAYMENT_NOT_COVERED' };
  return { ok: true, change: cover.change, cashDue };
}

/** Whether `amount` is a valid part for a non-cash line of a mix: above 0 and below the total (cash pays the rest). */
export function isPartialAmount(total: Decimal, amount: Decimal): boolean {
  return amount.cmp(zero()) > 0 && amount.cmp(total) < 0;
}
