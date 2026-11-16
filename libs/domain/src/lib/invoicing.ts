/**
 * SIAT invoicing (HU-FAC-01…10): which actions each invoice offers, when a rejected invoice may be sent again, the SIN reasons for
 * cancelling, the validation of a NIT exception and of a delivery, and the contracts of the invoicing API. There is no contingency
 * (client rule): an invoice the SIAT could not receive stays `PENDING` ("No facturada en SIAT") until a person issues it again.
 */
import type { VatBookExportFormat, VatBookFormat } from './company-settings';
import { laPazToday } from './kardex';
import type { Permission } from './permissions';
import { Decimal } from './money';
import { IdentityDocumentType } from './nit';
import { type CreditNoteStatus, creditNoteMachine, type InvoiceStatus, invoiceMachine } from './state-machine';

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

// ── Credit and debit notes (HU-FAC-11, HU-FAC-12) ──

export const CREDIT_NOTE_STATUSES: readonly CreditNoteStatus[] = ['PENDING', 'SENDING', 'VALID', 'REJECTED', 'CANCELLED'];

export function isCreditNoteStatus(value: unknown): value is CreditNoteStatus {
  return typeof value === 'string' && (CREDIT_NOTE_STATUSES as readonly string[]).includes(value);
}

/**
 * Reasons of a credit and debit note. PROVISIONAL: the SIN catalogue is not synced yet (HU-FAC-25) and these codes have not been
 * checked against it; the migration `invoicing_notes_books` back-fills with the same mapping as `creditNoteReasonCode`.
 */
export const SIAT_CREDIT_NOTE_REASONS: readonly { code: number; description: string }[] = [
  { code: 1, description: 'Devolución de mercadería' },
  { code: 2, description: 'Producto con falla de fábrica' },
  { code: 3, description: 'Producto equivocado' },
  { code: 4, description: 'Ajuste de precio' },
  { code: 5, description: 'Otro' },
];

export function isCreditNoteReasonCode(code: unknown): code is number {
  return typeof code === 'number' && SIAT_CREDIT_NOTE_REASONS.some((reason) => reason.code === code);
}

/** The note reason a return reason (`RETURN_REASONS`) maps to; an unknown one is "Otro". */
export function creditNoteReasonCode(returnReason: string): number {
  switch (returnReason) {
    case 'CUSTOMER_CHANGED_MIND':
      return 1;
    case 'FACTORY_DEFECT':
      return 2;
    case 'WRONG_PRODUCT':
      return 3;
    default:
      return 5;
  }
}

/** The fiscal debit a credit note takes back: 13 % of what it credits, half up to cents. */
export function creditNoteVat(total: Decimal | string): Decimal {
  return fiscalDebit(total);
}

/** What the credit rules read of one invoiced line. */
export interface CreditableLine {
  saleItemId: string;
  invoicedQuantity: number;
  /** What the line was invoiced for, after the sale discount and rounding (decimal string). */
  invoicedAmount: string;
  /** Pieces and money already taken back by earlier notes that are not voided. */
  creditedQuantity: number;
  creditedAmount: string;
}

export interface CreditNoteLineInput {
  saleItemId: string;
  /** Pieces credited; 0 for a price adjustment. */
  quantity: number;
  /** Decimal string, 2 places. */
  amount: string;
}

export type CreditNoteIssueCode = 'CREDIT_EMPTY' | 'SALE_ITEM_NOT_FOUND' | 'INVALID_QUANTITY' | 'INVALID_AMOUNT' | 'CREDIT_EXCEEDS_INVOICED';

export interface CreditNoteIssue {
  code: CreditNoteIssueCode;
  saleItemId?: string;
  /** For `CREDIT_EXCEEDS_INVOICED`: what is still creditable of the line. */
  creditableQuantity?: number;
  creditableAmount?: string;
}

const MONEY_STRING = /^\d{1,12}(\.\d{1,2})?$/;

/** What is still creditable of a line: never below zero. */
export function creditableOf(line: CreditableLine): { quantity: number; amount: Decimal } {
  const amount = Decimal.of(line.invoicedAmount).sub(Decimal.of(line.creditedAmount));
  return { quantity: Math.max(0, line.invoicedQuantity - line.creditedQuantity), amount: amount.isNegative() ? Decimal.zero() : amount };
}

/**
 * Only what was invoiced can be credited (HU-FAC-12): each requested line must exist in the invoice, credit a positive amount and
 * stay within the pieces and the money the line still has after earlier notes. Repeated lines count together. Empty when valid.
 */
