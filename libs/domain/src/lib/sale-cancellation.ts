/**
 * Asking for the cancellation of a sale (HU-VEN-14): the reasons, the validation of the request, the legal window of
 * decision #10 and the contract of what the sale detail says about it. Management decides in HU-VEN-15.
 */
import { laPazToday } from './kardex';
import { Decimal, sum } from './money';
import type { PaymentMethod } from './sale-receipt';
import { type InvoiceStatus, invoiceMachine, type SaleStatus } from './state-machine';

/** The reasons the cashier chooses from (Figma VP-15a). The ERP turns each code into Spanish. */
export const CANCELLATION_REASONS = ['CUSTOMER_DATA_ERROR', 'ITEMS_OR_PRICES_ERROR', 'SALE_NOT_COMPLETED', 'OTHER'] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const CANCELLATION_COMMENT_MAX = 500;

/** The body of `POST /sales/sales/:id/cancellation-request`. */
export interface CancellationRequestInput {
  reason: string;
  comment: string;
}

export type CancellationRequestError = 'REASON_INVALID' | 'COMMENT_REQUIRED' | 'COMMENT_TOO_LONG';

/**
 * A reason from the SIN parametric table, chosen from an invoice (HU-FAC-09): `SIN_<code>`. The four built-in codes are in
 * `SIAT_CANCELLATION_REASONS` (invoicing.ts); the synced catalogue replaces them in HU-FAC-25.
 */
const SIN_REASON = /^SIN_[1-9]\d{0,3}$/;

export function isSinCancellationReason(value: unknown): value is `SIN_${number}` {
  return typeof value === 'string' && SIN_REASON.test(value);
}

export function isCancellationReason(value: unknown): value is CancellationReason | `SIN_${number}` {
  return (typeof value === 'string' && (CANCELLATION_REASONS as readonly string[]).includes(value)) || isSinCancellationReason(value);
}

