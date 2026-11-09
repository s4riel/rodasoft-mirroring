/**
 * Returns of a sale (HU-VEN-21): the contracts of `/sales/returns` and the pure rules both sides share. Money values are decimal
 * strings. The ERP turns every code into Spanish.
 */
import { Decimal, MONEY_SCALE } from './money';
import { isWithinCancellationWindow } from './sale-cancellation';
import { lineTotal } from './pos-cart';
import { proRata } from './sales-order-dispatch';
import type { InvoiceStatus, SaleReturnStatus, SaleStatus } from './state-machine';

/** The reasons the cashier chooses from (Figma VP-10). */
export const RETURN_REASONS = ['FACTORY_DEFECT', 'WRONG_PRODUCT', 'CUSTOMER_CHANGED_MIND', 'OTHER'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RETURN_COMMENT_MAX = 500;
export const RETURN_REFERENCE_MAX = 100;

/** `CASH` leaves the register, `STORE_CREDIT` waits for the customer balance (HU-CON-03), `TRANSFER` needs its reference. */
export const REFUND_METHODS = ['CASH', 'STORE_CREDIT', 'TRANSFER'] as const;
export type RefundMethod = (typeof REFUND_METHODS)[number];

/** `RESTOCK` goes back to the stock of the sale's warehouse (A stock); `SCRAP` is lost (A merma) and moves no stock. */
export const RETURN_CONDITIONS = ['RESTOCK', 'SCRAP'] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

export interface ReturnLineInput {
  saleItemId: string;
  quantity: number;
  condition: ReturnCondition;
}

/** The body of `POST /sales/returns`. */
export interface CreateSaleReturnInput {
  saleId: string;
  reason: string;
  comment?: string | null;
  refundMethod: string;
  /** Required for `TRANSFER`. */
  refundReference?: string | null;
  items: ReturnLineInput[];
}

/** The body of the approve and reject endpoints; a reject needs the reply. */
export interface ReturnDecisionInput {
  comment?: string;
}

export function isReturnReason(value: unknown): value is ReturnReason {
  return typeof value === 'string' && (RETURN_REASONS as readonly string[]).includes(value);
}
export function isRefundMethod(value: unknown): value is RefundMethod {
  return typeof value === 'string' && (REFUND_METHODS as readonly string[]).includes(value);
}
export function isReturnCondition(value: unknown): value is ReturnCondition {
  return typeof value === 'string' && (RETURN_CONDITIONS as readonly string[]).includes(value);
}

/** Units of a sale line that can still come back: what was sold less what earlier non-rejected returns took. */
export function returnableQuantity(sold: number, alreadyReturned: number): number {
  return Math.max(0, sold - alreadyReturned);
}

/** What the return rules read of a sale line. */
export interface ReturnableItem {
  saleItemId: string;
  quantity: number;
  /** Units taken by earlier returns that are not rejected. */
  returnedQuantity: number;
}

export type ReturnIssueCode = 'RETURN_EMPTY' | 'SALE_ITEM_NOT_FOUND' | 'INVALID_QUANTITY' | 'INVALID_CONDITION' | 'RETURN_EXCEEDS_SOLD';

export interface ReturnIssue {
  code: ReturnIssueCode;
  saleItemId?: string;
  requested?: number;
  returnable?: number;
}

/** A request cleaned of repeated lines (the same line and condition add up) and of zeros. */
export function normalizeReturnLines(lines: readonly ReturnLineInput[]): ReturnLineInput[] {
  const merged = new Map<string, ReturnLineInput>();
  for (const line of lines) {
    const key = `${line.saleItemId}|${line.condition}`;
    const known = merged.get(key);
    merged.set(key, known ? { ...known, quantity: known.quantity + line.quantity } : { ...line });
  }
  return [...merged.values()].filter((line) => line.quantity !== 0);
}

/** Every problem of the lines against the sale; empty when the return is valid. Repeated lines count together. */
export function validateReturnLines(items: readonly ReturnableItem[], lines: readonly ReturnLineInput[]): ReturnIssue[] {
  const request = normalizeReturnLines(lines);
  if (request.length === 0) return [{ code: 'RETURN_EMPTY' }];
  const byId = new Map(items.map((item) => [item.saleItemId, item]));
  const issues: ReturnIssue[] = [];
  const asked = new Map<string, number>();
  for (const line of request) {
    const item = byId.get(line.saleItemId);
    if (!item) {
      issues.push({ code: 'SALE_ITEM_NOT_FOUND', saleItemId: line.saleItemId });
    } else if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      issues.push({ code: 'INVALID_QUANTITY', saleItemId: line.saleItemId, requested: line.quantity });
    } else if (!isReturnCondition(line.condition)) {
      issues.push({ code: 'INVALID_CONDITION', saleItemId: line.saleItemId });
    } else {
      asked.set(line.saleItemId, (asked.get(line.saleItemId) ?? 0) + line.quantity);
    }
  }
  if (issues.length > 0) return issues;
  for (const [saleItemId, requested] of asked) {
    const item = byId.get(saleItemId) as ReturnableItem;
    const returnable = returnableQuantity(item.quantity, item.returnedQuantity);
    if (requested > returnable) issues.push({ code: 'RETURN_EXCEEDS_SOLD', saleItemId, requested, returnable });
  }
  return issues;
}