export function validateCreditNote(lines: readonly CreditableLine[], request: readonly CreditNoteLineInput[]): CreditNoteIssue[] {
  if (request.length === 0) return [{ code: 'CREDIT_EMPTY' }];
  const byId = new Map(lines.map((line) => [line.saleItemId, line]));
  const issues: CreditNoteIssue[] = [];
  const asked = new Map<string, { quantity: number; amount: Decimal }>();
  for (const item of request) {
    const line = byId.get(item.saleItemId);
    if (!line) {
      issues.push({ code: 'SALE_ITEM_NOT_FOUND', saleItemId: item.saleItemId });
    } else if (!Number.isInteger(item.quantity) || item.quantity < 0) {
      issues.push({ code: 'INVALID_QUANTITY', saleItemId: item.saleItemId });
    } else if (typeof item.amount !== 'string' || !MONEY_STRING.test(item.amount) || Decimal.of(item.amount).isZero()) {
      issues.push({ code: 'INVALID_AMOUNT', saleItemId: item.saleItemId });
    } else {
      const known = asked.get(item.saleItemId) ?? { quantity: 0, amount: Decimal.zero() };
      asked.set(item.saleItemId, { quantity: known.quantity + item.quantity, amount: known.amount.add(Decimal.of(item.amount)) });
    }
  }
  if (issues.length > 0) return issues;
  for (const [saleItemId, want] of asked) {
    const creditable = creditableOf(byId.get(saleItemId) as CreditableLine);
    if (want.quantity > creditable.quantity || want.amount.cmp(creditable.amount) > 0) {
      issues.push({ code: 'CREDIT_EXCEEDS_INVOICED', saleItemId, creditableQuantity: creditable.quantity, creditableAmount: creditable.amount.toString() });
    }
  }
  return issues;
}

/** The total of a note: the sum of its lines. */
export function creditNoteTotal(request: readonly { amount: string }[]): Decimal {
  return request.reduce((acc, item) => acc.add(Decimal.of(item.amount)), Decimal.zero());
}

/** Whether the original invoice can still be credited: only one the SIAT holds as valid. */
export function isInvoiceCreditable(status: InvoiceStatus): boolean {
  return status === 'VALID';
}

export type CreditNoteAction = 'VIEW_DETAIL' | 'ISSUE' | 'VOID' | 'DOWNLOAD_PDF' | 'DOWNLOAD_XML';

/** The actions a note in `status` offers to a user holding `permissions`, in menu order. */
export function creditNoteActions(status: CreditNoteStatus, permissions: Iterable<string>): CreditNoteAction[] {
  const granted = new Set<string>(permissions);
  const has = (permission: Permission) => granted.has(permission);
  if (!has('invoicing.invoices.view')) return [];
  const actions: CreditNoteAction[] = ['VIEW_DETAIL'];
  if ((creditNoteMachine.can(status, 'send') || creditNoteMachine.can(status, 'fix')) && has('invoicing.notes.issue')) actions.push('ISSUE');
  // a note the SIAT never validated can be given up, which frees what it reserved of the invoice
  if (creditNoteMachine.can(status, 'void') && has('invoicing.notes.issue')) actions.push('VOID');
  if (status === 'VALID') actions.push('DOWNLOAD_PDF', 'DOWNLOAD_XML');
  return actions;
}

export interface CreditNoteListQuery {
  q?: string;
  status?: CreditNoteStatus;
  /** `YYYY-MM-DD` La Paz days, inclusive. */
  from?: string;
  to?: string;
  branchId?: string;
  page?: number;
  pageSize?: number;
}

export interface CreditNoteListItem {
  id: string;
  /** Null until the first attempt to send takes a number. */
  number: number | null;
  status: CreditNoteStatus;
  invoiceId: string;
  invoiceNumber: number | null;
  customerName: string;
  /** The return the note was born from; null for a price adjustment. */
  returnId: string | null;
  returnNumber: string | null;
  total: string;
  issuedAt: string | null;
  createdAt: string;
  branchId: string;
  rejectionMessage: string | null;
  actions: CreditNoteAction[];
}

export interface CreditNoteListKpis {
  /** Notes the SIAT validated this La Paz month. */
  issuedThisMonth: { count: number; total: string };
  /** Notes still `PENDING`: they await a manual issue. */
  notIssued: number;
  /** How many of this month's valid notes come from a return. */
  fromReturns: number;
  rejected: number;
}

export interface CreditNoteListResponse {
  items: CreditNoteListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalAmount: string;
  kpis: CreditNoteListKpis;
}

export interface CreditNoteDetailLine {
  saleItemId: string;
  code: string;
  description: string;
  quantity: number;
  unitPrice: string;
  amount: string;
}

