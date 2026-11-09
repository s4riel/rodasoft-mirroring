import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { CancellationDecisionError, CancellationRequestError } from '@rodasoft/domain';

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
  fromOrder: () =>
    new ConflictException({
      code: 'SALE_FROM_ORDER_NOT_CANCELLABLE',
      message: 'A sale invoiced from an order dispatch cannot be cancelled here',
    }),
  alreadyPending: () =>
    new ConflictException({ code: 'CANCELLATION_ALREADY_PENDING', message: 'This sale already has a cancellation request waiting for a decision' }),
  windowExpired: (endedAt: string) =>
    new ConflictException({
      code: 'CANCELLATION_WINDOW_EXPIRED',
      message: 'The deadline to cancel this sale has passed',
      details: { endedAt },
    }),
  notPending: () => new ConflictException({ code: 'CANCELLATION_NOT_PENDING', message: 'This sale has no cancellation request waiting for a decision' }),
  invalidDecision: (errors: CancellationDecisionError[]) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Invalid request',
      details: errors.map((error) => ({ field: 'comment', error })),
    }),
  /** The refund has to leave the register, and the register of the sale has no open shift to take it. */
  refundShiftNotOpen: (registerName: string) =>
    new ConflictException({
      code: 'CASH_SHIFT_NOT_OPEN_FOR_REFUND',
      message: 'The cash register of the sale has no open shift to register the refund',
      details: { registerName },
    }),
  /** The goods go back to the warehouse of the sale; an inactive one cannot receive stock, so Management must reactivate it. */
  warehouseInactive: (warehouseName: string) =>
    new ConflictException({
      code: 'CANCELLATION_WAREHOUSE_INACTIVE',
      message: 'The warehouse of the sale is inactive and cannot receive the stock back',
      details: { warehouseName },
    }),
  invoiceNotCancellable: (status: string) =>
    new ConflictException({ code: 'INVOICE_NOT_CANCELLABLE', message: 'The invoice of this sale cannot be cancelled in its current state', details: { status } }),
  withdrawForbidden: () =>
    new ForbiddenException({ code: 'CANCELLATION_WITHDRAW_FORBIDDEN', message: 'Only who asked for the cancellation, or who may approve it, can withdraw it' }),
};