export type ReturnFieldError = 'REASON_INVALID' | 'REFUND_METHOD_INVALID' | 'TRANSFER_REFERENCE_REQUIRED' | 'REFERENCE_TOO_LONG' | 'COMMENT_TOO_LONG';

/** What is wrong with the header of a request (reason, refund, comment); empty when it can go on. */
export function validateReturnHeader(input: {
  reason: unknown;
  refundMethod: unknown;
  refundReference?: unknown;
  comment?: unknown;
}): ReturnFieldError[] {
  const errors: ReturnFieldError[] = [];
  if (!isReturnReason(input.reason)) errors.push('REASON_INVALID');
  if (!isRefundMethod(input.refundMethod)) errors.push('REFUND_METHOD_INVALID');
  const reference = typeof input.refundReference === 'string' ? input.refundReference.trim() : '';
  if (input.refundMethod === 'TRANSFER' && reference === '') errors.push('TRANSFER_REFERENCE_REQUIRED');
  if (reference.length > RETURN_REFERENCE_MAX) errors.push('REFERENCE_TOO_LONG');
  if (typeof input.comment === 'string' && input.comment.trim().length > RETURN_COMMENT_MAX) errors.push('COMMENT_TOO_LONG');
  return errors;
}

export type ReturnDecisionError = 'COMMENT_REQUIRED' | 'COMMENT_TOO_LONG';

/** A rejection needs the reply; no reply is longer than the comment limit. */
export function validateReturnDecision(decision: 'APPROVE' | 'REJECT', comment: unknown): ReturnDecisionError[] {
  const text = typeof comment === 'string' ? comment.trim() : '';
  if (decision === 'REJECT' && text === '') return ['COMMENT_REQUIRED'];
  if (text.length > RETURN_COMMENT_MAX) return ['COMMENT_TOO_LONG'];
  return [];
}

/** Only a completed sale can be returned; one that is cancelled or waiting to be cancelled cannot. */
export function isReturnableSaleStatus(status: SaleStatus): boolean {
  return status === 'COMPLETED';
}

/** Whether `now` is inside the return deadline of decision #15 (`days` null = no deadline). Same day rule as the cancellation. */
export function isWithinReturnWindow(soldAt: Date, now: Date, days: number | null): boolean {
  return isWithinCancellationWindow(now, soldAt, days);
}

/** Returns above the limit wait for Management; `null` limit never asks (decision #15 is still open). */
export function needsReturnApproval(total: Decimal | string, limit: string | null): boolean {
  if (limit === null) return false;
  return Decimal.of(total.toString()).cmp(Decimal.of(limit)) > 0;
}

export interface ReturnTotalsInput {
  /** Amounts of the sale: the refund is a share of what the customer really paid. */
  sale: { subtotal: Decimal; total: Decimal };
  /** Sum of the refunds of earlier non-rejected returns of the sale. */
  previousRefunded: Decimal;
  lines: readonly { unitPrice: Decimal | string; quantity: number }[];
  /** True when, after this return, every unit of the sale has come back. */
  completesSale: boolean;
}

export interface ReturnTotals {
  /** The refund of each line, in the order given. */
  lines: Decimal[];
  total: Decimal;
}

/**
 * The refund of a return. The customer discount and the rounding of the sale are shared out in proportion to what each line
 * is worth (`sale.total ÷ sale.subtotal`), to the cent. The return that completes the sale takes what is left of the sale
 * total (put on the last line), so all the refunds of a sale add up to `sale.total` exactly.
 */
export function returnTotals(input: ReturnTotalsInput): ReturnTotals {
  const zero = Decimal.zero(MONEY_SCALE);
  const refunds = input.lines.map((line) => proRata(lineTotal(line.unitPrice, line.quantity), input.sale.total, input.sale.subtotal));
  if (input.completesSale && refunds.length > 0) {
    const share = refunds.reduce((acc, value) => acc.add(value), zero);
    const left = input.sale.total.sub(input.previousRefunded);
    refunds[refunds.length - 1] = refunds[refunds.length - 1].add(left.sub(share));
  }
  return { lines: refunds, total: refunds.reduce((acc, value) => acc.add(value), zero) };
}

