/**
 * SIAT invoicing (HU-FAC-01…10): which actions each invoice offers, when a rejected invoice may be sent again, the SIN reasons for
 * cancelling, the validation of a NIT exception and of a delivery, and the contracts of the invoicing API. There is no contingency
 * (client rule): an invoice the SIAT could not receive stays `PENDING` ("No facturada en SIAT") until a person issues it again.
 */
import type { Permission } from './permissions';
import { Decimal } from './money';
import { IdentityDocumentType } from './nit';
import { type InvoiceStatus, invoiceMachine } from './state-machine';

export const INVOICE_PAGE_SIZE_DEFAULT = 20;
export const INVOICE_PAGE_SIZE_MAX = 100;
/** Most invoices one bulk issue, download or e-mail takes. */
export const INVOICE_BULK_ISSUE_MAX = 50;
export const INVOICE_BULK_DOWNLOAD_MAX = 100;

export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['PENDING', 'SENDING', 'VALID', 'REJECTED', 'CANCELLATION_PENDING', 'CANCELLED'];

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === 'string' && (INVOICE_STATUSES as readonly string[]).includes(value);
}

/** The legend printed on every purchase-sale invoice (Ley N° 453). The SIN catalogue of legends replaces it in HU-FAC-25. */
export const INVOICE_LEGEND_DEFAULT = 'Ley N° 453: Tienes derecho a recibir información sobre las características y contenidos de los servicios que utilices.';

/** The SIAT answers or not, as the last health check saw it. */
export type SiatConnectionStatus = 'UNKNOWN' | 'ONLINE' | 'OFFLINE';

// ── Row actions (HU-FAC-02) ──

export type InvoiceAction =
  | 'VIEW_DETAIL'
  | 'DOWNLOAD_PDF'
  | 'DOWNLOAD_XML'
  | 'SEND'
  | 'ISSUE'
  | 'ISSUE_CREDIT_NOTE'
  | 'REQUEST_CANCELLATION';

/** The actions the row menu offers for an invoice in `status` to a user holding `permissions`, in menu order. */
export function invoiceActions(status: InvoiceStatus, permissions: Iterable<string>): InvoiceAction[] {
  const granted = new Set<string>(permissions);
  const has = (permission: Permission) => granted.has(permission);
  const actions: InvoiceAction[] = [];
  if (!has('invoicing.invoices.view')) return actions;
  actions.push('VIEW_DETAIL');
  const issued = status === 'VALID' || status === 'CANCELLATION_PENDING' || status === 'CANCELLED';
  if (issued) actions.push('DOWNLOAD_PDF', 'DOWNLOAD_XML', 'SEND');
  if ((status === 'PENDING' || status === 'REJECTED') && has('invoicing.invoices.issue')) actions.push('ISSUE');
  if (status === 'VALID' && has('sales.returns.manage')) actions.push('ISSUE_CREDIT_NOTE');
  if (status === 'VALID' && has('sales.cancellations.request')) actions.push('REQUEST_CANCELLATION');
  return actions;
}

// ── Issuing ──

/** Whether the invoice document can be produced (PDF, XML, delivery): it got a valid answer from the SIAT at some point. */
export function isInvoiceIssued(status: InvoiceStatus): boolean {
  return status === 'VALID' || status === 'CANCELLATION_PENDING' || status === 'CANCELLED';
}

/** Whether a person can still start an issue attempt. */
export function isInvoiceIssuable(status: InvoiceStatus): boolean {
  return invoiceMachine.can(status, 'send') || invoiceMachine.can(status, 'fix');
}

export interface CanResendInput {
  status: InvoiceStatus;
  /** Identity document type of the customer (5 = NIT). Only a NIT needs the SIN to know it. */
  documentType: number;
  nitVerifiedAt: Date | string | null;
  /** An approved NIT exception lets the invoice go with an unverified NIT. */
  nitException: boolean;
}

/**
 * A rejected invoice is sent again only with a NIT the SIN confirmed, or with an approved exception (HU-FAC-07, HU-FAC-08), whatever the format check of `sales.nitVerification` said at the sale. An
 * invoice never sent (`PENDING`) has not been refused by anyone, so its first manual issue needs no verification.
 */
export function canResend(input: CanResendInput): boolean {
  if (input.status === 'PENDING') return true;
  if (input.status !== 'REJECTED') return false;
  if (input.documentType !== IdentityDocumentType.NIT) return true;
  return input.nitException || input.nitVerifiedAt !== null;
}

