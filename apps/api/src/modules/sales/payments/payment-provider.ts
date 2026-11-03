import { ConflictException } from '@nestjs/common';
import type { Decimal } from '@rodasoft/domain';

/** Methods that go through an outside provider. Cash and credit have none; a transfer is confirmed by hand. */
export type ProviderPaymentMethod = 'QR' | 'CARD';

/** What the provider (or the cashier, with the mock adapter) says about a charge. */
export type PaymentOutcome = 'APPROVED' | 'DECLINED';

export interface ChargeRequest {
  amount: Decimal;
  method: ProviderPaymentMethod;
  /** Same key, same charge: a retry never charges twice. The checkout payment row stores it (unique per company). */
  idempotencyKey: string;
  /** The key is unique per company, not globally, so the provider keeps the companies apart. */
  companyId: string;
}

/** A new charge is PENDING; a retry of a settled charge reports the state it reached. */
export interface ChargeResult {
  providerRef: string;
  status: 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED';
}

export interface ConfirmResult {
  providerRef: string;
  status: 'CONFIRMED' | 'DECLINED';
}

export interface CancelResult {
  providerRef: string;
  status: 'CANCELLED';
}

/**
 * Payment provider abstraction (decisions #6 QR and #8 card). `charge` opens a pending payment, `confirm` records the
 * outcome (a webhook or, with the mock adapter, the cashier), `cancel` drops a payment that is still pending. All three
 * are idempotent: repeating a call with the same arguments returns the stored result.
 */
export interface PaymentProvider {
  charge(request: ChargeRequest): Promise<ChargeResult>;
  confirm(providerRef: string, outcome: PaymentOutcome): Promise<ConfirmResult>;
  cancel(providerRef: string): Promise<CancelResult>;
}

/** The provider of each method. Real adapters replace the mock one here, with no change in the callers. */
export type PaymentProviderRegistry = Record<ProviderPaymentMethod, PaymentProvider>;

/** Injection token of the `PaymentProviderRegistry`. */
export const PAYMENT_PROVIDERS = Symbol('PAYMENT_PROVIDERS');

export type PaymentProviderErrorCode = 'PAYMENT_INVALID_STATE' | 'PAYMENT_NOT_FOUND' | 'PAYMENT_IDEMPOTENCY_CONFLICT';

/** A payment operation the provider refuses. It is a 409 `{ code, message }` problem, like any other business error. */
export class PaymentProviderError extends ConflictException {
  constructor(
    readonly code: PaymentProviderErrorCode,
    message: string,
  ) {
    super({ code, message });
  }
}
