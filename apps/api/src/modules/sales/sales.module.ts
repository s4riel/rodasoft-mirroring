import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { CashController } from './cash/cash.controller';
import { CashRegistersService } from './cash/cash-registers.service';
import { CashShiftsService } from './cash/cash-shifts.service';
import { CustomersController } from './customers/customers.controller';
import { CustomersService } from './customers/customers.service';
import { PosController } from './pos/pos.controller';
import { PosCatalogService } from './pos/pos-catalog.service';
import { PosCheckoutService } from './pos/pos-checkout.service';
import { PosEquivalentsService } from './pos/pos-equivalents.service';
import { PosProductSheetService } from './pos/pos-product-sheet.service';
import { MockPaymentProvider } from './payments/mock-payment.provider';
import { PAYMENT_PROVIDERS, type PaymentProviderRegistry } from './payments/payment-provider';

/**
 * Sales and POS. HU-VEN-00 laid the foundations (payment providers); HU-VEN-01 adds the cash register opening
 * (`cash/`); HU-VEN-02 the POS search and cart (`pos/`); HU-VEN-03 the equivalents of an out-of-stock product; HU-VEN-04 the product sheet inside the POS; HU-VEN-05 and 37 the customers (`customers/`) and the customer of the cart. The next stories add their controllers and services here, split into sub-folders (`pos`, `quotes`,
 * `orders`, `pricing`, `approvals`) as the module grows.
 */
@Module({
  // the POS reads the inventory's equivalences (HU-VEN-03) and product sheet (HU-VEN-04)
  imports: [InventoryModule],
  controllers: [CashController, CustomersController, PosController],
  providers: [
    CashRegistersService,
    CashShiftsService,
    CustomersService,
    PosCatalogService,
    PosCheckoutService,
    PosEquivalentsService,
    PosProductSheetService,
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
