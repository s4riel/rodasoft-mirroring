import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

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
};

/** Upper bound of a line quantity: keeps a typo from becoming an absurd order. */
export const MAX_LINE_QUANTITY = 99_999;

export function assertQuantity(quantity: unknown): asserts quantity is number {
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) {
    throw posErrors.invalidQuantity();
  }
}