export type ReturnTimelineKey = 'requested' | 'approved' | 'creditNote' | 'refunded';
export type ReturnTimelineState = 'done' | 'current' | 'pending';

export interface ReturnTimelineStep {
  key: ReturnTimelineKey;
  state: ReturnTimelineState;
  /** The date of the step when it happened (ISO), or null. */
  at: string | null;
}

/**
 * The steps of VP-21: requested, approved, credit note issued, refunded. A rejected return stops after the request. The
 * credit note is `current` while it is a pending record and `done` once the SIAT epic has issued it.
 */
export function returnTimeline(ret: {
  status: SaleReturnStatus;
  createdAt: string;
  approvedAt: string | null;
  creditNoteStatus: InvoiceStatus | null;
}): ReturnTimelineStep[] {
  const approved = ret.status === 'APPROVED';
  const noteIssued = approved && ret.creditNoteStatus !== null && ret.creditNoteStatus !== 'PENDING' && ret.creditNoteStatus !== 'SENDING';
  return [
    { key: 'requested', state: 'done', at: ret.createdAt },
    { key: 'approved', state: approved ? 'done' : ret.status === 'PENDING_APPROVAL' ? 'current' : 'pending', at: approved ? ret.approvedAt : null },
    { key: 'creditNote', state: noteIssued ? 'done' : approved ? 'current' : 'pending', at: noteIssued ? ret.approvedAt : null },
    { key: 'refunded', state: approved ? 'done' : 'pending', at: approved ? ret.approvedAt : null },
  ];
}

// ---- API contracts ----

/** One line of a sale as the return form shows it. */
export interface ReturnableLine {
  saleItemId: string;
  productId: string;
  productName: string;
  sku: string;
  unitPrice: string;
  sold: number;
  returned: number;
  returnable: number;
}

/** `GET /sales/returns/sale-lookup?q=` · the sale found and what of it can still come back. */
export interface ReturnableSale {
  saleId: string;
  saleNumber: string;
  customerName: string | null;
  customerDocumentNumber: string | null;
  soldAt: string;
  total: string;
  subtotal: string;
  hasCustomer: boolean;
  invoiceNumber: number | null;
  /** What earlier returns that are not rejected already refunded. */
  refunded: string;
  /** Returns above this value wait for approval (`sales.returnApprovalLimit`); null never asks. */
  approvalLimit: string | null;
  /** End of the return deadline (ISO), null when there is none. */
  windowEndsAt: string | null;
  lines: ReturnableLine[];
}

export interface SaleReturnSummary {
  id: string;
  number: string;
  saleId: string;
  saleNumber: string;
  customerName: string | null;
  pieces: number;
  total: string;
  status: SaleReturnStatus;
  creditNoteStatus: InvoiceStatus | null;
  createdAt: string;
}

export interface SaleReturnKpis {
  /** Returns created this month (La Paz). */
  monthCount: number;
  monthAmount: string;
  pendingCount: number;
  scrapPieces: number;
}

export interface SaleReturnList {
  items: SaleReturnSummary[];
  total: number;
  page: number;
  pageSize: number;
  totalAmount: string;
  kpis: SaleReturnKpis;
}

export interface SaleReturnItemDetail {
  saleItemId: string;
  productId: string;
  productName: string;
  sku: string;
  quantity: number;
  condition: ReturnCondition;
  refundAmount: string;
}

export interface SaleReturnAuditEntry {
  action: string;
  at: string;
  userName: string | null;
}

export interface SaleReturnDetail extends SaleReturnSummary {
  reason: ReturnReason;
  comment: string | null;
  refundMethod: RefundMethod;
  refundReference: string | null;
  customerDocumentNumber: string | null;
  createdByName: string | null;
  approvedAt: string | null;
  scrapPieces: number;
  invoiceNumber: number | null;
  items: SaleReturnItemDetail[];
  timeline: ReturnTimelineStep[];
  audit: SaleReturnAuditEntry[];
  /** The request waiting for a decision, when the return is `PENDING_APPROVAL`. */
  approval: { id: string; requestedBy: string; requestedAt: string; comment: string | null } | null;
  /** The reply of Management when it decided. */
  decision: { status: 'APPROVED' | 'REJECTED'; decidedBy: string; decidedAt: string; comment: string } | null;
}

/** What the sale detail says about returns (VP-21 link). */
export interface SaleReturnRef {
  id: string;
  number: string;
  status: SaleReturnStatus;
  total: string;
  createdAt: string;
}
