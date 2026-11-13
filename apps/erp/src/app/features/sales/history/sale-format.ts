import { SIAT_CANCELLATION_REASONS, CANCELLATION_REASONS, cancellationImpact, type CancellationImpact, type CancellationReason, Decimal, saleItemsCount, type PaymentMethod, type SaleHistoryEntry, type SaleListItem, type SaleListQuery, type SaleStatus } from '@rodasoft/domain';
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
    case 'sales.sale.cancellation-approve':
      return 'Anulación aprobada · factura anulada';
    case 'sales.sale.cancellation-reject':
      return 'Anulación rechazada';
    default:
      return 'Movimiento registrado';
  }
}

function cancelledInvoiceLabel(number: number | null): string {
  return number === null ? 'Factura anulada' : `Factura ${number} anulada`;
}

/** The invoice line of the detail: the record is pending until the SIAT epic issues it. */
export function invoiceLabel(status: string, number: number | null): string {
  if (status === 'PENDING') return 'Pendiente de emisión SIAT';
  if (status === 'CANCELLED') return cancelledInvoiceLabel(number);
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
  // a reason chosen from the invoice is a code of the SIN table (HU-FAC-09)
  const sin = /^SIN_(\d+)$/.exec(reason);
  if (sin) return SIAT_CANCELLATION_REASONS.find((r) => r.code === Number(sin[1]))?.description ?? reason;
  return Object.hasOwn(CANCELLATION_REASON_LABELS, reason) ? CANCELLATION_REASON_LABELS[reason as CancellationReason] : reason;
}

/** The deadline sentence of the dialog: the last day to ask, or that there is no limit (decision #10 is still open). */
export function cancellationDeadlineText(windowEndsAt: string | null): string {
  if (!windowEndsAt) return 'sin límite';
  // the end is exclusive (the start of the next La Paz day): the last day to ask is the one before
  return formatDateTime(new Date(Date.parse(windowEndsAt) - 1).toISOString()).slice(0, 10);
}

// ── Deciding a cancellation (HU-VEN-15) ──

/** "51 minutos", "3 horas", "2 días": how long ago the sale was made, rounded down to the unit that reads best. */
export function elapsedText(fromIso: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return minutes === 1 ? '1 minuto' : `${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hora' : `${hours} horas`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 día' : `${days} días`;
}

/** "QR Bs 50,00" for each refund that someone has to make by hand. */
function manualRefundsText(impact: Pick<CancellationImpact, 'manualRefunds'>): string {
  return impact.manualRefunds
    .map((r) => `${r.method === 'CARD' ? 'tarjeta' : r.method === 'QR' ? 'QR' : 'transferencia'} ${formatBs(r.amount)}`)
    .join(' y ');
}

/** What approving will do, as VP-15c says it ("Qué pasará"). */
export function impactSentence(
  impact: CancellationImpact & { warehouseName: string; registerName: string },
): string {
  const invoice =
    impact.invoiceAction === 'VOID'
      ? 'Se anula la factura (todavía no se emitió en el SIAT)'
      : impact.invoiceAction === 'REQUEST_SIAT_CANCELLATION'
        ? 'Se anula la factura en el SIAT'
        : 'La factura no se puede anular en su estado actual';
  const units = `${impact.stockUnits} ${impact.stockUnits === 1 ? 'pieza' : 'piezas'}`;
  const parts = [`${invoice}, el stock (${units}) vuelve a ${impact.warehouseName}`];
  if (!Decimal.of(impact.cashRefund).isZero()) parts.push(`se registra el reembolso de ${formatBs(impact.cashRefund)} en ${impact.registerName}`);
  const sentence = parts.length === 2 ? `${parts[0]} y ${parts[1]}.` : `${parts[0]}.`;
  return impact.manualRefunds.length > 0 ? `${sentence} Reembolso de ${manualRefundsText(impact)} a gestionar manualmente.` : sentence;
}

/** The banner of a cancelled sale (VP-15d), from what the sale holds: the same rule the approval used. */
export function cancelledSummary(
  sale: {
    invoice: { status: string; number: number | null };
    lines: readonly { quantity: number }[];
    payments: readonly { method: PaymentMethod; amount: string }[];
  },
  place: { warehouseName: string; registerName: string },
): string {
  const impact = cancellationImpact({ invoiceStatus: 'PENDING', lines: sale.lines, payments: sale.payments });
  const returned = `${impact.stockUnits} ${impact.stockUnits === 1 ? 'pieza devuelta' : 'piezas devueltas'} a ${place.warehouseName}`;
  const parts = [cancelledInvoiceLabel(sale.invoice.number), returned];
  if (!Decimal.of(impact.cashRefund).isZero()) parts.push(`reembolso ${formatBs(impact.cashRefund)} registrado en ${place.registerName}`);
  if (impact.manualRefunds.length > 0) parts.push(`reembolso de ${manualRefundsText(impact)} a gestionar manualmente`);
  return parts.join(' · ');
}
