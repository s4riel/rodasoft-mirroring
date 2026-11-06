import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  CustomerSearchResponse,
  CompletePosCheckoutResponse,
  CustomerSummary,
  PosActiveCardResponse,
  PosActiveQrResponse,
  PosCardPaymentResponse,
  PosCategoryListResponse,
  PosCheckoutResponse,
  PosQrPaymentResponse,
  PosEquivalentsResponse,
  PosPayResponse,
  PosInvoiceDataResponse,
  PosProductSearchResponse,
  PosProductSheet,
} from '@rodasoft/domain';
import { RequirePermissions } from '../../access/require-permissions.decorator';
import { CreatePosCustomerDto, PosCustomerSearchQueryDto, SetPosCustomerDto } from '../customers/customers.dto';
import { CustomersService } from '../customers/customers.service';
import { CompletePosCheckoutDto, ConfirmPosCardDto, ConfirmPosQrDto, StartPosCardDto, StartPosQrDto } from './pos-payment.dto';
import { PosCardPaymentService } from './pos-card-payment.service';
import { PosQrPaymentService } from './pos-qr-payment.service';
import { AddPosCheckoutItemDto, PosProductSearchQueryDto, UpdatePosCheckoutItemDto } from './pos.dto';
import { posErrors } from './pos.errors';
import { CashShiftsService } from '../cash/cash-shifts.service';
import { PosCatalogService } from './pos-catalog.service';
import { PosCheckoutService } from './pos-checkout.service';
import { PosEquivalentsService } from './pos-equivalents.service';
import { PosPaymentService } from './pos-payment.service';
import { PosProductSheetService } from './pos-product-sheet.service';

function strictValidationPipe(code: string, message: string): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: (errors: ValidationError[]) =>
      new BadRequestException({ code, message, details: errors.map((e) => ({ field: e.property, constraints: e.constraints })) }),
  });
}

const filterPipe = strictValidationPipe('INVALID_FILTER', 'Invalid filter');
const bodyPipe = strictValidationPipe('VALIDATION_FAILED', 'Invalid request');
/** A malformed product id is simply a product that does not exist. */
const productIdPipe = new ParseUUIDPipe({ exceptionFactory: () => posErrors.productNotFound() });
/** Another cashier's line, or a malformed id, is simply a line that does not exist. */
const itemIdPipe = new ParseUUIDPipe({ exceptionFactory: () => posErrors.itemNotFound() });
/** A malformed payment id is simply a payment that does not exist. */
const paymentIdPipe = new ParseUUIDPipe({ exceptionFactory: () => posErrors.paymentNotFound() });

/** VP-03 · POS search and cart (HU-VEN-02). Every call needs an open cash shift of the caller (`CASH_SHIFT_NOT_OPEN`). */
@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales/pos')
@RequirePermissions('sales.pos.use')
export class PosController {
  constructor(
    private readonly catalog: PosCatalogService,
    private readonly checkout: PosCheckoutService,
    private readonly payment: PosPaymentService,
    private readonly qr: PosQrPaymentService,
    private readonly card: PosCardPaymentService,
    private readonly equivalents: PosEquivalentsService,
    private readonly sheets: PosProductSheetService,
    private readonly shifts: CashShiftsService,
    private readonly customers: CustomersService,
  ) {}

  @Get('categories')
  categories(): Promise<PosCategoryListResponse> {
    return this.catalog.categories();
  }

  @Get('product-search')
  productSearch(@Query(filterPipe) query: PosProductSearchQueryDto): Promise<PosProductSearchResponse> {
    return this.catalog.search(query);
  }

  /** VP-03b (HU-VEN-03): in-stock equivalents of a product, and where the original is in stock. */
  @Get('products/:id/equivalents')
  productEquivalents(@Param('id', productIdPipe) id: string): Promise<PosEquivalentsResponse> {
    return this.equivalents.list(id);
  }

  /** VP-03e (HU-VEN-04): the technical sheet of a product, without costs. */
  @Get('products/:id/sheet')
  productSheet(@Param('id', productIdPipe) id: string): Promise<PosProductSheet> {
    return this.sheets.sheet(id);
  }

  /** VP-03c (HU-VEN-05): searches the company's customers by name or document. */
  @Get('customers')
  async searchCustomers(@Query(filterPipe) query: PosCustomerSearchQueryDto): Promise<CustomerSearchResponse> {
    await this.shifts.requireOpenShift();
    return this.customers.search(query.q);
  }

  /** VP-03c: quick creation of a customer. Never sets a discount or credit: that is `sales.customers.manage`. */
  @Post('customers')
  async createCustomer(@Body(bodyPipe) body: CreatePosCustomerDto): Promise<CustomerSummary> {
    await this.shifts.requireOpenShift();
    return this.customers.quickCreate(body);
  }

