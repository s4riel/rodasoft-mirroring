import { Prisma } from '@prisma/client';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

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
