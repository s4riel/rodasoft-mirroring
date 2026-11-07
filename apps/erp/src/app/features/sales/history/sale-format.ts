import { CANCELLATION_REASONS, type CancellationReason, Decimal, saleItemsCount, type PaymentMethod, type SaleHistoryEntry, type SaleListItem, type SaleListQuery, type SaleStatus } from '@rodasoft/domain';
import type { DocTableCell, DocTableRow, DocTableStatus, RowMenuItem, SelectOption } from '@rodasoft/ui';
import { formatBs, formatDateTime } from '../cash/cash-format';

/** Rows per page of the list (Figma DocTable with a short pagination). */
export const SALES_PAGE_SIZE = 10;

/** Spanish label and pill of each sale status (VP-01a). */
export const SALE_STATUS_PILLS: Record<SaleStatus, DocTableStatus> = {
  COMPLETED: { label: 'Pagada', status: 'success', icon: 'check' },
  CANCELLATION_PENDING: { label: 'Anulación pendiente', status: 'warning', icon: 'alert' },
  CANCELLED: { label: 'Anulada', status: 'idle' },
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Efectivo',
  QR: 'QR',
  CARD: 'Tarjeta',
  TRANSFER: 'Transferencia',
  CREDIT: 'Crédito',
};

export const STATUS_OPTIONS: SelectOption[] = (Object.keys(SALE_STATUS_PILLS) as SaleStatus[]).map((value) => ({
  value,
  label: SALE_STATUS_PILLS[value].label,
}));

export const METHOD_OPTIONS: SelectOption[] = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((value) => ({
  value,
  label: PAYMENT_METHOD_LABELS[value],
}));

/** What the URL holds: every filter is optional and the page starts at 1. */
export interface SaleUrlFilters {
  q: string;
  status: SaleStatus | null;
  method: PaymentMethod | null;
  from: string | null;
  to: string | null;
  cashierId: string | null;
  page: number;
}

export function parseStatus(raw: string | null): SaleStatus | null {
  return raw !== null && Object.hasOwn(SALE_STATUS_PILLS, raw) ? (raw as SaleStatus) : null;
}

export function parseMethod(raw: string | null): PaymentMethod | null {
  return raw !== null && Object.hasOwn(PAYMENT_METHOD_LABELS, raw) ? (raw as PaymentMethod) : null;
}

/** The filters of the URL as the API query; an empty filter is left out. */
export function toQuery(f: SaleUrlFilters): SaleListQuery {
  return {
    q: f.q || undefined,
    status: f.status ?? undefined,
    method: f.method ?? undefined,
    from: f.from ?? undefined,
    to: f.to ?? undefined,
    cashierId: f.cashierId ?? undefined,
    page: f.page,
    pageSize: SALES_PAGE_SIZE,
  };
}

/** Row of the table: the number links to the sale through a cell template; the pill is drawn by the table. */
export function toRow(item: SaleListItem): DocTableRow {
  return {
    id: item.id,
    label: item.number,
    cells: {
      number: item.number,
      customer: item.customerName,
      date: formatDateTime(item.createdAt),
      items: item.itemsCount,
      total: formatBs(item.total),
      status: SALE_STATUS_PILLS[item.status],
    },
  };
}

/** The total row of VP-01a: how many sales the page shows, their units and their amount. */
export function toTotals(items: readonly SaleListItem[]): Record<string, DocTableCell> {
  const amount = items.reduce((sum, i) => sum.add(Decimal.of(i.total)), Decimal.zero());
  return {
    number: 'Total',
    customer: `${items.length} ${items.length === 1 ? 'venta' : 'ventas'}`,
    date: '',
    items: saleItemsCount([{ quantity: items.reduce((sum, i) => sum + i.itemsCount, 0) }]),
    total: amount.format(),
    status: '',
  };
}

/** The ⋯ menu of a row for a sale nobody asked to cancel. "Devolución" arrives with HU-VEN-21. */
export const ROW_MENU: RowMenuItem[] = [
  { key: 'view', label: 'Ver venta', icon: 'eye' },
  { key: 'reprint', label: 'Reimprimir', icon: 'document' },
];

