import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

/** Errors of quotes and orders (HU-VEN-16, HU-VEN-19). The ERP translates each `code` into Spanish. */
export const quoteErrors = {
  quoteNotFound: () => new NotFoundException({ code: 'QUOTE_NOT_FOUND', message: 'Quote not found' }),
  salesOrderNotFound: () => new NotFoundException({ code: 'SALES_ORDER_NOT_FOUND', message: 'Order not found' }),
  customerNotFound: () => new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' }),
  customerInactive: () => new ConflictException({ code: 'CUSTOMER_INACTIVE', message: 'The customer is inactive' }),
  productNotFound: () => new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
  productInactive: (productId: string) =>
    new ConflictException({ code: 'PRODUCT_INACTIVE', message: 'The product is inactive', details: { productId } }),
  warehouseNotFound: () => new NotFoundException({ code: 'SALES_WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' }),
  warehouseInactive: () => new ConflictException({ code: 'SALES_WAREHOUSE_INACTIVE', message: 'The warehouse is inactive' }),
  quoteEmpty: () => new BadRequestException({ code: 'QUOTE_EMPTY', message: 'The quote needs at least one product' }),
  invalidQuantity: () =>
    new BadRequestException({ code: 'INVALID_QUANTITY', message: 'The quantity must be a whole number of at least 1' }),
  validityInvalid: () => new BadRequestException({ code: 'QUOTE_VALIDITY_INVALID', message: 'The validity is not a valid day' }),
  validityInPast: () => new BadRequestException({ code: 'QUOTE_VALIDITY_IN_PAST', message: 'The validity cannot be in the past' }),
  validityTooFar: () =>
    new BadRequestException({ code: 'QUOTE_VALIDITY_TOO_FAR', message: 'The validity cannot be more than a year away' }),
  notConvertible: (status: string) =>
    new ConflictException({
      code: 'QUOTE_NOT_CONVERTIBLE',
      message: 'Only a draft or a sent quote that has not expired becomes an order',
      details: { status },
    }),
  orderNotCancellable: (status: string) =>
    new ConflictException({ code: 'ORDER_NOT_CANCELLABLE', message: 'The order can no longer be cancelled', details: { status } }),
  /** HU-VEN-17/18 */
  invalidTransition: (status: string) =>
    new ConflictException({ code: 'QUOTE_INVALID_TRANSITION', message: 'The quote cannot do that in its current status', details: { status } }),
  expired: () => new ConflictException({ code: 'QUOTE_EXPIRED', message: 'The quote expired; renew its validity first' }),
  draftExpired: () =>
    new ConflictException({ code: 'QUOTE_DRAFT_EXPIRED', message: 'The validity of this draft has passed; create a new quote' }),
  invalidEmail: () => new BadRequestException({ code: 'INVALID_EMAIL', message: 'The e-mail address is not valid' }),
  phoneInvalid: () => new BadRequestException({ code: 'QUOTE_PHONE_INVALID', message: 'The WhatsApp number is not valid' }),
};
