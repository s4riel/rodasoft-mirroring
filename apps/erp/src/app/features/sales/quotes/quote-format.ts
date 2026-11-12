import {
  cartTotals,
  Decimal,
  type CustomerDiscountType,
  type QuoteListItem,
  type QuoteListQuery,
  type QuoteStatus,
  type RoundingMode,
  type SalesOrderListItem,
  type SalesOrderListQuery,
  type SalesOrderStatus,
  type SalesLineSpec,
} from '@rodasoft/domain';
import type { DocTableCell, DocTableRow, DocTableStatus, SelectOption } from '@rodasoft/ui';
import { formatBs, formatDateTime } from '../cash/cash-format';

/** Rows per page of the quote and order lists. */
export const DOCUMENTS_PAGE_SIZE = 10;

/** Spanish label and pill of each quote status (VP-07). */
export const QUOTE_STATUS_PILLS: Record<QuoteStatus, DocTableStatus> = {
  DRAFT: { label: 'Borrador', status: 'idle' },
  SENT: { label: 'Enviada', status: 'info' },
  ACCEPTED: { label: 'Convertida', status: 'success', icon: 'check' },
  EXPIRED: { label: 'Vencida', status: 'warning', icon: 'alert' },
  REJECTED: { label: 'Rechazada', status: 'danger' },
};

/** Spanish label and pill of each order status (VP-09). */
export const ORDER_STATUS_PILLS: Record<SalesOrderStatus, DocTableStatus> = {
  OPEN: { label: 'Reservado', status: 'info' },
  PARTIALLY_DISPATCHED: { label: 'Despacho parcial', status: 'warning' },
  DISPATCHED: { label: 'Despachado', status: 'success', icon: 'check' },
  CANCELLED: { label: 'Anulado', status: 'idle' },
};

const optionsOf = <S extends string>(pills: Record<S, DocTableStatus>): SelectOption[] =>
  (Object.keys(pills) as S[]).map((value) => ({ value, label: pills[value].label }));

export const QUOTE_STATUS_OPTIONS = optionsOf(QUOTE_STATUS_PILLS);
export const ORDER_STATUS_OPTIONS = optionsOf(ORDER_STATUS_PILLS);

export const parseQuoteStatus = (raw: string | null): QuoteStatus | null =>
  raw !== null && Object.hasOwn(QUOTE_STATUS_PILLS, raw) ? (raw as QuoteStatus) : null;
export const parseOrderStatus = (raw: string | null): SalesOrderStatus | null =>
  raw !== null && Object.hasOwn(ORDER_STATUS_PILLS, raw) ? (raw as SalesOrderStatus) : null;

export interface DocumentUrlFilters<S> {
  q: string;
  status: S | null;
  page: number;
}

export function toQuoteQuery(f: DocumentUrlFilters<QuoteStatus>): QuoteListQuery {
  return { q: f.q || undefined, status: f.status ?? undefined, page: f.page, pageSize: DOCUMENTS_PAGE_SIZE };
}

export function toOrderQuery(f: DocumentUrlFilters<SalesOrderStatus>): SalesOrderListQuery {
  return { q: f.q || undefined, status: f.status ?? undefined, page: f.page, pageSize: DOCUMENTS_PAGE_SIZE };
}

/** `2026-11-14` → `14/11/2026` */
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

export function toQuoteRow(item: QuoteListItem): DocTableRow {
  return {
    id: item.id,
    label: item.number,
    cells: {
      number: item.number,
      customer: item.customerName,
      date: formatDateTime(item.createdAt),
      validUntil: formatDay(item.validUntil),
      items: item.itemsCount,
      total: formatBs(item.total),
      status: QUOTE_STATUS_PILLS[item.status],
      actions: null,
    },
  };
}

/** The total row of VP-07: how many quotes the page shows, their units and their amount. */
export function toQuoteTotals(items: readonly QuoteListItem[]): Record<string, DocTableCell> {
  const amount = items.reduce((sum, i) => sum.add(Decimal.of(i.total)), Decimal.zero());
  return {
    number: 'Total',
    customer: `${items.length} ${items.length === 1 ? 'cotización' : 'cotizaciones'}`,
    date: '',
    validUntil: '',
    items: items.reduce((sum, i) => sum + i.itemsCount, 0),
    total: amount.format(),
    status: '',
  };
}

export function toOrderRow(item: SalesOrderListItem): DocTableRow {
  return {
    id: item.id,
    label: item.number,
    cells: {
      number: item.number,
      customer: item.customerName,
      quote: item.quoteNumber ?? '—',
      warehouse: item.warehouseName,
      date: formatDateTime(item.createdAt),
      total: formatBs(item.total),
      status: ORDER_STATUS_PILLS[item.status],
    },
  };
}

/** "1–10 de 23 cotizaciones", or empty when there are none. */
export function documentRangeLabel(page: number, shown: number, total: number, one: string, many: string): string {
  if (!total) return '';
  const from = (page - 1) * DOCUMENTS_PAGE_SIZE + 1;
  const to = Math.min(total, from + shown - 1);
  const fmt = (n: number) => n.toLocaleString('es-BO');
  return `${fmt(from)}–${fmt(to)} de ${fmt(total)} ${total === 1 ? one : many}`;
}

export interface EditorLine {
  productId: string;
  sku: string;
  code: string;
  name: string;
  brandName: string;
  unitPrice: string;
  quantity: number;
  available: number;
  /** Measures and type of the product (HU-VEN-36). */
  spec: SalesLineSpec;
}

export interface EditorTotals {
  subtotal: string;
  discount: string;
  rounding: string;
  total: string;
}

/** The preview of the editor: the same `cartTotals` the server uses, with the customer's discount and the company's rounding. */
export function editorTotals(
  lines: readonly Pick<EditorLine, 'unitPrice' | 'quantity'>[],
  discount: { type: CustomerDiscountType; value: string } | null,
  roundingMode: RoundingMode,
): EditorTotals {
  const totals = cartTotals(lines, { roundingMode, discount });
  const rounding = totals.total.sub(totals.subtotal.sub(totals.discount));
  return {
    subtotal: totals.subtotal.toString(),
    discount: totals.discount.toString(),
    rounding: rounding.toString(),
    total: totals.total.toString(),
  };
}

export const isZero = (amount: string): boolean => Decimal.of(amount).isZero();

/** "Disponible 7" / "Sin existencia": what the editor says of the stock a line would take. */
export function stockHint(available: number, quantity: number): { text: string; short: boolean } {
  if (available <= 0) return { text: 'Sin existencia', short: true };
  return { text: `Disponible ${available}`, short: quantity > available };
}