export interface CreditNoteDetail extends CreditNoteListItem {
  cuf: string | null;
  siatReceptionCode: string | null;
  rejectionCode: number | null;
  lastError: string | null;
  reasonCode: number;
  vatAdjusted: string;
  customerDocumentNumber: string;
  branchName: string;
  invoice: { id: string; number: number | null; status: InvoiceStatus; issuedAt: string | null; total: string; saleId: string };
  lines: CreditNoteDetailLine[];
  history: InvoiceHistoryEntry[];
}

/** `GET invoicing/invoices/:id/creditable`: what the price-adjustment form shows (FS-25). */
export interface CreditableInvoice {
  invoiceId: string;
  saleId: string;
  /** `invoicing.allowPriceAdjustmentNotes`: off, the ERP sends the user to the return form of the sale instead. */
  priceAdjustmentAllowed: boolean;
  invoiceNumber: number | null;
  customerName: string;
  total: string;
  /** What earlier notes that are not voided already credited. */
  credited: string;
  reasons: { code: number; description: string }[];
  lines: {
    saleItemId: string;
    code: string;
    description: string;
    unitPrice: string;
    invoicedQuantity: number;
    invoicedAmount: string;
    creditableQuantity: number;
    creditableAmount: string;
  }[];
}

/** The body of `POST invoicing/invoices/:id/credit-notes`. */
export interface CreateCreditNoteInput {
  reasonCode: number;
  items: CreditNoteLineInput[];
}

// ── SIAT system status (HU-FAC-13) ──

export type CodeHealth = 'OK' | 'EXPIRING' | 'EXPIRED';

/**
 * Health of a CUIS or CUFD by its expiry: `EXPIRED` once past it (or when there is none yet), `EXPIRING` inside the last
 * `warnHours`, `OK` otherwise.
 */
export function codeHealth(expiresAt: Date | string | null, now: Date, warnHours: number): CodeHealth {
  if (expiresAt === null) return 'EXPIRED';
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (!(left > 0)) return 'EXPIRED';
  return left <= warnHours * 3_600_000 ? 'EXPIRING' : 'OK';
}

/** The worst health of several codes, for a summary. */
export function worstCodeHealth(healths: readonly CodeHealth[]): CodeHealth {
  if (healths.includes('EXPIRED')) return 'EXPIRED';
  return healths.includes('EXPIRING') ? 'EXPIRING' : 'OK';
}

export interface SiatCodeStatus {
  /** Whether the point of sale holds a code at all; the code itself never leaves the API. */
  present: boolean;
  expiresAt: string | null;
  health: CodeHealth;
}

export interface SiatPointOfSaleStatus {
  id: string;
  code: number;
  name: string;
  cuis: SiatCodeStatus;
  cufd: SiatCodeStatus;
  lastSyncedAt: string | null;
  /** Invoices the SIAT validated today (La Paz) at this point of sale. */
  issuedToday: number;
}

export interface SiatBranchStatus {
  branchId: string;
  branchCode: number;
  branchName: string;
  pointsOfSale: SiatPointOfSaleStatus[];
}

/** `GET invoicing/system-status` (FS-05, FS-11). */
export interface SiatSystemStatus {
  connection: SiatConnectionStatus;
  checkedAt: string | null;
  environment: 'PRODUCTION' | 'TEST';
  modality: string;
  /** The worst CUIS and CUFD of the company, and the latest sync of any point of sale. */
  cuis: CodeHealth;
  cufd: CodeHealth;
  lastSyncedAt: string | null;
  warnHours: number;
  /** Invoices and notes that still wait for a manual issue. */
  notIssued: number;
  branches: SiatBranchStatus[];
}

// ── VAT books (HU-FAC-18, HU-FAC-19, HU-FAC-20) ──

export const VAT_BOOKS = ['SALES', 'PURCHASES'] as const;
export type VatBook = (typeof VAT_BOOKS)[number];

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isVatBookPeriod(value: unknown): value is string {
  return typeof value === 'string' && PERIOD.test(value);
}

/** The La Paz days a `YYYY-MM` period covers, or null when it is not a period. */
export function vatBookPeriod(period: string): { year: number; month: number; firstDay: string; lastDay: string } | null {
  const match = PERIOD.exec(period);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, firstDay: `${period}-01`, lastDay: `${period}-${String(days).padStart(2, '0')}` };
}

/** The current La Paz period (`YYYY-MM`). */
export function currentVatBookPeriod(now: Date): string {
  return laPazToday(now).slice(0, 7);
}

/** A period is a draft while its La Paz month has not ended (closing a period is HU-FAC-21). */
export function isDraftPeriod(period: string, now: Date): boolean {
  return period >= currentVatBookPeriod(now);
}

