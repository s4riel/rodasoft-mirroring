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

  // credit and debit notes (HU-FAC-11, HU-FAC-12)
  noteNotFound: () => new NotFoundException({ code: 'CREDIT_NOTE_NOT_FOUND', message: 'The credit note does not exist' }),
  priceAdjustmentNotAllowed: () =>
    new ConflictException({ code: 'PRICE_ADJUSTMENT_NOT_ALLOWED', message: 'This company only issues credit notes from a return' }),
  invoiceNotCreditable: (status: string) =>
    new ConflictException({ code: 'INVOICE_NOT_CREDITABLE', message: 'Only an invoice the SIAT holds as valid can be credited', details: { status } }),
  creditExceedsInvoiced: (details: unknown) =>
    new ConflictException({ code: 'CREDIT_EXCEEDS_INVOICED', message: 'The note credits more than what is left of the invoice', details }),
  invalidNote: (details: unknown) => new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details }),
  noteNotIssuable: (status: string) =>
    new ConflictException({ code: 'NOTE_NOT_ISSUABLE', message: 'The credit note cannot be issued in its current state', details: { status } }),
  noteAlreadySending: () => new ConflictException({ code: 'NOTE_ALREADY_SENDING', message: 'The credit note is being sent to the SIAT right now' }),
  noteNotVoidable: (status: string) =>
    new ConflictException({ code: 'NOTE_NOT_VOIDABLE', message: 'Only a note the SIAT never validated can be voided', details: { status } }),
  noteNotIssued: () => new ConflictException({ code: 'NOTE_NOT_ISSUED', message: 'The credit note has not been issued by the SIAT yet' }),

  // system status (HU-FAC-13)
  pointOfSaleNotFound: () => new NotFoundException({ code: 'POINT_OF_SALE_NOT_FOUND', message: 'The point of sale does not exist' }),

  // VAT books (HU-FAC-18, HU-FAC-19, HU-FAC-20)
  invalidBookQuery: (field: string, error: string) =>
    new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: [{ field, error }] }),
  purchaseEntryNotFound: () => new NotFoundException({ code: 'PURCHASE_ENTRY_NOT_FOUND', message: 'The purchase entry does not exist' }),
};
