import { Test } from '@nestjs/testing';
import { MockPaymentProvider } from './payments/mock-payment.provider';
import { PAYMENT_PROVIDERS, type PaymentProviderRegistry } from './payments/payment-provider';
import { SalesModule } from './sales.module';

describe('SalesModule', () => {
  it('compiles and provides the payment providers of QR and card, both on the mock adapter for now', async () => {
    // the cash services need the database, request context and audit/outbox providers of other modules: mocked here
    const module = await Test.createTestingModule({ imports: [SalesModule] })
      .useMocker(() => ({}))
      .compile();
    const registry = module.get<PaymentProviderRegistry>(PAYMENT_PROVIDERS);
    expect(registry.QR).toBeInstanceOf(MockPaymentProvider);
    expect(registry.CARD).toBeInstanceOf(MockPaymentProvider);
  });
});
