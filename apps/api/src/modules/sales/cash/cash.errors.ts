import { Prisma } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  PayloadTooLargeException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

/** Errors of the cash register opening (HU-VEN-01). The ERP translates each `code` into Spanish. */
export const cashErrors = {
  registerNotFound: () => new NotFoundException({ code: 'CASH_REGISTER_NOT_FOUND', message: 'Cash register not found' }),
  registerInactive: () => new ConflictException({ code: 'CASH_REGISTER_INACTIVE', message: 'The cash register is inactive' }),
  branchForbidden: () =>
    new ForbiddenException({ code: 'CASH_REGISTER_BRANCH_FORBIDDEN', message: 'You cannot operate the branch of this cash register' }),
  registerAlreadyOpen: () =>
    new ConflictException({ code: 'CASH_REGISTER_ALREADY_OPEN', message: 'This cash register already has an open shift' }),
  alreadyOpenForUser: () =>
    new ConflictException({ code: 'CASH_SHIFT_ALREADY_OPEN_FOR_USER', message: 'You already have an open shift in another cash register' }),
  invalidOpeningFloat: (reason: string) =>
    new BadRequestException({ code: 'INVALID_OPENING_FLOAT', message: 'The opening float is not a valid amount', details: { reason } }),
  shiftNotOpen: () => new ConflictException({ code: 'CASH_SHIFT_NOT_OPEN', message: 'There is no open cash shift' }),
};

/**
 * Maps a unique index violation of `cash_shifts` to its error: the per-user index (`opened_by_id`) or, otherwise, the
 * per-register one. Any other error is returned as it is. This is the safety net behind the pre-checks of `open`.
 */
export function mapCashUniqueViolation(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return JSON.stringify(err.meta ?? {}).includes('opened_by_id') ? cashErrors.alreadyOpenForUser() : cashErrors.registerAlreadyOpen();
  }
  return err;
}

/** Errors of the cash movements and the closing of a shift (HU-VEN-22 and HU-VEN-23). */
export const cashMovementErrors = {
  idempotencyKeyRequired: () => new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'The Idempotency-Key header is required' }),
  idempotencyKeyReused: () => new ConflictException({ code: 'CASH_MOVEMENT_KEY_REUSED', message: 'That Idempotency-Key was used for another cash movement' }),
  shiftNotFound: () => new NotFoundException({ code: 'CASH_SHIFT_NOT_FOUND', message: 'Cash shift not found' }),
  shiftNotOwned: () => new ForbiddenException({ code: 'CASH_SHIFT_NOT_OWNED', message: 'This cash shift belongs to another cashier' }),
  movementNotFound: () => new NotFoundException({ code: 'CASH_MOVEMENT_NOT_FOUND', message: 'Cash movement not found' }),
  movementNotOwned: () => new ForbiddenException({ code: 'CASH_MOVEMENT_NOT_OWNED', message: 'Only who registered the movement can withdraw it' }),
  movementNotPending: () => new ConflictException({ code: 'CASH_MOVEMENT_NOT_PENDING', message: 'The expense is no longer waiting for approval' }),
  expenseExceedsCash: (expected: string, amount: string) =>
    new UnprocessableEntityException({
      code: 'CASH_EXPENSE_EXCEEDS_CASH',
      message: 'The expense is larger than the cash in the register',
      details: { expected, amount },
    }),
  receiptNotFound: () => new NotFoundException({ code: 'RECEIPT_NOT_FOUND', message: 'This movement has no receipt' }),
  invalidReceipt: () => new UnsupportedMediaTypeException({ code: 'INVALID_RECEIPT_FILE', message: 'The receipt must be a JPG, PNG, WebP or PDF file' }),
  receiptTooLarge: () => new PayloadTooLargeException({ code: 'RECEIPT_TOO_LARGE', message: 'The receipt is larger than 5 MB' }),
  decisionCommentRequired: () =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request',
      details: [{ field: 'comment', code: 'COMMENT_REQUIRED' }],
    }),
  hasPendingExpenses: (count: number) =>
    new ConflictException({
      code: 'CASH_SHIFT_HAS_PENDING_EXPENSES',
      message: 'Withdraw or resolve the expenses waiting for approval before closing',
      details: { count },
    }),
  hasPendingPayments: (count: number) =>
    new ConflictException({
      code: 'CASH_SHIFT_HAS_PENDING_PAYMENTS',
      message: 'A QR or card payment of this shift is still waiting',
      details: { count },
    }),
};

