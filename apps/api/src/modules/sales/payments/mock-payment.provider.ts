import { Injectable } from '@nestjs/common';
import {
  type CancelResult,
  type ChargeRequest,
  type ChargeResult,
  type ConfirmResult,
  type PaymentOutcome,
  type PaymentProvider,
  PaymentProviderError,
} from './payment-provider';

type MockState = 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED';

/**
 * Manual adapter used until the QR and card providers are chosen (decisions #6 and #8): `charge` leaves the payment
 * pending and the cashier reports the outcome through `confirm`. The `providerRef` comes from the idempotency key, so
 * a repeated charge finds the same payment. The state lives in memory; the durable guard against a double charge is the
 * unique `pos_checkout_payments.idempotency_key` that HU-VEN-08 and HU-VEN-10 write before calling the provider.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  private readonly payments = new Map<string, { state: MockState; amount: string; method: string }>();

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    const providerRef = `mock-${request.companyId}-${request.method.toLowerCase()}-${request.idempotencyKey}`;
    const amount = request.amount.toString();
    const existing = this.payments.get(providerRef);
    if (existing) {
      if (existing.amount !== amount) {
        throw new PaymentProviderError('PAYMENT_IDEMPOTENCY_CONFLICT', 'The idempotency key was already used for another amount');
      }
      return { providerRef, status: existing.state };
    }
    this.payments.set(providerRef, { state: 'PENDING', amount, method: request.method });
    return { providerRef, status: 'PENDING' };
  }

  async confirm(providerRef: string, outcome: PaymentOutcome): Promise<ConfirmResult> {
    const payment = this.find(providerRef);
    const target: 'CONFIRMED' | 'DECLINED' = outcome === 'APPROVED' ? 'CONFIRMED' : 'DECLINED';
    // confirming twice with the same outcome is a no-op; a different outcome, or a cancelled payment, is refused
    if (payment.state === target) return { providerRef, status: target };
    if (payment.state !== 'PENDING') {
      throw new PaymentProviderError('PAYMENT_INVALID_STATE', `Cannot ${outcome === 'APPROVED' ? 'approve' : 'decline'} a ${payment.state.toLowerCase()} payment`);
    }
    payment.state = target;
    return { providerRef, status: target };
  }

  async cancel(providerRef: string): Promise<CancelResult> {
    const payment = this.find(providerRef);
    if (payment.state === 'CANCELLED') return { providerRef, status: 'CANCELLED' };
    if (payment.state !== 'PENDING') {
      throw new PaymentProviderError('PAYMENT_INVALID_STATE', `Cannot cancel a ${payment.state.toLowerCase()} payment`);
    }
    payment.state = 'CANCELLED';
    return { providerRef, status: 'CANCELLED' };
  }

  private find(providerRef: string) {
    const payment = this.payments.get(providerRef);
    if (!payment) throw new PaymentProviderError('PAYMENT_NOT_FOUND', 'The payment does not exist');
    return payment;
  }
}
