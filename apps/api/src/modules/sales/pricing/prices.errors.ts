import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

/** Errors of the price list and the price edit (HU-VEN-26). The ERP translates each `code` into Spanish. */
export const priceErrors = {
  productNotFound: () => new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' }),
  invalidPrice: () =>
    new BadRequestException({ code: 'INVALID_PRICE', message: 'The price must be greater than zero with at most 2 decimals' }),
  unchanged: () => new ConflictException({ code: 'PRICE_UNCHANGED', message: 'The new price is the same as the current one' }),
  /** Someone else changed the price since the editor loaded it. */
  changed: (currentPrice: string) =>
    new ConflictException({ code: 'PRICE_CHANGED', message: 'The price was changed by someone else', details: { currentPrice } }),
  invalidExpectedPrice: () =>
    new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field: 'expectedPrice', code: 'INVALID_PRICE' }] }),
  branchForbidden: () => new ForbiddenException({ code: 'BRANCH_FORBIDDEN', message: 'You cannot see the stock of this branch' }),
  invalidFilter: (field: string) => new BadRequestException({ code: 'INVALID_FILTER', message: 'Invalid filter', details: [{ field }] }),
};
