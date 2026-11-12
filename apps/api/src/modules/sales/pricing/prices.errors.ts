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

  // bulk update (HU-VEN-27)
  filterRequired: () =>
    new BadRequestException({ code: 'BULK_FILTER_REQUIRED', message: 'Choose a brand or a category: a bulk update never changes every product' }),
  invalidPercent: () =>
    new BadRequestException({ code: 'INVALID_PERCENT', message: 'The percent must be above zero with at most 2 decimals; a decrease stays below 100' }),
  invalidAdjustment: (field: string) =>
    new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field }] }),
  tooManyProducts: (matched: number, max: number) =>
    new BadRequestException({ code: 'BULK_TOO_MANY_PRODUCTS', message: 'The filter matches too many products for one update', details: { matched, max } }),
  /** A price or a product changed between the preview and the apply, or the apply came without the preview. */
  previewStale: () =>
    new ConflictException({ code: 'BULK_PREVIEW_STALE', message: 'The prices changed since the preview: review it again before applying' }),
  nothingToChange: () => new ConflictException({ code: 'BULK_NOTHING_TO_CHANGE', message: 'No product would change its price' }),
  approvalRequired: () =>
    new ConflictException({ code: 'BULK_PRICE_APPROVAL_REQUIRED', message: 'A bulk price update needs approval and the approval flow is not available yet' }),
};
