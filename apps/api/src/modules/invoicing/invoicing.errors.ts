import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

/** Errors of the invoicing module (HU-FAC-01…10). The ERP translates each `code` into Spanish. */
export const invoicingErrors = {
  notFound: () => new NotFoundException({ code: 'INVOICE_NOT_FOUND', message: 'The invoice does not exist' }),
  notIssuable: (status: string) =>
    new ConflictException({ code: 'INVOICE_NOT_ISSUABLE', message: 'The invoice cannot be issued in its current state', details: { status } }),
  alreadySending: () => new ConflictException({ code: 'INVOICE_ALREADY_SENDING', message: 'The invoice is being sent to the SIAT right now' }),
  notEditable: (status: string) =>
    new ConflictException({ code: 'INVOICE_NOT_EDITABLE', message: 'The customer of this invoice can no longer be changed', details: { status } }),
  invalidNit: (error: string) =>
    new BadRequestException({
      code: 'INVALID_NIT',
      message: 'The identity document of the customer is not valid',
      details: [{ field: 'documentNumber', error }],
    }),
  nitNotVerified: () =>
    new ConflictException({ code: 'NIT_NOT_VERIFIED', message: 'The NIT must be verified with the SIN (or have an approved exception) before sending again' }),
  siatUnavailable: () => new ServiceUnavailableException({ code: 'SIAT_UNAVAILABLE', message: 'The SIAT does not answer right now' }),
  notIssued: () => new ConflictException({ code: 'INVOICE_NOT_ISSUED', message: 'The invoice has not been issued by the SIAT yet' }),
  invalidDelivery: (details: { field: string; error: string }[]) =>
    new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details }),
  invalidReason: (field: string, error: string) =>
    new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field, error }] }),
  nitExceptionDisabled: () =>
    new ConflictException({ code: 'NIT_EXCEPTION_DISABLED', message: 'This company does not allow issuing with an unverified NIT' }),
  nitExceptionAlreadyPending: () =>
    new ConflictException({ code: 'NIT_EXCEPTION_ALREADY_PENDING', message: 'This invoice already has an exception request waiting for a decision' }),
  nitExceptionAlreadyApproved: () =>
    new ConflictException({ code: 'NIT_EXCEPTION_ALREADY_APPROVED', message: 'This invoice already has an approved NIT exception' }),
  nitExceptionNotPending: () =>
    new ConflictException({ code: 'NIT_EXCEPTION_NOT_PENDING', message: 'This invoice has no exception request waiting for a decision' }),
  invalidReasonCode: () =>
    new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field: 'reasonCode', error: 'REASON_INVALID' }] }),
  invalidFilter: (message: string) => new BadRequestException({ code: 'INVALID_FILTER', message }),
};
