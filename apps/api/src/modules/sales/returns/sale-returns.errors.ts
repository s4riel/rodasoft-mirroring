import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { ReturnDecisionError, ReturnFieldError, ReturnIssue } from '@rodasoft/domain';

/** Errors of returns (HU-VEN-21). The ERP translates each `code` into Spanish. */
export const returnErrors = {
  idempotencyKeyRequired: () =>
    new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'The Idempotency-Key header is required' }),
  idempotencyKeyReused: () =>
    new ConflictException({ code: 'RETURN_KEY_REUSED', message: 'That Idempotency-Key was used for another return' }),
  invalid: (errors: ReturnFieldError[]) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request',
      details: errors.map((error) => ({ field: fieldOf(error), error })),
    }),
  invalidDecision: (errors: ReturnDecisionError[]) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request',
      details: errors.map((error) => ({ field: 'comment', error })),
    }),
  saleNotFound: () => new NotFoundException({ code: 'SALE_NOT_FOUND', message: 'Sale not found' }),
  returnNotFound: () => new NotFoundException({ code: 'RETURN_NOT_FOUND', message: 'Return not found' }),
  saleNotReturnable: (status: string) =>
    new ConflictException({ code: 'SALE_NOT_RETURNABLE', message: 'This sale cannot be returned in its current status', details: { status } }),
  windowExpired: (endedAt: string) =>
    new ConflictException({ code: 'RETURN_WINDOW_EXPIRED', message: 'The deadline to return this sale has passed', details: { endedAt } }),
  empty: () => new BadRequestException({ code: 'RETURN_EMPTY', message: 'Choose at least one piece to return' }),
  itemNotFound: (saleItemId?: string) =>
    new NotFoundException({ code: 'SALE_ITEM_NOT_FOUND', message: 'The line does not belong to the sale', details: { saleItemId } }),
  invalidQuantity: (saleItemId?: string) =>
    new BadRequestException({ code: 'INVALID_QUANTITY', message: 'The quantity must be a whole number of at least 1', details: { saleItemId } }),
  invalidCondition: (saleItemId?: string) =>
    new BadRequestException({ code: 'INVALID_CONDITION', message: 'The condition must be RESTOCK or SCRAP', details: { saleItemId } }),
  exceedsSold: (items: { saleItemId: string; requested: number; returnable: number }[]) =>
    new ConflictException({
      code: 'RETURN_EXCEEDS_SOLD',
      message: 'The return asks for more than what was sold and not yet returned',
      details: { items },
    }),
  storeCreditNeedsCustomer: () =>
    new BadRequestException({ code: 'STORE_CREDIT_NEEDS_CUSTOMER', message: 'Store credit needs an identified customer on the sale' }),
  totalInvalid: () => new ConflictException({ code: 'RETURN_TOTAL_INVALID', message: 'The amount to refund for this return is not valid' }),
  notPending: () => new ConflictException({ code: 'RETURN_NOT_PENDING', message: 'This return is not waiting for a decision' }),
  /** The refund has to leave a register, and the register that asked for it has no open shift. */
  refundShiftNotOpen: (registerName: string) =>
    new ConflictException({
      code: 'CASH_SHIFT_NOT_OPEN_FOR_REFUND',
      message: 'The cash register that asked for the return has no open shift to register the refund',
      details: { registerName },
    }),
  warehouseInactive: (warehouseName: string) =>
    new ConflictException({
      code: 'WAREHOUSE_INACTIVE',
      message: 'The warehouse of the sale is inactive and cannot receive the pieces',
      details: { warehouseName },
    }),
  hasReturns: () =>
    new ConflictException({ code: 'SALE_HAS_RETURNS', message: 'A sale with returns cannot be cancelled' }),
};

function fieldOf(error: ReturnFieldError): string {
  switch (error) {
    case 'REASON_INVALID':
      return 'reason';
    case 'REFUND_METHOD_INVALID':
      return 'refundMethod';
    case 'COMMENT_TOO_LONG':
      return 'comment';
    default:
      return 'refundReference';
  }
}

/** The error of the first problem the lines of a return have (every `RETURN_EXCEEDS_SOLD` line goes in one error). */
export function returnIssueError(issues: readonly ReturnIssue[]): Error {
  const exceeds = issues.filter((i) => i.code === 'RETURN_EXCEEDS_SOLD');
  if (exceeds.length > 0) {
    return returnErrors.exceedsSold(exceeds.map((i) => ({ saleItemId: i.saleItemId ?? '', requested: i.requested ?? 0, returnable: i.returnable ?? 0 })));
  }
  const [first] = issues;
  switch (first.code) {
    case 'RETURN_EMPTY':
      return returnErrors.empty();
    case 'SALE_ITEM_NOT_FOUND':
      return returnErrors.itemNotFound(first.saleItemId);
    case 'INVALID_QUANTITY':
      return returnErrors.invalidQuantity(first.saleItemId);
    default:
      return returnErrors.invalidCondition(first.saleItemId);
  }
}
