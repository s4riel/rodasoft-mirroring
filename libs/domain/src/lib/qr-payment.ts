/**
 * Paying by QR (HU-VEN-08, decision #6): what the QR encodes, when it expires, which payments let the sale complete and the
 * contracts of the QR endpoints. With the mock provider the cashier confirms by hand; a real adapter only changes who calls
 * `confirm`. Money is always `Decimal`.
 */
import { Decimal, MONEY_SCALE } from './money';
import type { PaymentMethod } from './sale-receipt';
import type { PaymentStatus } from './state-machine';

/** Marks the placeholder payload of the mock adapter, so nobody mistakes it for a real payment QR. */
export const QR_PAYLOAD_PREFIX = 'RODASOFT-MOCK';

/** What the QR encodes: the provider's reference and the amount, so the same payment always draws the same QR. */
export function buildQrPayload(providerRef: string, amount: Decimal): string {
  return `${QR_PAYLOAD_PREFIX}|${providerRef}|${amount.round(MONEY_SCALE).toString()}`;
}

/** The moment a pending QR stops being accepted. */
export function qrExpiresAt(from: Date, timeoutSeconds: number): Date {
  return new Date(from.getTime() + timeoutSeconds * 1000);
}

/** A QR is expired from its deadline on (the deadline itself already counts as late). */
export function isQrExpired(expiresAt: Date | string, now: Date): boolean {
  return new Date(expiresAt).getTime() <= now.getTime();
}

export interface PaymentToComplete {
  method: PaymentMethod;
  status: PaymentStatus;
}

/**
 * Whether the payments let the sale complete: there is at least one, and every one that goes through a provider (QR, card…) is
 * already `CONFIRMED`. Cash is handed over in the moment, so it has no status to wait for.
 */
export function canCompleteWithPayments(payments: readonly PaymentToComplete[]): boolean {
  if (payments.length === 0) return false;
  return payments.every((payment) => payment.method === 'CASH' || payment.status === 'CONFIRMED');
}

// --- API contracts (`/api/v1/sales/pos/checkout/payments/qr*`). Money values are decimal strings. ---

/** A QR payment of the cashier's checkout, as the QR screen needs it. */
export interface PosQrPayment {
  paymentId: string;
  /** The key of this payment; the same key completes the sale (`complete`). */
  idempotencyKey: string;
  /** The total the QR charges, rounded as the sale total. */
  amount: string;
  /** What the QR encodes. */
  qrPayload: string;
  status: PaymentStatus;
  /** ISO instant after which a pending QR is cancelled by the server. */
  expiresAt: string;
}

export interface StartPosQrInput {
  /** One key per QR attempt: a retry of the same call returns the same payment instead of opening a second one. */
  idempotencyKey: string;
  /** The total the cashier saw; the server refuses if it differs (`CHECKOUT_TOTAL_CHANGED`). */
  expectedTotal: string;
}

/** What the cashier reports with the mock adapter: the customer paid, or the payment did not arrive. */
export type PosQrOutcome = 'APPROVED' | 'DECLINED';

export interface ConfirmPosQrInput {
  outcome: PosQrOutcome;
}

export interface PosQrPaymentResponse {
  payment: PosQrPayment;
}

/** `GET /sales/pos/checkout/payments/qr`: the QR the cart is still waiting for or already got confirmed (after a refresh). */
export interface PosActiveQrResponse {
  payment: PosQrPayment | null;
}
