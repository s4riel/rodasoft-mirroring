import type { CustomerSummary } from './customer';
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

/** The customer discount of the sale (decision #5, HU-VEN-37): the discount of the customer chosen in the cart, if any. */
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
  /** The rounding of `sales.roundingMode` alone, signed (HU-VEN-35): `total` minus subtotal and discount; zero with `NONE`. */
  rounding: Decimal;
  /** After the customer discount and the rounding of `sales.roundingMode`. */
  total: Decimal;
}

/** Subtotal of the lines, the customer discount on it, and the total rounded with the company's rounding mode. */
export function cartTotals(lines: readonly CartTotalsLine[], options: CartTotalsOptions): CartTotals {
  const subtotal = lines.reduce((acc, l) => acc.add(lineTotal(l.unitPrice, l.quantity)), Decimal.zero(MONEY_SCALE));
  const discount = options.discount ?? { type: 'NONE' as const, value: '0' };
  const { discountAmount, totalAfterDiscount } = applyCustomerDiscount(subtotal, discount.type, discount.value);
  const rounded = roundSaleTotal(totalAfterDiscount, options.roundingMode);
  return { subtotal, discount: discountAmount, rounding: rounded.roundingAmount, total: rounded.total };
}

/**
 * Moves the line at `from` to position `to` (HU-VEN-33). Returns a new list; the same list when nothing moves or an index is
 * out of range, so the screen can tell that the drop changed nothing.
 */
export function moveLine<T>(ids: readonly T[], from: number, to: number): T[] {
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < ids.length;
  if (!inRange(from) || !inRange(to) || from === to) return [...ids];
  const next = [...ids];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Whether two id lists hold exactly the same ids, once each (order aside): the reorder must name every line of the cart. */
export function isSameLineSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  if (left.size !== a.length || new Set(b).size !== b.length) return false;
  return b.every((id) => left.has(id));
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
  /** The customer of the sale (HU-VEN-05); `null` invoices a final consumer. */
  customer: CustomerSummary | null;
  lines: PosCheckoutLine[];
  /** What the ERP feeds to `cartTotals()` so its instant total matches the server's. */
  pricing: { roundingMode: RoundingMode; discount: { type: CustomerDiscountType; value: string } | null };
  subtotal: string;
  discount: string;
  /** Signed rounding of the total (HU-VEN-35); the screen shows it as "redondeado" when it is not zero. */
  rounding: string;
  total: string;
}

export interface PosCheckoutResponse {
  checkout: PosCheckoutView | null;
}

/** `PUT /sales/pos/checkout/items/order` (HU-VEN-33): every line of the cart, in the order the cashier wants. */
export interface ReorderPosCheckoutItemsInput {
  itemIds: string[];
}

export interface AddPosCheckoutItemInput {
  productId: string;
  quantity: number;
}

export interface UpdatePosCheckoutItemInput {
  quantity: number;
}
