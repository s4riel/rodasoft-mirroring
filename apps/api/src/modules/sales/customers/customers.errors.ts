import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { CustomerSummary, DocumentErrorKind } from '@rodasoft/domain';

/** Errors of the customers and the customer of the POS cart (HU-VEN-05, HU-VEN-37). The ERP translates each `code` into Spanish. */
export const customerErrors = {
  notFound: () => new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' }),
  inactive: () => new ConflictException({ code: 'CUSTOMER_INACTIVE', message: 'The customer is inactive' }),
  invalidNit: (reason: DocumentErrorKind) =>
    new BadRequestException({ code: 'INVALID_NIT', message: 'The identity document is not valid for invoicing', details: { reason } }),
  invalidDiscount: () =>
    new BadRequestException({
      code: 'INVALID_DISCOUNT',
      message: 'The discount must be none, a percent above 0 up to 100, or a positive amount in Bs',
    }),
  /** Carries the customer that already has the document, so the POS can offer to use it. */
  documentDuplicated: (customer: CustomerSummary | null) =>
    new ConflictException({
      code: 'CUSTOMER_DOCUMENT_DUPLICATED',
      message: 'A customer with this document already exists',
      details: customer ? { customer } : undefined,
    }),
};
