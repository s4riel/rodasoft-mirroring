import { Module } from '@nestjs/common';
import { MockPaymentProvider } from './payments/mock-payment.provider';
import { PAYMENT_PROVIDERS, type PaymentProviderRegistry } from './payments/payment-provider';

/**
 * Sales and POS foundations (HU-VEN-00): no endpoints yet. The stories of the HU-VEN epic add their controllers and
 * services here, split into sub-folders (`cash`, `pos`, `quotes`, `orders`, `pricing`, `approvals`) as the module grows.
 */
@Module({
  providers: [
    MockPaymentProvider,
    {
      // decisions #6 and #8: both methods use the mock adapter until the real providers are chosen
      provide: PAYMENT_PROVIDERS,
      useFactory: (mock: MockPaymentProvider): PaymentProviderRegistry => ({ QR: mock, CARD: mock }),
      inject: [MockPaymentProvider],
    },
  ],
  exports: [PAYMENT_PROVIDERS],
})
export class SalesModule {}
