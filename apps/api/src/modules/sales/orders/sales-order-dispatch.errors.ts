import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { DispatchIssue } from '@rodasoft/domain';

/** Errors of dispatching an order (HU-VEN-20). The ERP translates each `code` into Spanish. */
export const dispatchErrors = {
  idempotencyKeyRequired: () =>
    new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'The Idempotency-Key header is required' }),
  idempotencyKeyReused: () =>
    new ConflictException({ code: 'DISPATCH_KEY_REUSED', message: 'That Idempotency-Key was used for another order' }),
  notDispatchable: (status: string) =>
    new ConflictException({
      code: 'SALES_ORDER_NOT_DISPATCHABLE',
      message: 'The order cannot be dispatched in its current status',
      details: { status },
    }),
  totalInvalid: () =>
    new ConflictException({ code: 'DISPATCH_TOTAL_INVALID', message: 'The amount left to invoice for this order is not valid' }),
  empty: () => new BadRequestException({ code: 'DISPATCH_EMPTY', message: 'Choose at least one piece to dispatch' }),
  itemNotFound: (orderItemId?: string) =>
    new NotFoundException({ code: 'ORDER_ITEM_NOT_FOUND', message: 'The line does not belong to the order', details: { orderItemId } }),
  invalidQuantity: (orderItemId?: string) =>
    new BadRequestException({ code: 'INVALID_QUANTITY', message: 'The quantity must be a whole number of at least 1', details: { orderItemId } }),
  exceedsReserved: (items: { orderItemId: string; requested: number; dispatchable: number }[]) =>
    new ConflictException({
      code: 'DISPATCH_EXCEEDS_RESERVED',
      message: 'The dispatch asks for more than what is reserved and not dispatched',
      details: { items },
    }),
  partialNotAllowed: () =>
    new UnprocessableEntityException({
      code: 'PARTIAL_DISPATCH_NOT_ALLOWED',
      message: 'This company dispatches an order whole: give everything that is pending',
    }),
};

/** The error of the first problem a dispatch has (every `DISPATCH_EXCEEDS_RESERVED` line goes in one error). */
export function dispatchIssueError(issues: readonly DispatchIssue[]): Error {
  const exceeds = issues.filter((i) => i.code === 'DISPATCH_EXCEEDS_RESERVED');
  if (exceeds.length > 0) {
    return dispatchErrors.exceedsReserved(
      exceeds.map((i) => ({ orderItemId: i.orderItemId ?? '', requested: i.requested ?? 0, dispatchable: i.dispatchable ?? 0 })),
    );
  }
  const [first] = issues;
  switch (first.code) {
    case 'DISPATCH_EMPTY':
      return dispatchErrors.empty();
    case 'ORDER_ITEM_NOT_FOUND':
      return dispatchErrors.itemNotFound(first.orderItemId);
    case 'INVALID_QUANTITY':
      return dispatchErrors.invalidQuantity(first.orderItemId);
    default:
      return dispatchErrors.partialNotAllowed();
  }
}
