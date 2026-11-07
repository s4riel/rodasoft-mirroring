import { Decimal } from './money';
import type { QuoteStatus } from './state-machine';

/**
 * Following a quote (HU-VEN-17, HU-VEN-18): how it is sent, the send log, the timeline of its statuses and the text of the
 * message. Pure rules shared by the API and the ERP.
 */

export const QUOTE_SEND_CHANNELS = ['WHATSAPP', 'EMAIL', 'PDF'] as const;
export type QuoteSendChannel = (typeof QUOTE_SEND_CHANNELS)[number];

export const QUOTE_MESSAGE_MAX = 500;

/** One time a quote left the system. `at` is an ISO instant. */
export interface QuoteSendLogEntry {
  channel: QuoteSendChannel;
  /** E-mail address or WhatsApp number; `null` for the printed/PDF copy. */
  to: string | null;
  at: string;
  userId: string;
  userName: string | null;
}

export interface SendQuoteInput {
  channel: QuoteSendChannel;
  to?: string;
  message?: string;
}

export interface RenewQuoteInput {
  /** `YYYY-MM-DD`; today plus `sales.quoteValidityDays` when omitted. */
  validUntil?: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isValidEmail = (value: string): boolean => EMAIL.test(value.trim());

/** Country code of Bolivia, added to the 8-digit local numbers. */
const BOLIVIA_CODE = '591';
const LOCAL_NUMBER_DIGITS = 8;
/** An international number (E.164) has at most 15 digits. */
const INTERNATIONAL_MIN_DIGITS = LOCAL_NUMBER_DIGITS + 1;
const INTERNATIONAL_MAX_DIGITS = 15;

/** A WhatsApp number in the international form `wa.me` needs (digits only), or null when it cannot be one. */
export function normalizeWhatsappNumber(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === LOCAL_NUMBER_DIGITS) return `${BOLIVIA_CODE}${digits}`;
  return digits.length >= INTERNATIONAL_MIN_DIGITS && digits.length <= INTERNATIONAL_MAX_DIGITS ? digits : null;
}

/** Whether the quote can still go out: drafts and sent quotes that have not expired. */
export function isQuoteSendable(status: QuoteStatus): boolean {
  return status === 'DRAFT' || status === 'SENT';
}

/** Renewing is only for an expired quote (decision #12 sets the new validity). */
export const isQuoteRenewable = (status: QuoteStatus): boolean => status === 'EXPIRED';

/** A sent or an expired quote can be closed as rejected by the customer. */
export const isQuoteRejectable = (status: QuoteStatus): boolean => status === 'SENT' || status === 'EXPIRED';

// --- timeline (VP-17, VP-17b) ---

export type QuoteTimelineKey = 'DRAFT' | 'SENT' | 'WAITING' | 'EXPIRED' | 'REJECTED' | 'CONVERTED';
export type QuoteTimelineState = 'done' | 'current' | 'warning' | 'pending';

export interface QuoteTimelineStep {
  key: QuoteTimelineKey;
  state: QuoteTimelineState;
  /** `YYYY-MM-DD` of the step, when it happened (or when the validity ends/ended); `null` when not known yet. */
  date: string | null;
}

export interface QuoteTimelineInput {
  /** The status as shown: a sent quote past its validity reads `EXPIRED`. */
  status: QuoteStatus;
  createdDay: string;
  sentDay: string | null;
  validUntil: string;
  /** The day it was rejected or converted. */
  closedDay: string | null;
}

/** Borrador → Enviada → (Esperando respuesta | Vencida | Rechazada) → Convertida. */
export function quoteTimeline(input: QuoteTimelineInput): QuoteTimelineStep[] {
  const { status } = input;
  const sent = status !== 'DRAFT' && input.sentDay !== null;
  const draft: QuoteTimelineStep = { key: 'DRAFT', state: status === 'DRAFT' ? 'current' : 'done', date: input.createdDay };
  const sentStep: QuoteTimelineStep = { key: 'SENT', state: sent ? 'done' : 'pending', date: sent ? input.sentDay : null };
  const converted: QuoteTimelineStep = {
    key: 'CONVERTED',
    state: status === 'ACCEPTED' ? 'done' : 'pending',
    date: status === 'ACCEPTED' ? input.closedDay : null,
  };
  let outcome: QuoteTimelineStep;
  switch (status) {
    case 'EXPIRED':
      outcome = { key: 'EXPIRED', state: 'warning', date: input.validUntil };
      break;
    case 'REJECTED':
      outcome = { key: 'REJECTED', state: 'warning', date: input.closedDay };
      break;
    case 'SENT':
      outcome = { key: 'WAITING', state: 'current', date: input.validUntil };
      break;
    case 'ACCEPTED':
      outcome = { key: 'WAITING', state: sent ? 'done' : 'pending', date: null };
      break;
    default:
      outcome = { key: 'WAITING', state: 'pending', date: null };
  }
  return [draft, sentStep, outcome, converted];
}

// --- message ---

export interface QuoteShareDocument {
  number: string;
  company: string;
  customerName: string;
  /** `YYYY-MM-DD` */
  validUntil: string;
  lines: { quantity: number; code: string; name: string; lineTotal: string }[];
  total: string;
}

const money = (amount: string): string => Decimal.of(amount).format();
const dayText = (day: string): string => day.split('-').reverse().join('/');

/**
 * The text sent by WhatsApp and e-mail. It carries the lines and the total, never the customer's NIT or any cost.
 * `message` is the greeting the salesperson typed; a default one is used when it is empty.
 */
export function quoteShareText(doc: QuoteShareDocument, message?: string): string {
  const greeting = message?.trim() || `Hola, te enviamos la cotización ${doc.number} de ${doc.company}.`;
  return [
    greeting,
    '',
    `${doc.company} · Cotización ${doc.number}`,
    `Cliente: ${doc.customerName}`,
    `Válida hasta ${dayText(doc.validUntil)}`,
    '',
    ...doc.lines.map((line) => `• ${line.quantity} × ${line.code} ${line.name} = ${money(line.lineTotal)}`),
    '',
    `Total: ${money(doc.total)}`,
  ].join('\n');
}
