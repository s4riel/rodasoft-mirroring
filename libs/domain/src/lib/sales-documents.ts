import type { CustomerDiscountType, RoundingMode } from './sales-pricing';
import type { SalesLineSpec } from './sales-line-spec';
import { availableQuantity } from './pos-cart';
import type { QuoteSendLogEntry, QuoteTimelineStep } from './quote-tracking';
import type { DispatchSummary, OrderTimelineStep } from './sales-order-dispatch';
import type { QuoteStatus, SalesOrderStatus } from './state-machine';

/**
 * Quotes (HU-VEN-16) and the orders born from them (HU-VEN-19): contracts of `/api/v1/sales/quotes` and
 * `/api/v1/sales/orders`, and the pure rules both sides share. Money values are decimal strings.
 */

export const SALES_DOCUMENT_PAGE_SIZE_DEFAULT = 20;
export const SALES_DOCUMENT_PAGE_SIZE_MAX = 100;
export const QUOTE_MAX_LINES = 100;
export const QUOTE_MAX_QUANTITY = 100_000;
export const QUOTE_VALIDITY_MAX_DAYS = 365;
export const ORDER_CANCEL_REASON_MAX = 500;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Adds days to a `YYYY-MM-DD` day (calendar arithmetic, no timezone involved). */
export function addDaysToDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The validity a quote gets when none is typed: today (La Paz) plus `sales.quoteValidityDays` (decision #12). */
export function quoteDefaultValidUntil(today: string, validityDays: number): string {
  return addDaysToDay(today, validityDays);
}

/** A validity must be a real day, not before today and not further than a year away. */
export function quoteValidityError(validUntil: string, today: string): 'INVALID_DATE' | 'IN_PAST' | 'TOO_FAR' | null {
  if (!ISO_DAY.test(validUntil) || Number.isNaN(Date.parse(`${validUntil}T00:00:00Z`)) || addDaysToDay(validUntil, 0) !== validUntil) {
    return 'INVALID_DATE';
  }
  if (validUntil < today) return 'IN_PAST';
  if (validUntil > addDaysToDay(today, QUOTE_VALIDITY_MAX_DAYS)) return 'TOO_FAR';
  return null;
}

/** A quote that was sent and whose validity day has passed is expired, whether or not the status was saved yet. */
export function effectiveQuoteStatus(status: QuoteStatus, validUntil: string, today: string): QuoteStatus {
  return status === 'SENT' && validUntil < today ? 'EXPIRED' : status;
}

/** Only a draft or a sent quote that has not expired becomes an order. */
export function isQuoteConvertible(status: QuoteStatus, validUntil: string, today: string): boolean {
  return (status === 'DRAFT' || status === 'SENT') && validUntil >= today;
}

export interface ReservationLine {
  productId: string;
  quantity: number;
}

export interface ReservationShortfall {
  productId: string;
  requested: number;
  available: number;
}

/**
 * The products the warehouse cannot reserve in full. Lines of the same product add up first, and a product without a stock
 * level has nothing available. With negative stock allowed nothing is ever short.
 */
export function reservationShortfalls(
  lines: readonly ReservationLine[],
  levels: ReadonlyMap<string, { quantity: number; reserved: number }>,
  allowNegativeStock = false,
): ReservationShortfall[] {
  if (allowNegativeStock) return [];
  const requested = new Map<string, number>();
  for (const line of lines) requested.set(line.productId, (requested.get(line.productId) ?? 0) + line.quantity);
  const short: ReservationShortfall[] = [];
  for (const [productId, quantity] of requested) {
    const available = Math.max(0, availableQuantity(levels.get(productId)));
    if (quantity > available) short.push({ productId, requested: quantity, available });
  }
  return short;
}

/** What cancelling an order gives back: the reserved units that were not dispatched yet, never below zero. */
export function releasableQuantity(item: { reservedQuantity: number; dispatchedQuantity: number }): number {
  return Math.max(0, item.reservedQuantity - item.dispatchedQuantity);
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// --- quotes ---

export interface QuoteLineInput {
  productId: string;
  quantity: number;
}

export interface CreateQuoteInput {
  customerId: string;
  /** `YYYY-MM-DD`; the company's default validity when omitted. */
  validUntil?: string;
  lines: QuoteLineInput[];
}

export interface QuoteListQuery {
  q?: string;
  status?: QuoteStatus;
  page?: number;
  pageSize?: number;
}

export interface QuoteListItem {
  id: string;
  number: string;
  customerName: string;
  createdAt: string;
  validUntil: string;
  /** Units on the quote (the sum of its line quantities). */
  itemsCount: number;
  total: string;
  /** The status as the list shows it: a sent quote past its validity reads `EXPIRED`. */
  status: QuoteStatus;
  /** Number of the order it became, once converted. */
  orderNumber: string | null;
}

export type QuoteListResponse = Paged<QuoteListItem>;

export interface QuoteLineDetail {
  id: string;
  productId: string;
  sku: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  /** Available stock (`quantity − reserved`) in the main warehouse of the user's branch; `null` when there is none. */
  available: number | null;
  /** Measures and type of the product (HU-VEN-36). */
  spec: SalesLineSpec;
}

export interface QuoteDetail {
  id: string;
  number: string;
  status: QuoteStatus;
  customer: { id: string; name: string; documentNumber: string | null };
  createdAt: string;
  createdByName: string | null;
  validUntil: string;
  subtotal: string;
  discountType: CustomerDiscountType;
  discountValue: string;
  discountAmount: string;
  roundingAmount: string;
  total: string;
  lines: QuoteLineDetail[];
  /** The order this quote became, if it did. */
  order: { id: string; number: string } | null;
  /** Whether "Convertir en pedido" is offered. */
  convertible: boolean;
  /** Where the quote stands (HU-VEN-17/18). */
  timeline: QuoteTimelineStep[];
  sendLog: QuoteSendLogEntry[];
  /** Customer contact, to prefill the sending. */
  customerEmail: string | null;
  customerPhone: string | null;
  canSend: boolean;
  canRenew: boolean;
  canReject: boolean;
  /** The company name for the document header. */
  company: string;
}

/** Product search of the quote editor: the stock is the available stock of the chosen warehouse. */
export interface QuoteProductResult {
  id: string;
  sku: string;
  code: string;
  name: string;
  brandName: string;
  salePrice: string;
  available: number;
  spec: SalesLineSpec;
}

export interface QuoteWarehouseOption {
  id: string;
  name: string;
  isMain: boolean;
}

/** What the editor needs to start: the default validity and the warehouses of the user's branch. */
export interface QuoteEditorContext {
  defaultValidUntil: string;
  validityDays: number;
  /** `sales.roundingMode`, so the editor previews the same total the server saves. */
  roundingMode: RoundingMode;
  warehouses: QuoteWarehouseOption[];
}

// --- orders ---

export interface ConvertQuoteInput {
  warehouseId: string;
}

export interface SalesOrderListQuery {
  q?: string;
  status?: SalesOrderStatus;
  page?: number;
  pageSize?: number;
}

export interface SalesOrderListItem {
  id: string;
  number: string;
  customerName: string;
  quoteNumber: string | null;
  warehouseName: string;
  createdAt: string;
  total: string;
  status: SalesOrderStatus;
}

export type SalesOrderListResponse = Paged<SalesOrderListItem>;

export interface SalesOrderLineDetail {
  id: string;
  productId: string;
  sku: string;
  code: string;
  name: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  reservedQuantity: number;
  dispatchedQuantity: number;
  /** Units covered by a live invoice (not cancelled or rejected); equals `dispatchedQuantity` until an invoice falls (HU-VEN-20). */
  invoicedQuantity: number;
  /** Units ordered that have not left yet: the balance that stays pending on the order. */
  pendingQuantity: number;
  spec: SalesLineSpec;
}

export interface SalesOrderDetail {
  id: string;
  number: string;
  status: SalesOrderStatus;
  customer: { id: string; name: string; documentNumber: string | null };
  quote: { id: string; number: string } | null;
  /** The company name for the header of the printed dispatch order. */
  company: string;
  branchName: string;
  warehouseName: string;
  createdAt: string;
  createdByName: string | null;
  cancelledAt: string | null;
  subtotal: string;
  discountAmount: string;
  roundingAmount: string;
  total: string;
  lines: SalesOrderLineDetail[];
  cancellable: boolean;
  /** HU-VEN-20: the dispatches made so far, oldest first, and the amount they invoiced. */
  dispatches: DispatchSummary[];
  invoicedTotal: string;
  timeline: OrderTimelineStep[];
  /** True while the order is `OPEN` or `PARTIALLY_DISPATCHED` and has reserved units left to dispatch. */
  dispatchable: boolean;
  /** Setting `sales.allowPartialDispatch` (decision #14): off, a dispatch must give everything that is pending. */
  partialDispatchAllowed: boolean;
  /** Setting `sales.roundingMode`: the dispatch dialog previews the total of a part with it, like the server does. */
  roundingMode: RoundingMode;
}

export interface CancelSalesOrderInput {
  reason: string;
}
