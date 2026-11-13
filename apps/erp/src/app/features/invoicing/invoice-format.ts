import { type InvoiceAction, type InvoiceListItem, type InvoiceListQuery, type InvoiceStatus, isInvoiceStatus } from '@rodasoft/domain';
import type { DocTableRow, DocTableStatus, RowMenuItem, SelectOption } from '@rodasoft/ui';
import { formatBs, formatDateTime } from '../sales/cash/cash-format';

/** Rows per page of the list (Figma DocTable with a short pagination). */
export const INVOICE_PAGE_SIZE = 10;

/**
 * Spanish label and pill of each invoice status (FS-01). There is no contingency: an invoice the SIAT did not receive reads
 * "No facturada en SIAT" and a person issues it by hand.
 */
export const INVOICE_STATUS_PILLS: Record<InvoiceStatus, DocTableStatus> = {
  PENDING: { label: 'No facturada en SIAT', status: 'warning', icon: 'alert' },
  SENDING: { label: 'Enviando', status: 'info' },
  VALID: { label: 'Válida', status: 'success', icon: 'check' },
  REJECTED: { label: 'Rechazada', status: 'danger', icon: 'close' },
  CANCELLATION_PENDING: { label: 'Anulación en curso', status: 'warning', icon: 'alert' },
  CANCELLED: { label: 'Anulada', status: 'idle' },
};

export const INVOICE_STATUS_OPTIONS: SelectOption[] = (Object.keys(INVOICE_STATUS_PILLS) as InvoiceStatus[]).map((value) => ({
  value,
  label: INVOICE_STATUS_PILLS[value].label,
}));

/** What the URL holds: every filter is optional and the page starts at 1. */
export interface InvoiceUrlFilters {
  q: string;
  status: InvoiceStatus | null;
  from: string | null;
  to: string | null;
  branchId: string | null;
  page: number;
}

export function parseInvoiceStatus(raw: string | null): InvoiceStatus | null {
  return isInvoiceStatus(raw) ? raw : null;
}

export function toInvoiceQuery(f: InvoiceUrlFilters): InvoiceListQuery {
  return { q: f.q || undefined, status: f.status ?? undefined, from: f.from ?? undefined, to: f.to ?? undefined, branchId: f.branchId ?? undefined, page: f.page, pageSize: INVOICE_PAGE_SIZE };
}

/** The invoice number as printed, or a dash while the SIAT has not numbered it. */
export function invoiceNumberLabel(number: number | null): string {
  return number === null ? '—' : String(number).padStart(6, '0');
}

export function toInvoiceRow(item: InvoiceListItem): DocTableRow {
  return {
    id: item.id,
    label: invoiceNumberLabel(item.number),
    cells: {
      number: invoiceNumberLabel(item.number),
      customer: item.customerName,
      sale: item.saleNumber,
      date: formatDateTime(item.issuedAt ?? item.createdAt),
      total: formatBs(item.total),
      status: INVOICE_STATUS_PILLS[item.status],
    },
  };
}

/** "1–10 de 23 facturas", or empty when there are none. */
export function invoiceRangeLabel(page: number, shown: number, total: number): string {
  if (!total) return '';
  const from = (page - 1) * INVOICE_PAGE_SIZE + 1;
  const to = Math.min(total, from + shown - 1);
  const fmt = (n: number) => n.toLocaleString('es-BO');
  return `${fmt(from)}–${fmt(to)} de ${fmt(total)} ${total === 1 ? 'factura' : 'facturas'}`;
}

/**
 * The ⋯ menu of a row, from the actions the API says the caller may take.
 */
const MENU: Partial<Record<InvoiceAction, RowMenuItem>> = {
  VIEW_DETAIL: { key: 'view', label: 'Ver detalle', icon: 'eye' },
  DOWNLOAD_PDF: { key: 'pdf', label: 'Ver PDF', icon: 'document' },
  DOWNLOAD_XML: { key: 'xml', label: 'Descargar XML', icon: 'export' },
  SEND: { key: 'send', label: 'Enviar', icon: 'mail' },
  ISSUE: { key: 'issue', label: 'Emitir en el SIAT', icon: 'invoice' },
  ISSUE_CREDIT_NOTE: { key: 'credit-note', label: 'Emitir nota de crédito', icon: 'document', separated: true },
  REQUEST_CANCELLATION: { key: 'cancel', label: 'Solicitar anulación', icon: 'close', danger: true, separated: true },
};

export function invoiceMenuFor(item: Pick<InvoiceListItem, 'actions'>): RowMenuItem[] {
  return item.actions.map((action) => MENU[action]).filter((entry): entry is RowMenuItem => entry !== undefined);
}

export const PAYMENT_LABELS: Record<string, string> = { CASH: 'Efectivo', QR: 'QR', CARD: 'Tarjeta', TRANSFER: 'Transferencia', CREDIT: 'Crédito' };

/** The Spanish line of a history row of the invoice (the audit action of the SIAT flow). */
export const HISTORY_LABELS: Record<string, string> = {
  'invoicing.invoice.issue': 'Envío al SIAT iniciado',
  'invoicing.invoice.accept': 'Aceptada por el SIAT',
  'invoicing.invoice.reject': 'Rechazada por el SIAT',
  'invoicing.invoice.unavailable': 'El SIAT no respondió: queda sin facturar',
  'invoicing.invoice.correct': 'Datos del cliente corregidos',
  'invoicing.invoice.verify-nit': 'NIT verificado con el SIN',
};

export function historyLabel(action: string): string {
  return HISTORY_LABELS[action] ?? action;
}
