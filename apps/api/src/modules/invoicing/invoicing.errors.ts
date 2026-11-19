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

  // closing VAT periods (HU-FAC-21)
  periodAlreadyClosed: (period: string) => new ConflictException({ code: 'PERIOD_ALREADY_CLOSED', message: 'The VAT period is already closed', details: { period } }),
  periodNotEnded: (period: string) => new ConflictException({ code: 'PERIOD_NOT_ENDED', message: 'The month of this VAT period has not ended yet', details: { period } }),
  previousPeriodOpen: (previous: string) =>
    new ConflictException({ code: 'PREVIOUS_PERIOD_OPEN', message: 'The previous VAT period is still open: close it first', details: { period: previous } }),
  periodHasPending: (period: string, pending: unknown) =>
    new ConflictException({ code: 'PERIOD_HAS_PENDING', message: 'The VAT period has documents the SIAT has not issued or purchases it observes', details: { period, ...(pending as object) } }),
  periodNotClosed: (period: string) => new ConflictException({ code: 'PERIOD_NOT_CLOSED', message: 'The VAT period is not closed', details: { period } }),
  periodFiled: (period: string) => new ConflictException({ code: 'PERIOD_FILED', message: 'The VAT period is already filed and cannot change', details: { period } }),
  laterPeriodClosed: (later: string) =>
    new ConflictException({ code: 'LATER_PERIOD_CLOSED', message: 'A later VAT period is closed: reopen it first', details: { period: later } }),
  invalidReopen: (errors: string[]) =>
    new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Invalid request', details: errors.map((error) => ({ field: 'reason', error })) }),

  // fiscal configuration (HU-FAC-22…27)
  signatureInvalid: () => new BadRequestException({ code: 'SIGNATURE_INVALID', message: 'The .p12 file or its password is not valid' }),
  signatureExpired: () => new BadRequestException({ code: 'SIGNATURE_EXPIRED', message: 'The digital signature has already expired' }),
  sinCodeUnknown: (field: string) => new ConflictException({ code: 'SIN_CODE_UNKNOWN', message: 'The code is not in the synced SIN catalogue', details: { field } }),
  catalogsNotSynced: () => new ConflictException({ code: 'CATALOGS_NOT_SYNCED', message: 'The SIN catalogues have not been synced yet' }),
  pointOfSaleMissing: () => new ConflictException({ code: 'POINT_OF_SALE_MISSING', message: 'The company has no active point of sale to ask the SIAT with' }),
  pointOfSaleRejected: (details: unknown) => new ConflictException({ code: 'POINT_OF_SALE_REJECTED', message: 'The SIAT did not register the point of sale', details }),
  pointOfSaleExists: () => new ConflictException({ code: 'POINT_OF_SALE_EXISTS', message: 'A point of sale with that code already exists in the branch' }),
  pointOfSaleInUse: () => new ConflictException({ code: 'POINT_OF_SALE_IN_USE', message: 'The point of sale has an open cash shift' }),
  pointOfSaleInactive: () => new ConflictException({ code: 'POINT_OF_SALE_INACTIVE', message: 'The point of sale is already deactivated' }),
  branchNotFound: () => new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'The branch does not exist' }),
  warehouseNotFound: () => new NotFoundException({ code: 'WAREHOUSE_NOT_FOUND', message: 'The warehouse does not exist in that branch' }),
  productNotFound: () => new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'The product does not exist' }),
  catalogNotFound: () => new NotFoundException({ code: 'CATALOG_NOT_FOUND', message: 'The catalogue does not exist' }),
  importHasErrors: (details: unknown) => new ConflictException({ code: 'IMPORT_HAS_ERRORS', message: 'The file has rows with errors: nothing was imported', details }),
  productionRequirementsMissing: (requirements: string[]) =>
    new ConflictException({ code: 'PRODUCTION_REQUIREMENTS_MISSING', message: 'The company is not ready to invoice for real', details: { requirements } }),
  confirmationMismatch: () => new BadRequestException({ code: 'CONFIRMATION_MISMATCH', message: 'The confirmation text does not match' }),
  alreadyProduction: () => new ConflictException({ code: 'ALREADY_PRODUCTION', message: 'The company already invoices in production' }),
};