/** A `SENDING` invoice that has been waiting longer than the timeout was lost with its job and may be issued again. */
export function isStuckSending(lastAttemptAt: Date | null, now: Date, timeoutMinutes: number): boolean {
  if (lastAttemptAt === null) return true;
  return now.getTime() - lastAttemptAt.getTime() >= timeoutMinutes * 60_000;
}

/** The VAT tax credit of an invoice total: 13 %, half up to cents, with `Decimal`. */
export function fiscalDebit(total: Decimal | string): Decimal {
  return Decimal.of(typeof total === 'string' ? total : total.toString()).percent('13');
}

// ── Cancelling in the SIAT (HU-FAC-09, HU-FAC-10) ──

/** The default catalogue of cancellation reasons of the SIN parametric table; HU-FAC-25 replaces it with the synced one. */
export const SIAT_CANCELLATION_REASONS: readonly { code: number; description: string }[] = [
  { code: 1, description: 'Factura mal emitida' },
  { code: 2, description: 'Nota de crédito-débito mal emitida' },
  { code: 3, description: 'Datos de emisión incorrectos' },
  { code: 4, description: 'Factura o nota de crédito-débito devuelta' },
];

/** The SIN code a cancellation reason maps to: `SIN_<n>` carries it, the built-in sale reasons map to the closest SIN reason. */
export function siatCancellationReasonCode(reason: string): number | null {
  const match = /^SIN_(\d+)$/.exec(reason);
  if (match) {
    const code = Number(match[1]);
    return SIAT_CANCELLATION_REASONS.some((r) => r.code === code) ? code : null;
  }
  switch (reason) {
    case 'CUSTOMER_DATA_ERROR':
      return 3;
    case 'ITEMS_OR_PRICES_ERROR':
    case 'SALE_NOT_COMPLETED':
    case 'OTHER':
      return 1;
    default:
      return null;
  }
}

// ── NIT exception (HU-FAC-08) ──

export const NIT_EXCEPTION_REASON_MAX = 500;
export const NIT_EXCEPTION_REASON_MIN = 10;

export type NitExceptionError = 'REASON_REQUIRED' | 'REASON_TOO_SHORT' | 'REASON_TOO_LONG';

/** What is wrong with a NIT exception request; empty when it can be sent. The reason is judged trimmed. */
export function validateNitExceptionRequest(input: { reason: unknown }): NitExceptionError[] {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason === '') return ['REASON_REQUIRED'];
  if (reason.length < NIT_EXCEPTION_REASON_MIN) return ['REASON_TOO_SHORT'];
  if (reason.length > NIT_EXCEPTION_REASON_MAX) return ['REASON_TOO_LONG'];
  return [];
}

// ── Delivery (HU-FAC-06) ──

export const INVOICE_DELIVERY_CHANNELS = ['EMAIL', 'WHATSAPP'] as const;
export type InvoiceDeliveryChannel = (typeof INVOICE_DELIVERY_CHANNELS)[number];

export type InvoiceDeliveryError = 'CHANNEL_INVALID' | 'EMAIL_INVALID' | 'PHONE_INVALID';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A Bolivian mobile: 8 digits starting with 6 or 7, with or without the country code 591. */
const BO_MOBILE = /^(?:591)?[67]\d{7}$/;

export function normalizePhone(value: string): string {
  return value.replace(/[\s+().-]/g, '');
}

/** The WhatsApp number in international form (`591…`), or null when it is not a Bolivian mobile. */
export function whatsappNumber(value: string): string | null {
  const digits = normalizePhone(value);
  if (!BO_MOBILE.test(digits)) return null;
  return digits.startsWith('591') ? digits : `591${digits}`;
}

export function validateInvoiceDelivery(input: { channel: unknown; recipient: unknown }): InvoiceDeliveryError[] {
  if (typeof input.channel !== 'string' || !(INVOICE_DELIVERY_CHANNELS as readonly string[]).includes(input.channel)) return ['CHANNEL_INVALID'];
  const recipient = typeof input.recipient === 'string' ? input.recipient.trim() : '';
  if (input.channel === 'EMAIL') return EMAIL.test(recipient) ? [] : ['EMAIL_INVALID'];
  return whatsappNumber(recipient) === null ? ['PHONE_INVALID'] : [];
}

// ── Total in words (HU-FAC-05) ──

const UNITS = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

function below1000(n: number): string {
  if (n === 100) return 'cien';
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);
  if (rest > 0) {
    if (rest < 30) parts.push(UNITS[rest]);
    else {
      const unit = rest % 10;
      parts.push(unit === 0 ? TENS[Math.floor(rest / 10)] : `${TENS[Math.floor(rest / 10)]} y ${UNITS[unit]}`);
    }
  }
  return parts.join(' ');
}