/** What is wrong with a request, in the order the form asks for it; empty when it can be sent. The comment is judged trimmed. */
export function validateCancellationRequest(input: { reason: unknown; comment: unknown }): CancellationRequestError[] {
  const errors: CancellationRequestError[] = [];
  if (!isCancellationReason(input.reason)) errors.push('REASON_INVALID');
  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (comment === '') errors.push('COMMENT_REQUIRED');
  else if (comment.length > CANCELLATION_COMMENT_MAX) errors.push('COMMENT_TOO_LONG');
  return errors;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The instant the cancellation window closes (exclusive): the start of the La Paz day after the last day allowed, which is
 * the sale's day plus `days` (the setting is a positive whole number; 0 would mean the same day only). `null` days means no
 * limit (decision #10 is still open), so no end.
 */
export function cancellationWindowEndsAt(saleAt: Date, days: number | null): Date | null {
  if (days === null) return null;
  const saleDay = Date.parse(`${laPazToday(saleAt)}T00:00:00Z`);
  const lastDay = new Date(saleDay + (days + 1) * DAY_MS);
  const iso = lastDay.toISOString().slice(0, 10);
  return new Date(`${iso}T00:00:00-04:00`);
}

export function isWithinCancellationWindow(now: Date, saleAt: Date, days: number | null): boolean {
  const end = cancellationWindowEndsAt(saleAt, days);
  return end === null || now.getTime() < end.getTime();
}

/** The open request of a sale, as the detail shows it (VP-15). */
export interface PendingCancellation {
  id: string;
  reason: CancellationReason;
  comment: string;
  requestedBy: string;
  /** ISO instant. */
  requestedAt: string;
  /** Whether the caller may take it back: the requester, or who may approve cancellations. */
  canWithdraw: boolean;
}

/** The cancellation part of `GET /sales/sales/:id`. */
export interface SaleCancellationState {
  /** The sale is completed, nothing is pending and the window is open. The caller's permission is the ERP's to check. */
  canRequest: boolean;
  /** ISO instant the window closes; `null` while there is no limit. */
  windowEndsAt: string | null;
  pending: PendingCancellation | null;
  /** How the last request ended, while it is the sale's latest word (a rejected one, or the approval of a cancelled sale). */
  lastDecision: CancellationDecisionSummary | null;
  /** What an approval will undo, for the request dialog (VP-15a). */
  impact: { warehouseName: string; registerName: string };
}

/** Whether a sale in this status could be asked to be cancelled, before looking at the window. */
export function isCancellableStatus(status: SaleStatus): boolean {
  return status === 'COMPLETED';
}

/** The answer of requesting or withdrawing a cancellation: the sale's new status. */
export interface SaleCancellationResponse {
  saleId: string;
  status: SaleStatus;
}

// ── Deciding the request (HU-VEN-15) ──

export const CANCELLATION_REPLY_MAX = 500;

export type CancellationDecision = 'APPROVE' | 'REJECT';
export type CancellationDecisionError = 'COMMENT_REQUIRED' | 'COMMENT_TOO_LONG';

/** The body of `POST …/cancellation-request/approve` and `…/reject`; the reply is optional when approving. */
export interface CancellationDecisionInput {
  comment?: string;
}

/** What is wrong with the reply of a decision. Rejecting must tell the requester why; approving may stay silent. */
export function validateCancellationDecision(input: { decision: CancellationDecision; comment: unknown }): CancellationDecisionError[] {
  const comment = typeof input.comment === 'string' ? input.comment.trim() : '';
  if (input.decision === 'REJECT' && comment === '') return ['COMMENT_REQUIRED'];
  if (comment.length > CANCELLATION_REPLY_MAX) return ['COMMENT_TOO_LONG'];
  return [];
}

/**
 * What an approval does to the invoice: a `PENDING` or `REJECTED` one has no valid SIAT answer and is voided; a `VALID` one asks
 * the SIAT to cancel it (HU-FAC-10); in any other state the cancellation cannot go on.
 */
export type InvoiceCancellationAction = 'VOID' | 'REQUEST_SIAT_CANCELLATION' | 'BLOCKED';

export function invoiceCancellationAction(status: InvoiceStatus): InvoiceCancellationAction {
  if (invoiceMachine.can(status, 'void')) return 'VOID';
  if (invoiceMachine.can(status, 'requestCancellation')) return 'REQUEST_SIAT_CANCELLATION';
  return 'BLOCKED';
}

/** The invoice event an approval fires, or null when the invoice cannot be cancelled. */
export function invoiceCancellationEvent(status: InvoiceStatus): 'void' | 'requestCancellation' | null {
  switch (invoiceCancellationAction(status)) {
    case 'VOID':
      return 'void';
    case 'REQUEST_SIAT_CANCELLATION':
      return 'requestCancellation';
    case 'BLOCKED':
      return null;
  }
}

/** A refund the system cannot make: the money went to a provider or a bank, so someone gives it back by hand. */
export interface ManualRefund {
  method: PaymentMethod;
  amount: string;
}

/** What approving a cancellation will do (VP-15c "Qué pasará"). Money as fixed-point strings. */
export interface CancellationImpact {
  invoiceAction: InvoiceCancellationAction;
  /** Units that go back to the sale's warehouse. */
  stockUnits: number;
  /** Cash the register gives back: what the sale kept, net of the change. */
  cashRefund: string;
  manualRefunds: ManualRefund[];
}

const MANUAL_REFUND_METHODS: readonly PaymentMethod[] = ['QR', 'CARD', 'TRANSFER'];

/** `CREDIT` is unpaid, so there is nothing to give back for it. */
export function cancellationImpact(sale: {
  invoiceStatus: InvoiceStatus;
  lines: readonly { quantity: number }[];
  payments: readonly { method: PaymentMethod; amount: string }[];
}): CancellationImpact {
  const paid = (method: PaymentMethod) => sum(sale.payments.filter((payment) => payment.method === method).map((payment) => Decimal.of(payment.amount)));
  const manualRefunds = MANUAL_REFUND_METHODS.map((method) => ({ method, amount: paid(method) }))
    .filter((refund) => refund.amount.cmp(Decimal.zero()) > 0)
    .map((refund) => ({ method: refund.method, amount: refund.amount.toString() }));
  return {
    invoiceAction: invoiceCancellationAction(sale.invoiceStatus),
    stockUnits: sale.lines.reduce((units, line) => units + line.quantity, 0),
    cashRefund: paid('CASH').toString(),
    manualRefunds,
  };
}

/** One line of the audit trail shown with a request. */
export interface CancellationAuditEntry {
  action: string;
  /** ISO instant. */
  at: string;
  userName: string | null;
}

/** `GET /sales/sales/:id/cancellation-request` (VP-15c). */
export interface CancellationReview {
  saleId: string;
  saleNumber: string;
  request: { id: string; reason: CancellationReason; comment: string; requestedBy: string; requestedAt: string };
  sale: {
    total: string;
    /** ISO instant. */
    createdAt: string;
    invoice: { status: InvoiceStatus; number: number | null };
  };
  impact: CancellationImpact & {
    warehouseName: string;
    registerName: string;
    /** Whether the sale's register has an open shift to take the refund; without it an approval is refused. */
    shiftOpen: boolean;
  };
  audit: CancellationAuditEntry[];
}

/** How the last request of a sale ended, for the detail (VP-15d and the cashier's note after a rejection). */
export interface CancellationDecisionSummary {
  status: 'APPROVED' | 'REJECTED';
  decidedBy: string;
  /** ISO instant. */
  decidedAt: string;
  comment: string;
}
