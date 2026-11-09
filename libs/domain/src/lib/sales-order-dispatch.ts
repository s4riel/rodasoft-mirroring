import { Decimal, MONEY_SCALE } from './money';
import { lineTotal } from './pos-cart';
import { roundSaleTotal, type RoundingMode } from './sales-pricing';
import type { SalesOrderStatus } from './state-machine';

/**
 * Dispatching an order in parts (HU-VEN-20). Every dispatch turns reserved units into a sale and an invoice for exactly those
 * units. Contracts of `POST /sales/orders/:id/dispatches` and the pure rules both sides share. Money values are decimal strings.
 */

export interface DispatchLineInput {
  orderItemId: string;
  quantity: number;
}

export interface CreateDispatchInput {
  items: DispatchLineInput[];
}

/** One dispatch of an order as the detail lists it. */
export interface DispatchSummary {
  id: string;
  number: string;
  createdAt: string;
  createdByName: string | null;
  pieces: number;
  total: string;
  saleId: string | null;
  saleNumber: string | null;
}

/** What the dispatch rules read of an order line. */
export interface DispatchableItem {
  orderItemId: string;
  quantity: number;
  reservedQuantity: number;
  dispatchedQuantity: number;
}

/** Units of a line that are reserved and not dispatched yet: what can leave now. */
export function dispatchableQuantity(item: { reservedQuantity: number; dispatchedQuantity: number }): number {
  return Math.max(0, item.reservedQuantity - item.dispatchedQuantity);
}

/**
 * Whether an invoice counts as invoiced: it is waiting for the SIAT, in process, issued or observed. A cancelled or rejected
 * one does not, so the pieces it covered are dispatched but no longer invoiced.
 */
export function isInvoicedStatus(status: string | null | undefined): boolean {
  return status !== undefined && status !== null && status !== 'CANCELLED' && status !== 'REJECTED' && status !== 'CANCELLATION_PENDING';
}

/** Units of a line that were ordered and have not left yet (the balance that stays pending on the order). */
export function pendingQuantity(item: { quantity: number; dispatchedQuantity: number }): number {
  return Math.max(0, item.quantity - item.dispatchedQuantity);
}

export type DispatchIssueCode =
  | 'DISPATCH_EMPTY'
  | 'ORDER_ITEM_NOT_FOUND'
  | 'INVALID_QUANTITY'
  | 'DISPATCH_EXCEEDS_RESERVED'
  | 'PARTIAL_DISPATCH_NOT_ALLOWED';

export interface DispatchIssue {
  code: DispatchIssueCode;
  orderItemId?: string;
  requested?: number;
  dispatchable?: number;
}

/** A request cleaned of repeated lines and zeros: the units each order line gives now. */
export function normalizeDispatchRequest(request: readonly DispatchLineInput[]): DispatchLineInput[] {
  const merged = new Map<string, number>();
  for (const line of request) merged.set(line.orderItemId, (merged.get(line.orderItemId) ?? 0) + line.quantity);
  return [...merged].map(([orderItemId, quantity]) => ({ orderItemId, quantity })).filter((line) => line.quantity !== 0);
}

/**
 * Checks a dispatch against the order lines. With `allowPartial` off (setting `sales.allowPartialDispatch`, decision #14) it
 * must give everything that is still pending. Returns every problem, none when the dispatch is valid.
 */
export function validateDispatch(
  items: readonly DispatchableItem[],
  request: readonly DispatchLineInput[],
  allowPartial: boolean,
): DispatchIssue[] {
  const lines = normalizeDispatchRequest(request);
  if (lines.length === 0) return [{ code: 'DISPATCH_EMPTY' }];
  const byId = new Map(items.map((item) => [item.orderItemId, item]));
  const issues: DispatchIssue[] = [];
  for (const line of lines) {
    const item = byId.get(line.orderItemId);
    if (!item) {
      issues.push({ code: 'ORDER_ITEM_NOT_FOUND', orderItemId: line.orderItemId });
    } else if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      issues.push({ code: 'INVALID_QUANTITY', orderItemId: line.orderItemId, requested: line.quantity });
    } else if (line.quantity > dispatchableQuantity(item)) {
      issues.push({ code: 'DISPATCH_EXCEEDS_RESERVED', orderItemId: line.orderItemId, requested: line.quantity, dispatchable: dispatchableQuantity(item) });
    }
  }
  if (issues.length > 0) return issues;
  if (!allowPartial) {
    const given = new Map(lines.map((line) => [line.orderItemId, line.quantity]));
    const leavesBalance = items.some((item) => (given.get(item.orderItemId) ?? 0) < pendingQuantity(item));
    if (leavesBalance) return [{ code: 'PARTIAL_DISPATCH_NOT_ALLOWED' }];
  }
  return [];
}

