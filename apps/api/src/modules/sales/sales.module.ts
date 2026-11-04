import { Module } from '@nestjs/common';
import { CashController } from './cash/cash.controller';
import { CashRegistersService } from './cash/cash-registers.service';
import { CashShiftsService } from './cash/cash-shifts.service';
import { MockPaymentProvider } from './payments/mock-payment.provider';
import { PAYMENT_PROVIDERS, type PaymentProviderRegistry } from './payments/payment-provider';

/**
 * Sales and POS. HU-VEN-00 laid the foundations (payment providers); HU-VEN-01 adds the cash register opening
 * (`cash/`). The next stories add their controllers and services here, split into sub-folders (`pos`, `quotes`,
 * `orders`, `pricing`, `approvals`) as the module grows.
 */
@Module({
  controllers: [CashController],
  providers: [
    CashRegistersService,
    CashShiftsService,
    MockPaymentProvider,
    {
      // decisions #6 and #8: both methods use the mock adapter until the real providers are chosen
      provide: PAYMENT_PROVIDERS,
      useFactory: (mock: MockPaymentProvider): PaymentProviderRegistry => ({ QR: mock, CARD: mock }),
      inject: [MockPaymentProvider],
    },
  ],
  // the POS stories call `CashShiftsService.requireOpenShift()` before any cart or payment action
  exports: [PAYMENT_PROVIDERS, CashShiftsService],
})
export class SalesModule {}
