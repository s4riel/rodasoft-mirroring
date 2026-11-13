import type { ServiceMessage } from './types';

/** The SIAT did not answer (network error, timeout, maintenance). The invoice stays `PENDING`: there is no contingency. */
export class SiatUnavailableError extends Error {
  constructor(message = 'SIAT unavailable') {
    super(message);
    this.name = 'SiatUnavailableError';
  }
}

export interface InvoiceCustomer {
  name: string;
  /** SIN identity document type (5 = NIT). */
  documentType: number;
  documentNumber: string;
  complement: string | null;
}

/** What is sent to reception for one invoice. */
export interface SiatInvoiceSubmission {
  cuf: string;
  number: number;
  issuedAt: Date;
  issuerNit: string;
  customer: InvoiceCustomer;
  /** Decimal string, 2 places. */
  total: string;
  /** Signed XML of the invoice. */
  xml: string;
  /** An approved NIT exception: the SIN accepts the invoice although it does not recognise the customer's NIT (HU-FAC-08). */
  nitException: boolean;
}

export type SiatSendResult =
  | { status: 'ACCEPTED'; receptionCode: string; messages: ServiceMessage[] }
  | { status: 'REJECTED'; code: number; messages: ServiceMessage[] };

export interface SiatNitResult {
  valid: boolean;
  messages: ServiceMessage[];
}

export type SiatInvoiceState = 'UNKNOWN' | 'ACCEPTED' | 'CANCELLED';

export interface SiatInvoiceStatusResult {
  status: SiatInvoiceState;
  receptionCode: string | null;
}

export type SiatCancelResult = { cancelled: true } | { cancelled: false; messages: ServiceMessage[] };

/**
 * The link to the SIAT. Every method except `verifyCommunication` throws `SiatUnavailableError` when the SIAT does not answer,
 * and returns the SIN's own verdict (accepted, rejected, refused) otherwise. Issuing and cancelling run against this port; the
 * real SOAP adapter arrives with HU-FAC-22…26.
 */
export interface SiatGateway {
  verifyCommunication(): Promise<{ success: boolean }>;
  verifyNit(nit: string): Promise<SiatNitResult>;
  sendInvoice(invoice: SiatInvoiceSubmission): Promise<SiatSendResult>;
  invoiceStatus(cuf: string): Promise<SiatInvoiceStatusResult>;
  cancelInvoice(cuf: string, reasonCode: number): Promise<SiatCancelResult>;
}