/** Whether giving `request` leaves nothing of the order pending: the event of the order is `dispatchAll`. */
export function completesOrder(items: readonly DispatchableItem[], request: readonly DispatchLineInput[]): boolean {
  const given = new Map(normalizeDispatchRequest(request).map((line) => [line.orderItemId, line.quantity]));
  return items.every((item) => item.dispatchedQuantity + (given.get(item.orderItemId) ?? 0) >= item.quantity);
}

/** The event `salesOrderMachine` takes after a dispatch. */
export function nextOrderEvent(items: readonly DispatchableItem[], request: readonly DispatchLineInput[]): 'dispatchAll' | 'dispatchPartial' {
  return completesOrder(items, request) ? 'dispatchAll' : 'dispatchPartial';
}

export interface DispatchAmounts {
  subtotal: Decimal;
  discountAmount: Decimal;
  roundingAmount: Decimal;
  total: Decimal;
}

export interface DispatchTotalsInput {
  /** The amounts of the order, as they were fixed by its quote. */
  order: DispatchAmounts;
  /** The amounts of the sales that earlier dispatches of the order made. */
  previous: readonly DispatchAmounts[];
  lines: readonly { unitPrice: Decimal | string; quantity: number }[];
  /** True when this dispatch leaves nothing pending. */
  completesOrder: boolean;
  roundingMode: RoundingMode;
}

const zero = () => Decimal.zero(MONEY_SCALE);

/** `amount × part ÷ whole` to the cent (0 when there is no whole): how a discount or a refund is shared out among lines. */
export function proRata(amount: Decimal, part: Decimal, whole: Decimal): Decimal {
  return whole.isZero() ? zero() : amount.mul(part, MONEY_SCALE + 2).div(whole, MONEY_SCALE);
}

/**
 * The amounts of the sale a dispatch makes. The customer discount of the order is shared out in proportion to what the
 * dispatch carries, and the total is rounded with the company's rounding mode as at the POS. The dispatch that completes the
 * order takes what is left of every amount, so the sales of all the dispatches add up to the order total to the cent.
 */
export function dispatchTotals(input: DispatchTotalsInput): DispatchAmounts {
  const { order, previous } = input;
  if (input.completesOrder) {
    const spent = previous.reduce(
      (acc, p) => ({
        subtotal: acc.subtotal.add(p.subtotal),
        discountAmount: acc.discountAmount.add(p.discountAmount),
        roundingAmount: acc.roundingAmount.add(p.roundingAmount),
        total: acc.total.add(p.total),
      }),
      { subtotal: zero(), discountAmount: zero(), roundingAmount: zero(), total: zero() },
    );
    return {
      subtotal: order.subtotal.sub(spent.subtotal),
      discountAmount: order.discountAmount.sub(spent.discountAmount),
      roundingAmount: order.roundingAmount.sub(spent.roundingAmount),
      total: order.total.sub(spent.total),
    };
  }
  const subtotal = input.lines.reduce((acc, line) => acc.add(lineTotal(line.unitPrice, line.quantity)), zero());
  const discountAmount = proRata(order.discountAmount, subtotal, order.subtotal);
  const rounded = roundSaleTotal(subtotal.sub(discountAmount), input.roundingMode);
  return { subtotal, discountAmount, roundingAmount: rounded.roundingAmount, total: rounded.total };
}

export type OrderTimelineState = 'done' | 'current' | 'pending';

export type OrderTimelineKey = 'created' | 'reserved' | 'dispatch' | 'invoiced' | 'completed';

export interface OrderTimelineStep {
  key: OrderTimelineKey;
  state: OrderTimelineState;
  /** The date of the step when it happened (ISO), or null. */
  at: string | null;
}

/**
 * The steps of VP-19: created, reserved, dispatched in parts, invoiced, completed. The order is born reserved (all or
 * nothing), so the first two are always done; the third is the current one while the order is `OPEN` or
 * `PARTIALLY_DISPATCHED`; the last two are done when it is `DISPATCHED` (every dispatch is invoiced). A cancelled order has no
 * steps past the reservation.
 */
export function orderTimeline(order: { status: SalesOrderStatus; createdAt: string; dispatchedAt: string | null; completedAt: string | null }): OrderTimelineStep[] {
  const dispatched = order.status === 'DISPATCHED';
  const started = order.status === 'PARTIALLY_DISPATCHED' || dispatched;
  return [
    { key: 'created', state: 'done', at: order.createdAt },
    { key: 'reserved', state: 'done', at: order.createdAt },
    { key: 'dispatch', state: dispatched ? 'done' : order.status === 'CANCELLED' ? 'pending' : 'current', at: started ? order.dispatchedAt : null },
    { key: 'invoiced', state: dispatched ? 'done' : 'pending', at: dispatched ? order.completedAt : null },
    { key: 'completed', state: dispatched ? 'done' : 'pending', at: dispatched ? order.completedAt : null },
  ];
}
