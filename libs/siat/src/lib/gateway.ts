import type { PointOfSaleRef, ServiceMessage } from './types';

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

/** What is sent to reception for one credit and debit note (HU-FAC-12). */
export interface SiatCreditNoteSubmission {
  cuf: string;
  number: number;
  issuedAt: Date;
  issuerNit: string;
  customer: InvoiceCustomer;
  /** What the note credits. Decimal string, 2 places. */
  total: string;
  /** CUF of the invoice the note corrects: the SIN must hold it as valid. */
  invoiceCuf: string;
  reasonCode: number;
  xml: string;
  /** The original invoice went with an approved NIT exception, so the note goes with it too. */
  nitException: boolean;
}

/** A daily code (CUFD) of a point of sale: invoices are numbered and their CUF closed with its control code. */
export interface SiatCufd {
  code: string;
  controlCode: string;
  address: string;
  expiresAt: Date;
}

/** The system start code (CUIS) of a point of sale. */
export interface SiatCuis {
  code: string;
  expiresAt: Date;
}

/** The SIN parametric tables the ERP syncs (`sincronizar*`), by the name the ERP stores them under. */
export const SIAT_CATALOG_NAMES = ['ACTIVITY', 'LEGEND', 'PRODUCT_SERVICE', 'UNIT_OF_MEASURE', 'CANCELLATION_REASON', 'CREDIT_NOTE_REASON', 'POINT_OF_SALE_TYPE'] as const;
export type SiatCatalogName = (typeof SIAT_CATALOG_NAMES)[number];

export interface SiatCatalogRow {
  code: string;
  description: string;
  /** The economic activity a legend or a product belongs to; absent for the tables that have none. */
  activityCode?: string;
}

export type SiatCatalogs = Record<SiatCatalogName, SiatCatalogRow[]>;

/** What is asked to register a new point of sale in the SIN. */
export interface SiatPointOfSaleRegistration {
  branchCode: number;
  name: string;
  /** SIN point-of-sale type (catalogue `POINT_OF_SALE_TYPE`). */
  typeCode: number;
  /** Codes the company already holds for this branch: the SIN never hands one out twice. */
  knownCodes: readonly number[];
}

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
  /** Reception of a credit and debit note; `invoiceStatus` also answers for the CUF of a note. */
  sendCreditNote(note: SiatCreditNoteSubmission): Promise<SiatSendResult>;
  requestCufd(pointOfSale: PointOfSaleRef): Promise<SiatCufd>;
  requestCuis(pointOfSale: PointOfSaleRef): Promise<SiatCuis>;
  /** Registers a point of sale in the SIN and returns the code it assigned (HU-FAC-24). Asking twice for the same branch and name returns the same code. */
  registerPointOfSale(registration: SiatPointOfSaleRegistration): Promise<{ code: number }>;
  /** Closes a point of sale in the SIN (HU-FAC-24). */
  closePointOfSale(pointOfSale: PointOfSaleRef): Promise<void>;
  /** Reads the parametric tables of the SIN (HU-FAC-25). */
  syncCatalogs(pointOfSale: PointOfSaleRef): Promise<SiatCatalogs>;
}
