/**
 * Asking for the cancellation of a sale (HU-VEN-14): the reasons, the validation of the request, the legal window of
 * decision #10 and the contract of what the sale detail says about it. Management decides in HU-VEN-15.
 */
import { laPazToday } from './kardex';
import type { SaleStatus } from './state-machine';

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

export function isCancellationReason(value: unknown): value is CancellationReason {
  return typeof value === 'string' && (CANCELLATION_REASONS as readonly string[]).includes(value);
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