/** "uno" loses its ending before "mil" and "millones": "veintiún mil", "treinta y un mil". */
const apocope = (words: string): string => words.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un');

/** A whole number from 0 to 999 999 999 in Spanish ("mil doscientos ochenta"). */
export function integerInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new Error(`Cannot write ${n} in words`);
  if (n === 0) return 'cero';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const parts: string[] = [];
  if (millions > 0) parts.push(millions === 1 ? 'un millón' : `${apocope(below1000(millions))} millones`);
  if (thousands > 0) parts.push(thousands === 1 ? 'mil' : `${apocope(below1000(thousands))} mil`);
  if (rest > 0) parts.push(below1000(rest));
  return parts.join(' ');
}

/** The total of an invoice as the SIN asks it printed: "Mil doscientos ochenta 50/100 Bolivianos". */
export function amountInWords(amount: Decimal | string): string {
  const value = Decimal.of(typeof amount === 'string' ? amount : amount.toString()).round(2);
  const [whole, cents = '00'] = value.toString().replace('-', '').split('.');
  const words = integerInWords(Number(whole));
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} ${cents.padEnd(2, '0')}/100 Bolivianos`;
}

// ── Contracts ──

export interface InvoiceListQuery {
  q?: string;
  status?: InvoiceStatus;
  /** `YYYY-MM-DD` La Paz days, inclusive. */
  from?: string;
  to?: string;
  branchId?: string;
  page?: number;
  pageSize?: number;
}

export interface InvoiceListItem {
  id: string;
  /** Null until the first attempt to send takes a number. */
  number: number | null;
  status: InvoiceStatus;
  saleId: string;
  saleNumber: string;
  customerName: string;
  customerDocumentNumber: string;
  total: string;
  /** When the SIAT accepted it; null before. */
  issuedAt: string | null;
  createdAt: string;
  branchId: string | null;
  rejectionMessage: string | null;
  /** Actions the caller may take; computed from the status and the caller's permissions. */
  actions: InvoiceAction[];
}

export interface InvoiceListKpis {
  issuedToday: { count: number; total: string };
  /** Invoices still `PENDING`: they await a manual issue. */
  notIssued: number;
  rejected: number;
  cancellationsPending: number;
}

export interface InvoiceListResponse {
  items: InvoiceListItem[];
  total: number;
  page: number;
  pageSize: number;
  /** Sum of the totals of every invoice matching the filters. */
  totalAmount: string;
  kpis: InvoiceListKpis;
}

export interface InvoiceDetailLine {
  /** The manufacturer code printed next to the product. */
  code: string;
  description: string;
  quantity: number;
  unitPrice: string;
  total: string;
}

export interface InvoiceHistoryEntry {
  at: string;
  action: string;
  actor: string | null;
  detail: string | null;
}

export interface InvoiceDetail extends InvoiceListItem {
  cuf: string | null;
  siatReceptionCode: string | null;
  rejectionCode: number | null;
  customerDocumentType: number;
  customerComplement: string | null;
  nitVerifiedAt: string | null;
  nitException: boolean;
  pendingNitException: boolean;
  modality: string | null;
  pointOfSale: string | null;
  legend: string | null;
  verificationUrl: string | null;
  branchName: string | null;
  /** The sale's open cancellation request, while the invoice is still valid waiting for Management (FS-12). */
  pendingCancellation: { requestedBy: string | null; requestedAt: string } | null;
  lines: InvoiceDetailLine[];
  payments: { method: string; amount: string }[];
  history: InvoiceHistoryEntry[];
  cancellationReasonCode: number | null;
  cancelledAt: string | null;
  lastError: string | null;
}

/** `GET invoicing/status`: what the shell shows and the notification watches. */
export interface InvoicingStatus {
  connection: SiatConnectionStatus;
  checkedAt: string | null;
  notIssued: number;
  rejected: number;
}

/** One cancellation waiting for Management, as the invoicing inbox lists it (FS-18). */
export interface InvoiceCancellationItem {
  saleId: string;
  saleNumber: string;
  invoiceId: string;
  /** Null for an invoice that never got a number. */
  invoiceNumber: number | null;
  invoiceStatus: InvoiceStatus;
  customerName: string;
  total: string;
  /** `SIN_<code>` when asked from an invoice, or one of the sale reasons. */
  reason: string;
  comment: string;
  requestedBy: string;
  requestedAt: string;
}

export interface InvoiceCancellationsResponse {
  items: InvoiceCancellationItem[];
}

export interface InvoiceBulkResult {
  id: string;
  ok: boolean;
  code?: string;
}
