import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PosPriceChange } from '@rodasoft/domain';

/** Errors of the POS search and cart (HU-VEN-02). The ERP translates each `code` into Spanish. */
export const posErrors = {
  productNotFound: () => new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
  productInactive: () => new ConflictException({ code: 'PRODUCT_INACTIVE', message: 'The product is inactive' }),
  invalidQuantity: () =>
    new BadRequestException({ code: 'INVALID_QUANTITY', message: 'The quantity must be a whole number of at least 1' }),
  insufficientStock: (available: number) =>
    new ConflictException({ code: 'INSUFFICIENT_STOCK', message: 'Not enough stock in the register warehouse', details: { available } }),
  itemNotFound: () => new NotFoundException({ code: 'CHECKOUT_ITEM_NOT_FOUND', message: 'Cart line not found' }),
  notEditable: () => new ConflictException({ code: 'CHECKOUT_NOT_EDITABLE', message: 'The cart can no longer be edited' }),
  // --- payment and completing the sale (HU-VEN-07, HU-VEN-11) ---
  invalidTransition: (from: string, event: string) =>
    new ConflictException({ code: 'INVALID_TRANSITION', message: `Transition not allowed: "${event}" from "${from}"`, details: { from, event } }),
  idempotencyKeyReused: () =>
    new ConflictException({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'This payment key already belongs to another sale' }),
  checkoutNotFound: () => new NotFoundException({ code: 'CHECKOUT_NOT_FOUND', message: 'There is no sale in progress' }),
  checkoutEmpty: () => new ConflictException({ code: 'CHECKOUT_EMPTY', message: 'The sale has no products' }),
  checkoutNotPaying: () => new ConflictException({ code: 'CHECKOUT_NOT_PAYING', message: 'The sale is not waiting for payment' }),
  pricesChanged: (lines: PosPriceChange[]) =>
    new ConflictException({ code: 'CHECKOUT_PRICES_CHANGED', message: 'Some prices changed; the cart was updated', details: { lines } }),
  totalChanged: (expected: string, actual: string) =>
    new ConflictException({ code: 'CHECKOUT_TOTAL_CHANGED', message: 'The total is not the one shown to the cashier', details: { expected, actual } }),
  insufficientCash: (total: string) =>
    new ConflictException({ code: 'INSUFFICIENT_CASH', message: 'The cash received does not cover the total', details: { total } }),
  invalidAmount: () => new BadRequestException({ code: 'INVALID_AMOUNT', message: 'The amount is not valid (at most 2 decimals)' }),
  amountTooLarge: () => new BadRequestException({ code: 'AMOUNT_TOO_LARGE', message: 'The amount is too large' }),
  paymentMethodNotAvailable: () =>
    new ConflictException({ code: 'PAYMENT_METHOD_NOT_AVAILABLE', message: 'Only cash and QR payments, alone or mixed, are available for now' }),
  // --- QR payment (HU-VEN-08) ---
  invalidPayment: (field: string) =>
    new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field }] }),
  paymentNotFound: () => new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment not found' }),
  paymentNotConfirmed: (status: string) =>
    new ConflictException({ code: 'PAYMENT_NOT_CONFIRMED', message: 'The payment is not confirmed', details: { status } }),
  paymentInvalidState: (status: string) =>
    new ConflictException({ code: 'PAYMENT_INVALID_STATE', message: `The payment is already ${status.toLowerCase()}`, details: { status } }),
  paymentAlreadyConfirmed: () =>
    new ConflictException({ code: 'PAYMENT_ALREADY_CONFIRMED', message: 'A confirmed payment cannot be dropped: finish the sale' }),
  qrAlreadyPending: () => new ConflictException({ code: 'QR_ALREADY_PENDING', message: 'This sale already waits for a QR payment' }),
  qrExpired: () => new ConflictException({ code: 'QR_EXPIRED', message: 'The QR expired and was cancelled' }),
  // --- mixed payment (HU-VEN-09) ---
  mixedPaymentDisabled: () =>
    new ConflictException({ code: 'MIXED_PAYMENT_DISABLED', message: 'Mixed payment is turned off for this company' }),
  paymentNotCovered: (total: string) =>
    new ConflictException({ code: 'PAYMENT_NOT_COVERED', message: 'The payments do not add up to the total', details: { total } }),
  paymentInvalidAmount: () =>
    new BadRequestException({ code: 'PAYMENT_INVALID_AMOUNT', message: 'A payment amount must be above zero' }),
  paymentDuplicateMethod: () =>
    new BadRequestException({ code: 'PAYMENT_DUPLICATE_METHOD', message: 'A sale takes one payment per method' }),
  qrAmountInvalid: (total: string) =>
    new BadRequestException({ code: 'QR_AMOUNT_INVALID', message: 'The QR amount must be above zero and not exceed the total', details: { total } }),
  insufficientStockFor: (productId: string, available: number) =>
    new ConflictException({ code: 'INSUFFICIENT_STOCK', message: 'Not enough stock in the register warehouse', details: { productId, available } }),
  saleNotFound: () => new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Sale not found' }),
  invalidEmail: () => new BadRequestException({ code: 'INVALID_EMAIL', message: 'The e-mail address is not valid' }),
};

/** Upper bound of a line quantity: keeps a typo from becoming an absurd order. */
export const MAX_LINE_QUANTITY = 99_999;

export function assertQuantity(quantity: unknown): asserts quantity is number {
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
    throw posErrors.invalidQuantity();
  }
}
