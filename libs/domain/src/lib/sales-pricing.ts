import { Decimal, MONEY_SCALE } from './money';

/** How the customer record discounts a sale (decision #5): nothing, a percent of the total, or a fixed Bs amount. */
export type CustomerDiscountType = 'NONE' | 'PERCENT' | 'AMOUNT';

/** Rounding of the sale total (decision #54, setting `sales.roundingMode`). */
export type RoundingMode = 'NONE' | 'INTEGER' | 'HALF_BOLIVIANO';
export const ROUNDING_MODES: readonly RoundingMode[] = ['NONE', 'INTEGER', 'HALF_BOLIVIANO'];

/** Rounding step in cents for each mode; `NONE` keeps the cents. */
const ROUNDING_STEP_UNITS: Record<RoundingMode, bigint> = { NONE: 1n, INTEGER: 100n, HALF_BOLIVIANO: 50n };

export interface CustomerDiscountResult {
  discountAmount: Decimal;
  totalAfterDiscount: Decimal;
}

/**
 * Applies the customer's discount to the sale total. `PERCENT` takes a percent of the total (half up to the cent),
 * `AMOUNT` takes a fixed Bs amount off the whole sale. The discount never exceeds the total, so the result is never below 0.
 */
export function applyCustomerDiscount(total: Decimal, type: CustomerDiscountType, value: Decimal | string): CustomerDiscountResult {
  const discountValue = value instanceof Decimal ? value : Decimal.of(value);
  if (discountValue.isNegative()) throw new Error('A customer discount cannot be negative');
  if (total.isNegative()) throw new Error('A sale total cannot be negative');

  const exact = total.round(MONEY_SCALE);
  let discount = Decimal.zero(MONEY_SCALE);
  if (type === 'PERCENT') discount = exact.percent(discountValue, MONEY_SCALE);
  else if (type === 'AMOUNT') discount = discountValue.round(MONEY_SCALE);
  if (discount.cmp(exact) > 0) discount = exact;

  return { discountAmount: discount, totalAfterDiscount: exact.sub(discount) };
}

export interface RoundedTotal {
  total: Decimal;
  /** Positive when the total went up, negative when it went down; stored on the sale as `roundingAmount`. */
  roundingAmount: Decimal;
}

/** Rounds the total to the nearest step of the mode, half up (Bs 10.25 → 10.50 at `HALF_BOLIVIANO`, Bs 10.50 → 11.00 at `INTEGER`). */
export function roundSaleTotal(total: Decimal, mode: RoundingMode): RoundedTotal {
  const exact = total.round(MONEY_SCALE);
  const step = ROUNDING_STEP_UNITS[mode];
  const negative = exact.isNegative();
  const abs = negative ? -exact.units : exact.units;
  const rounded = ((abs + step / 2n) / step) * step;
  const result = Decimal.fromUnits(negative ? -rounded : rounded, MONEY_SCALE);
  return { total: result, roundingAmount: result.sub(exact) };
}