  /** Sets the customer of my cart, or `null` for a final consumer. */
  @Put('checkout/customer')
  setCustomer(@Body(bodyPipe) body: SetPosCustomerDto): Promise<PosCheckoutResponse> {
    return this.checkout.setCustomer(body.customerId);
  }

  /** The tax data the invoice will carry; refuses a customer whose document is not valid. */
  @Get('checkout/invoice-data')
  invoiceData(): Promise<PosInvoiceDataResponse> {
    return this.checkout.invoiceData();
  }

  /** VP-04 (HU-VEN-07): freezes the total and opens the payment. A changed price answers `CHECKOUT_PRICES_CHANGED`. */
  @Post('checkout/pay')
  pay(): Promise<PosPayResponse> {
    return this.payment.pay();
  }

  /** "Cancelar" on the payment screen: back to the cart. */
  @Post('checkout/back')
  back(): Promise<PosCheckoutResponse> {
    return this.payment.back();
  }

  /** VP-16a (HU-VEN-11): charges and completes the sale in one transaction. */
  @Post('checkout/complete')
  complete(@Body(bodyPipe) body: CompletePosCheckoutDto): Promise<CompletePosCheckoutResponse> {
    return this.payment.complete(body);
  }

  /** VP-04b (HU-VEN-08): the QR my cart waits for or already got confirmed, for the screen to resume after a refresh. */
  @Get('checkout/payments/qr')
  activeQr(): Promise<PosActiveQrResponse> {
    return this.qr.current();
  }

  /** VP-04b: opens a QR for the whole total (the mock provider; the cashier confirms by hand). */
  @Post('checkout/payments/qr')
  startQr(@Body(bodyPipe) body: StartPosQrDto): Promise<PosQrPaymentResponse> {
    return this.qr.start(body);
  }

  /** VP-12 (HU-VEN-10): the card attempt my cart waits for, got approved or was declined, for the screen to resume after a refresh. */
  @Get('checkout/payments/card')
  activeCard(): Promise<PosActiveCardResponse> {
    return this.card.current();
  }

  /** VP-12: opens a card attempt for the whole total (the mock provider; the cashier reports the terminal's outcome). */
  @Post('checkout/payments/card')
  startCard(@Body(bodyPipe) body: StartPosCardDto): Promise<PosCardPaymentResponse> {
    return this.card.start(body);
  }

  @Get('checkout/payments/card/:id')
  cardPayment(@Param('id', paymentIdPipe) id: string): Promise<PosCardPaymentResponse> {
    return this.card.get(id);
  }

  /** The cashier reports the terminal's outcome: approved with the authorization code, or declined with a reason. */
  @Post('checkout/payments/card/:id/confirm')
  confirmCard(@Param('id', paymentIdPipe) id: string, @Body(bodyPipe) body: ConfirmPosCardDto): Promise<PosCardPaymentResponse> {
    return this.card.confirm(id, body);
  }

  /** "Cambiar forma de pago" while the terminal waits: drops the pending card attempt. */
  @Post('checkout/payments/card/:id/cancel')
  cancelCard(@Param('id', paymentIdPipe) id: string): Promise<PosCardPaymentResponse> {
    return this.card.cancel(id);
  }

  /** The state of a QR payment; the ERP polls it while the screen waits for the customer. */
  @Get('checkout/payments/:id')
  qrPayment(@Param('id', paymentIdPipe) id: string): Promise<PosQrPaymentResponse> {
    return this.qr.get(id);
  }

  /** The cashier reports the outcome of the QR payment. */
  @Post('checkout/payments/:id/confirm')
  confirmQr(@Param('id', paymentIdPipe) id: string, @Body(bodyPipe) body: ConfirmPosQrDto): Promise<PosQrPaymentResponse> {
    return this.qr.confirm(id, body);
  }

  /** "Cambiar método": drops a pending QR payment. */
  @Post('checkout/payments/:id/cancel')
  cancelQr(@Param('id', paymentIdPipe) id: string): Promise<PosQrPaymentResponse> {
    return this.qr.cancel(id);
  }

  @Get('checkout')
  current(): Promise<PosCheckoutResponse> {
    return this.checkout.current();
  }

  @Post('checkout/items')
  addItem(@Body(bodyPipe) body: AddPosCheckoutItemDto): Promise<PosCheckoutResponse> {
    return this.checkout.addItem(body);
  }

  @Patch('checkout/items/:id')
  updateItem(@Param('id', itemIdPipe) id: string, @Body(bodyPipe) body: UpdatePosCheckoutItemDto): Promise<PosCheckoutResponse> {
    return this.checkout.updateItem(id, body);
  }

  @Delete('checkout/items/:id')
  removeItem(@Param('id', itemIdPipe) id: string): Promise<PosCheckoutResponse> {
    return this.checkout.removeItem(id);
  }
}