export type SalesBookRowKind = 'INVOICE' | 'CREDIT_NOTE';
export type SalesBookRowStatus = 'VALID' | 'CANCELLED';

export interface SalesBookRow {
  id: string;
  kind: SalesBookRowKind;
  /** When the SIAT accepted the document (ISO). */
  date: string;
  number: number;
  cuf: string;
  customerDocumentNumber: string;
  customerName: string;
  /** A cancelled invoice is listed with 0. A credit note carries what it credits, as a positive amount. */
  total: string;
  fiscalDebit: string;
  status: SalesBookRowStatus;
}

export interface SalesBookTotals {
  invoices: number;
  cancelled: number;
  creditNotes: number;
  /** Sum of the valid invoices. */
  invoicedAmount: string;
  /** Sum of the credit notes. */
  creditedAmount: string;
  /** Invoiced less credited. */
  netAmount: string;
  /** 13 % fiscal debit of the valid invoices less the VAT the notes adjust. */
  fiscalDebit: string;
}

/** The indicators of the sales book: valid invoices add, cancelled ones add nothing, credit notes reduce. */
export function salesBookTotals(rows: readonly SalesBookRow[]): SalesBookTotals {
  let invoices = 0;
  let cancelled = 0;
  let creditNotes = 0;
  let invoiced = Decimal.zero();
  let credited = Decimal.zero();
  let debit = Decimal.zero();
  for (const row of rows) {
    if (row.status === 'CANCELLED') {
      cancelled++;
    } else if (row.kind === 'CREDIT_NOTE') {
      creditNotes++;
      credited = credited.add(Decimal.of(row.total));
      debit = debit.sub(Decimal.of(row.fiscalDebit));
    } else {
      invoices++;
      invoiced = invoiced.add(Decimal.of(row.total));
      debit = debit.add(Decimal.of(row.fiscalDebit));
    }
  }
  return {
    invoices,
    cancelled,
    creditNotes,
    invoicedAmount: invoiced.toString(),
    creditedAmount: credited.toString(),
    netAmount: invoiced.sub(credited).toString(),
    fiscalDebit: debit.toString(),
  };
}

export type PurchaseBookStatus = 'VALID' | 'OBSERVED';

export interface PurchaseBookRow {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  supplierNit: string;
  supplierName: string;
  authorizationCode: string;
  invoiceNumber: string;
  total: string;
  vatCredit: string;
  status: PurchaseBookStatus;
  observation: string | null;
  nitVerifiedAt: string | null;
}

export interface PurchaseBookTotals {
  entries: number;
  observed: number;
  /** Sum and tax credit of the valid entries only: an observed purchase does not add (HU-FAC-19). */
  totalAmount: string;
  vatCredit: string;
  /** What the observed entries would add once verified. */
  observedAmount: string;
  observedVatCredit: string;
}

export function purchaseBookTotals(rows: readonly PurchaseBookRow[]): PurchaseBookTotals {
  let observed = 0;
  let total = Decimal.zero();
  let credit = Decimal.zero();
  let observedAmount = Decimal.zero();
  let observedCredit = Decimal.zero();
  for (const row of rows) {
    if (row.status === 'OBSERVED') {
      observed++;
      observedAmount = observedAmount.add(Decimal.of(row.total));
      observedCredit = observedCredit.add(Decimal.of(row.vatCredit));
    } else {
      total = total.add(Decimal.of(row.total));
      credit = credit.add(Decimal.of(row.vatCredit));
    }
  }
  return {
    entries: rows.length,
    observed,
    totalAmount: total.toString(),
    vatCredit: credit.toString(),
    observedAmount: observedAmount.toString(),
    observedVatCredit: observedCredit.toString(),
  };
}

/** `GET invoicing/vat-books/sales|purchases`. */
export interface VatBookResponse<Row, Totals> {
  period: string;
  /** The month has not ended: the book can still change. */
  draft: boolean;
  format: VatBookFormat;
  exportFormats: VatBookExportFormat[];
  rows: Row[];
  totals: Totals;
}
export type SalesBookResponse = VatBookResponse<SalesBookRow, SalesBookTotals>;
export type PurchasesBookResponse = VatBookResponse<PurchaseBookRow, PurchaseBookTotals>;

/** The name of an exported book: `libro-ventas-2026-11.xlsx`, with `-BORRADOR` while the period is open. */
export function vatBookFileName(book: VatBook, period: string, format: VatBookExportFormat, draft: boolean): string {
  return `libro-${book === 'SALES' ? 'ventas' : 'compras'}-${period}${draft ? '-BORRADOR' : ''}.${format.toLowerCase()}`;
}
