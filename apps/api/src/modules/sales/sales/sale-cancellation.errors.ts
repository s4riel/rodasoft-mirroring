import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { CancellationRequestError } from '@rodasoft/domain';

/** Errors of the cancellation request of a sale (HU-VEN-14). The ERP translates each `code` into Spanish. */
export const cancellationErrors = {
  invalid: (errors: CancellationRequestError[]) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request',
      details: errors.map((error) => ({ field: error === 'REASON_INVALID' ? 'reason' : 'comment', error })),
    }),
  notCancellable: (status: string) =>
    new ConflictException({ code: 'SALE_NOT_CANCELLABLE', message: 'This sale can no longer be cancelled', details: { status } }),
  alreadyPending: () =>
    new ConflictException({ code: 'CANCELLATION_ALREADY_PENDING', message: 'This sale already has a cancellation request waiting for a decision' }),
  windowExpired: (endedAt: string) =>
    new ConflictException({
      code: 'CANCELLATION_WINDOW_EXPIRED',
      message: 'The deadline to cancel this sale has passed',
      details: { endedAt },
    }),
  notPending: () => new ConflictException({ code: 'CANCELLATION_NOT_PENDING', message: 'This sale has no cancellation request to withdraw' }),
  withdrawForbidden: () =>
    new ForbiddenException({ code: 'CANCELLATION_WITHDRAW_FORBIDDEN', message: 'Only who asked for the cancellation, or who may approve it, can withdraw it' }),
};