/** Errors of the review of a closing and of the shift history (HU-VEN-24, HU-VEN-25). */
export const cashReviewErrors = {
  shiftNotClosed: (status: string) =>
    new ConflictException({ code: 'CASH_SHIFT_NOT_CLOSED', message: 'Only a closed shift waiting for review can be decided', details: { status } }),
  selfReview: () => new ForbiddenException({ code: 'CASH_SHIFT_SELF_REVIEW', message: 'You cannot review your own cash shift' }),
  commentRequired: () => new BadRequestException({ code: 'REVIEW_COMMENT_REQUIRED', message: 'Asking for a recount needs a comment' }),
  commentTooLong: () => new BadRequestException({ code: 'REVIEW_COMMENT_TOO_LONG', message: 'The comment is too long' }),
  invalidFilter: (field: string) => new BadRequestException({ code: 'INVALID_FILTER', message: 'Invalid filter', details: [{ field }] }),
};

const FIELD_ERROR_STATUS: Record<string, 'bad-request' | 'conflict'> = {
  INVALID_CASH_TYPE: 'bad-request',
  INVALID_CASH_AMOUNT: 'bad-request',
  INVALID_CASH_CONCEPT: 'bad-request',
  CASH_DETAIL_REQUIRED: 'bad-request',
  CASH_DETAIL_TOO_LONG: 'bad-request',
  INVALID_DENOMINATION: 'bad-request',
  INVALID_COUNT: 'bad-request',
  CLOSING_FLOAT_EXCEEDS_COUNTED: 'conflict',
  CLOSING_COMMENT_REQUIRED: 'conflict',
  CLOSING_COMMENT_TOO_LONG: 'bad-request',
};

const FIELD_ERROR_MESSAGE: Record<string, string> = {
  INVALID_CASH_TYPE: 'The movement type must be INCOME or EXPENSE',
  INVALID_CASH_AMOUNT: 'The amount must be greater than zero with at most 2 decimals',
  INVALID_CASH_CONCEPT: 'The concept is not valid for this type of movement',
  CASH_DETAIL_REQUIRED: 'The concept "other" needs a detail',
  CASH_DETAIL_TOO_LONG: 'The detail is too long',
  INVALID_DENOMINATION: 'A denomination is not one of the bills and coins that are counted, or is repeated',
  INVALID_COUNT: 'A quantity must be a whole number of zero or more',
  CLOSING_FLOAT_EXCEEDS_COUNTED: 'The cash left in the register cannot be more than the cash counted',
  CLOSING_COMMENT_REQUIRED: 'A difference needs a justification',
  CLOSING_COMMENT_TOO_LONG: 'The justification is too long',
};

/**
 * The domain's code for a rejected movement or closing as the HTTP error with that same `code`. The state ones (a float larger
 * than the count, a missing justification) are conflicts with what the cashier typed; the format ones are bad requests.
 */
export function cashRuleError(code: string, all: readonly string[] = [code]): BadRequestException | ConflictException {
  const body = { code, message: FIELD_ERROR_MESSAGE[code] ?? 'Invalid request', details: { errors: all } };
  return FIELD_ERROR_STATUS[code] === 'conflict' ? new ConflictException(body) : new BadRequestException(body);
}

/** `P2002` on the `(company_id, idempotency_key)` unique index of `cash_movements`. */
export function isCashMovementKeyConflict(err: unknown): boolean {
  const known = err as { code?: string; meta?: { target?: unknown } };
  return known?.code === 'P2002' && JSON.stringify(known.meta?.target ?? '').includes('idempotency_key');
}
