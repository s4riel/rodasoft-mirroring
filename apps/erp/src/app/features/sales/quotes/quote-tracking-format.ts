import {
  Decimal,
  type QuoteDetail,
  type QuoteSendChannel,
  type QuoteShareDocument,
  type QuoteTimelineKey,
  type QuoteTimelineStep,
} from '@rodasoft/domain';
import type { ReceiptItem, ReceiptRow, StatusTimelineStep } from '@rodasoft/ui';
import { formatBs } from '../cash/cash-format';
import { formatDay, isZero } from './quote-format';

/** Spanish label of each step of the quote timeline (VP-17, VP-17b). */
export const QUOTE_TIMELINE_LABELS: Record<QuoteTimelineKey, string> = {
  DRAFT: 'Borrador',
  SENT: 'Enviada',
  WAITING: 'Esperando respuesta',
  EXPIRED: 'Vencida',
  REJECTED: 'Rechazada',
  CONVERTED: 'Convertida',
};

const TIMELINE_STATE_LABELS: Record<QuoteTimelineStep['state'], string> = {
  done: 'Completado',
  current: 'Paso actual',
  warning: 'Detenida',
  pending: 'Pendiente',
};

/** The channels of VP-08b, in the order of the "Enviar por" chips. */
export const QUOTE_CHANNEL_OPTIONS: { value: QuoteSendChannel; label: string }[] = [
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'Correo' },
  { value: 'PDF', label: 'Descargar PDF' },
];

export const QUOTE_CHANNEL_LABELS: Record<QuoteSendChannel, string> = {
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Correo',
  PDF: 'PDF / impresión',
};

/** `2026-10-14` → `14/10` */
const shortDay = (day: string): string => formatDay(day).slice(0, 5);

/** The timeline as `rs-status-timeline` draws it: a short date under each step, a dash while it has not happened. */
export function toTimelineSteps(steps: readonly QuoteTimelineStep[]): StatusTimelineStep[] {
  return steps.map((step) => {
    let caption = step.date ? shortDay(step.date) : '—';
    if (step.key === 'WAITING' && step.state === 'current' && step.date) caption = `válida hasta ${formatDay(step.date)}`;
    return { label: QUOTE_TIMELINE_LABELS[step.key], caption, state: step.state, stateLabel: TIMELINE_STATE_LABELS[step.state] };
  });
}

/** What the customer receives, for the WhatsApp and e-mail text (`quoteShareText`). */
export function quoteShareDocument(quote: QuoteDetail): QuoteShareDocument {
  return {
    number: quote.number,
    company: quote.company,
    customerName: quote.customer.name,
    validUntil: quote.validUntil,
    lines: quote.lines.map((l) => ({ quantity: l.quantity, code: l.code, name: l.name, lineTotal: l.lineTotal })),
    total: quote.total,
  };
}

/** The quote drawn as a document for `rs-receipt` on letter paper: the preview of VP-08b and the printed copy. */
export function quoteDocument(quote: QuoteDetail): {
  headerLines: string[];
  metaRows: ReceiptRow[];
  items: ReceiptItem[];
  totalRows: ReceiptRow[];
  footerLines: string[];
} {
  const totalRows: ReceiptRow[] = [{ label: 'Subtotal', value: formatBs(quote.subtotal) }];
  if (!isZero(quote.discountAmount)) totalRows.push({ label: 'Descuento', value: `−${formatBs(quote.discountAmount)}` });
  if (!isZero(quote.roundingAmount)) totalRows.push({ label: 'Redondeo', value: formatBs(quote.roundingAmount) });
  totalRows.push({ label: 'Total', value: formatBs(quote.total), strong: true });
  return {
    headerLines: [quote.company],
    metaRows: [
      { label: 'Cotización', value: quote.number },
      { label: 'Fecha', value: formatDay(quote.createdAt.slice(0, 10)) },
      { label: 'Válida hasta', value: formatDay(quote.validUntil) },
      { label: 'Cliente', value: quote.customer.name },
    ],
    items: quote.lines.map((l) => ({
      description: `${l.code} · ${l.name}`,
      detail: `${l.quantity} × ${formatBs(l.unitPrice)}`,
      total: formatBs(l.lineTotal),
    })),
    totalRows,
    footerLines: ['Precios en Bs. Sujetos a disponibilidad de stock al confirmar.'],
  };
}

/** The `wa.me` link that opens WhatsApp with the message written (no server integration yet). */
export const whatsappUrl = (phone: string, text: string): string => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;

/** "Sin existencia" is shown for a line whose available stock is below the quantity; `null` means there is no warehouse to ask. */
export const isOutOfStock = (available: number | null, quantity: number): boolean => available !== null && available < quantity;

/** Units on the quote: the sum of the line quantities. */
export const quoteUnits = (quote: QuoteDetail): number => quote.lines.reduce((sum, l) => sum + l.quantity, 0);

export const moneyOf = (amount: string): string => Decimal.of(amount).format();