/** "Solicitar anulación" (HU-VEN-14): only for a paid sale, to who may ask for it. The deadline is checked in the dialog. */
const CANCEL_MENU_ITEM: RowMenuItem = { key: 'cancel', label: 'Solicitar anulación', icon: 'close', danger: true, separated: true };

/** The ⋯ menu of one row. */
export function rowMenuFor(item: Pick<SaleListItem, 'status'>, mayRequestCancellation: boolean): RowMenuItem[] {
  return mayRequestCancellation && item.status === 'COMPLETED' ? [...ROW_MENU, CANCEL_MENU_ITEM] : ROW_MENU;
}

/** "1–10 de 23 ventas", or empty when there are none. */
export function rangeLabel(page: number, shown: number, total: number): string {
  if (!total) return '';
  const from = (page - 1) * SALES_PAGE_SIZE + 1;
  const to = Math.min(total, from + shown - 1);
  const fmt = (n: number) => n.toLocaleString('es-BO');
  return `${fmt(from)}–${fmt(to)} de ${fmt(total)} ${total === 1 ? 'venta' : 'ventas'}`;
}

/** The CSV columns of "Exportar": the ones the table shows, plus the payment methods. Never costs. */
const CSV_HEADER = ['N.º', 'Cliente', 'Fecha', 'Ítems', 'Total', 'Formas de pago', 'Estado'];

/** A CSV field: quoted when it holds the separator, a quote or a line break (`;` is what Excel in Spanish expects). */
function csvField(value: string | number): string {
  // a free-text value that starts like a formula would run in Excel: a leading apostrophe keeps it text
  const raw = String(value);
  const text = typeof value === 'string' && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(items: readonly SaleListItem[]): string {
  const lines = items.map((i) =>
    [
      i.number,
      i.customerName,
      formatDateTime(i.createdAt),
      i.itemsCount,
      formatBs(i.total),
      i.methods.map((m) => PAYMENT_METHOD_LABELS[m]).join(' + '),
      SALE_STATUS_PILLS[i.status].label,
    ]
      .map(csvField)
      .join(';'),
  );
  return [CSV_HEADER.join(';'), ...lines].join('\r\n');
}

/** What the history of a sale says in Spanish. Unknown actions (future stories) fall back to a generic line. */
export function historyLabel(entry: Pick<SaleHistoryEntry, 'action' | 'email'>): string {
  switch (entry.action) {
    case 'sales.sale.complete':
      return 'Venta completada';
    case 'sales.receipt.reprint':
      return 'Comprobante reimpreso';
    case 'sales.receipt.email':
      return entry.email ? `Comprobante enviado a ${entry.email}` : 'Comprobante enviado por correo';
    case 'sales.sale.cancellation-request':
      return 'Anulación solicitada · esperando a Gerencia';
    case 'sales.sale.cancellation-withdraw':
      return 'Solicitud de anulación retirada';
    default:
      return 'Movimiento registrado';
  }
}

/** The invoice line of the detail: the record is pending until the SIAT epic issues it. */
export function invoiceLabel(status: string, number: number | null): string {
  if (status === 'PENDING') return 'Pendiente de emisión SIAT';
  return number === null ? status : `Factura ${number}`;
}

/** Spanish label of each reason of a cancellation request (Figma VP-15a). */
export const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  CUSTOMER_DATA_ERROR: 'Error en datos del cliente',
  ITEMS_OR_PRICES_ERROR: 'Error en productos o precios',
  SALE_NOT_COMPLETED: 'Venta no concretada',
  OTHER: 'Otro',
};

/** The reasons in the order the dialog draws them. */
export const CANCELLATION_REASON_OPTIONS = CANCELLATION_REASONS.map((value) => ({ value, label: CANCELLATION_REASON_LABELS[value] }));

export function cancellationReasonLabel(reason: string): string {
  return Object.hasOwn(CANCELLATION_REASON_LABELS, reason) ? CANCELLATION_REASON_LABELS[reason as CancellationReason] : reason;
}

/** The deadline sentence of the dialog: the last day to ask, or that there is no limit (decision #10 is still open). */
export function cancellationDeadlineText(windowEndsAt: string | null): string {
  if (!windowEndsAt) return 'sin límite';
  // the end is exclusive (the start of the next La Paz day): the last day to ask is the one before
  return formatDateTime(new Date(Date.parse(windowEndsAt) - 1).toISOString()).slice(0, 10);
}
