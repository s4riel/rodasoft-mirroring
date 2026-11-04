import { Decimal, MONEY_SCALE } from './money';
import { stockAvailability } from './product-catalog';
import type { PosCheckoutStatus } from './state-machine';
import { applyCustomerDiscount, roundSaleTotal, type CustomerDiscountType, type RoundingMode } from './sales-pricing';

/**
 * The POS cart (HU-VEN-02). The ERP and the API compute the totals with the same functions, so the total the cashier sees
 * at once is the total the server saves. Money is always `Decimal`.
 */

/** Stock of a POS search result: `ok`, `low` (at or under the warehouse minimum) or `out` (nothing available). */
export type PosStockStatus = 'ok' | 'low' | 'out';

/** Unit price × quantity, to the cent. */
export function lineTotal(unitPrice: Decimal | string, quantity: number): Decimal {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`Invalid quantity: ${quantity}`);
  const price = unitPrice instanceof Decimal ? unitPrice : Decimal.of(unitPrice);
  return price.mul(Decimal.of(BigInt(quantity), 0), MONEY_SCALE);
}

export interface CartTotalsLine {
  unitPrice: Decimal | string;
  quantity: number;
}

/** The customer discount of the sale (decision #5, filled by HU-VEN-05/37); none until then. */
export interface CartDiscount {
  type: CustomerDiscountType;
  value: Decimal | string;
}

export interface CartTotalsOptions {
  discount?: CartDiscount | null;
  roundingMode: RoundingMode;
}

export interface CartTotals {
  subtotal: Decimal;
  discount: Decimal;
  /** After the customer discount and the rounding of `sales.roundingMode`. */
  total: Decimal;
}

/** Subtotal of the lines, the customer discount on it, and the total rounded with the company's rounding mode. */
export function cartTotals(lines: readonly CartTotalsLine[], options: CartTotalsOptions): CartTotals {
  const subtotal = lines.reduce((acc, l) => acc.add(lineTotal(l.unitPrice, l.quantity)), Decimal.zero(MONEY_SCALE));
  const discount = options.discount ?? { type: 'NONE' as const, value: '0' };
  const { discountAmount, totalAfterDiscount } = applyCustomerDiscount(subtotal, discount.type, discount.value);
  return { subtotal, discount: discountAmount, total: roundSaleTotal(totalAfterDiscount, options.roundingMode).total };
}

/** Same thresholds as the inventory lists (`stockAvailability`), named for the POS. */
export function stockStatus(available: number, minStock: number | null): PosStockStatus {
  const availability = stockAvailability(available, minStock);
  return availability === 'available' ? 'ok' : availability;
}

/** The most the cashier may sell of a product: the available stock, or no limit (`null`) with negative stock allowed. */
export function maxSellable(available: number, allowNegativeStock: boolean): number | null {
  return allowNegativeStock ? null : Math.max(0, available);
}

/** Available stock of a stock level: `quantity − reserved`; no level means nothing available. */
export function availableQuantity(level: { quantity: number; reserved: number } | null | undefined): number {
  return level ? level.quantity - level.reserved : 0;
}

/** Monogram of a brand without a logo, as the Figma BrandMark draws it: its first two letters ("SKF" → "SK"). */
export function brandInitials(name: string): string {
  return name.replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2).toUpperCase();
}

// --- API contracts (`/api/v1/sales/pos/*`). Money values are decimal strings. ---

export interface PosCategory {
  id: string;
  name: string;
  /** Icon key of the category (`IconName` in `@rodasoft/ui`). */
  icon: string;
}

export interface PosCategoryListResponse {
  items: PosCategory[];
}

export interface PosProductSearchQuery {
  q: string;
  categoryId?: string;
}

export interface PosProductResult {
  id: string;
  sku: string;
  /** Manufacturer code ("6205-2RS"). */
  code: string;
  name: string;
  brand: { name: string; initials: string };
  salePrice: string;
  /** `quantity − reserved` in the warehouse of the cashier's register. */
  available: number;
  stockStatus: PosStockStatus;
  /** Most the cashier may add (`maxSellable`); `null` without a limit. */
  maxQuantity: number | null;
  warehouse: { id: string; name: string };
}

export interface PosProductSearchResponse {
  items: PosProductResult[];
}

export interface PosCheckoutLine {
  id: string;
  productId: string;
  code: string;
  name: string;
  brandName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  /** Most the cashier may set (`maxSellable`); `null` without a limit. */
  maxQuantity: number | null;
  sortOrder: number;
}

export interface PosCheckoutView {
  id: string;
  status: PosCheckoutStatus;
  lines: PosCheckoutLine[];
  /** What the ERP feeds to `cartTotals()` so its instant total matches the server's. */
  pricing: { roundingMode: RoundingMode; discount: { type: CustomerDiscountType; value: string } | null };
  subtotal: string;
  discount: string;
  total: string;
}

export interface PosCheckoutResponse {
  checkout: PosCheckoutView | null;
}

export interface AddPosCheckoutItemInput {
  productId: string;
  quantity: number;
}

export interface UpdatePosCheckoutItemInput {
  quantity: number;
}
