/**
 * Paying by card (HU-VEN-10, decision #8): the decline reasons, the authorization code of the terminal voucher and the contracts
 * of the card endpoints. With the mock provider the cashier reads the outcome on the bank's terminal and reports it by hand; a
 * real adapter only changes who calls `confirm`. A card is a payment method on its own: it does not join a mixed payment.
 */
import type { PaymentStatus } from './state-machine';

/** Why the terminal declined, as the cashier reports it. Same values as the Prisma enum `PaymentDeclineReason`. */
export const CARD_DECLINE_REASONS = ['INSUFFICIENT_FUNDS', 'CARD_DECLINED', 'TERMINAL_ERROR', 'OTHER'] as const;
export type CardDeclineReason = (typeof CARD_DECLINE_REASONS)[number];

export function isCardDeclineReason(value: unknown): value is CardDeclineReason {
  return typeof value === 'string' && (CARD_DECLINE_REASONS as readonly string[]).includes(value);
}

export const AUTHORIZATION_CODE_MIN_LENGTH = 4;
export const AUTHORIZATION_CODE_MAX_LENGTH = 12;

export type AuthorizationCodeResult = { ok: true; code: string } | { ok: false; error: 'INVALID_AUTHORIZATION_CODE' };

/** The authorization code of the voucher: trimmed and upper-cased, 4 to 12 letters or digits. */
export function normalizeAuthorizationCode(text: string): AuthorizationCodeResult {
  const code = text.trim().toUpperCase();
  const valid =
    code.length >= AUTHORIZATION_CODE_MIN_LENGTH &&
    code.length <= AUTHORIZATION_CODE_MAX_LENGTH &&
    /^[A-Z0-9]+$/.test(code);
  return valid ? { ok: true, code } : { ok: false, error: 'INVALID_AUTHORIZATION_CODE' };
}

// --- API contracts (`/api/v1/sales/pos/checkout/payments/card*`). Money values are decimal strings. ---

/** A card payment attempt of the cashier's checkout. A decline is final: the cashier retries with a new attempt. */
export interface PosCardPayment {
  paymentId: string;
  /** The key of this attempt; the same key completes the sale (`complete`). */
  idempotencyKey: string;
  /** The total the terminal charges, rounded as the sale total. */
  amount: string;
  status: PaymentStatus;
  /** 1 for the first attempt of the checkout, 2 for the retry after a decline, and so on. */
  attempt: number;
  /** The voucher's code, once the payment is approved. */
  authorizationCode: string | null;
  /** Why it was declined, once the payment is declined. */
  declineReason: CardDeclineReason | null;
}

export interface StartPosCardInput {
  /** One key per attempt: a retry of the same call returns the same payment, a new attempt needs a new key. */
  idempotencyKey: string;
  /** The total the cashier saw; the server refuses if it differs (`CHECKOUT_TOTAL_CHANGED`). */
  expectedTotal: string;
}

/** What the cashier reports with the mock adapter: approved with the voucher's code, or declined with the reason. */
export type ConfirmPosCardInput =
  | { outcome: 'APPROVED'; authorizationCode: string }
  | { outcome: 'DECLINED'; reason: CardDeclineReason };

export interface PosCardPaymentResponse {
  payment: PosCardPayment;
}

/** `GET /sales/pos/checkout/payments/card`: the card attempt the cart waits for, got confirmed or was declined (after a refresh). */
export interface PosActiveCardResponse {
  payment: PosCardPayment | null;
}
