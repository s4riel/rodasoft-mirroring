import type { Customer } from '@prisma/client';
import { FINAL_CONSUMER, validateInvoiceDocument, type PosInvoiceDataResponse } from '@rodasoft/domain';
import { customerErrors } from '../customers/customers.errors';

/**
 * The tax data an invoice carries (HU-VEN-05): the customer's document, checked, or a final consumer when the sale has no
 * customer (decision #4). An inactive customer or an invalid document stops the sale before it is paid.
 */
export function invoiceDataOf(customer: Customer | null | undefined): PosInvoiceDataResponse {
  if (!customer) return { ...FINAL_CONSUMER, finalConsumer: true };
  if (customer.status !== 'ACTIVE') throw customerErrors.inactive();
  const document = validateInvoiceDocument(customer.documentType, customer.documentNumber, customer.complement);
  if (!document.valid) throw customerErrors.invalidNit(document.error);
  return {
    name: customer.name,
    documentType: customer.documentType,
    documentNumber: document.documentNumber,
    complement: document.complement,
    finalConsumer: false,
  };
}
