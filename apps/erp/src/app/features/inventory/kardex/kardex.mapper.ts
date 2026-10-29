import {
  defaultKardexRange,
  KARDEX_PILL_LABELS,
  kardexCounterpartText,
  type KardexLedgerResponse,
  type KardexLedgerRow,
  type KardexPill,
  type KardexResponse,
  type KardexRow,
  kardexDocumentRoute,
  STOCK_MOVEMENT_TYPE_LABELS,
  STOCK_MOVEMENT_TYPES,
  type StockMovementType,
} from '@rodasoft/domain';
import type { DocTableCell, DocTableColumn, DocTableRow, DocTableStatus, RowMenuItem, SelectOption } from '@rodasoft/ui';
import { formatMoney } from '../products/sheet/product-sheet.mapper';
import { formatSigned } from '../products/sheet/movements/movement.mapper';
import { formatNumericDay } from '../transfers/transfers.mapper';
import type { KardexQuery } from './kardex-api.service';

/** Rows per page of the kardex. */
export const KARDEX_PAGE_SIZE = 25;

/**
 * What the URL holds. Every filter is optional: without dates the API shows the current month, and without a product the
 * page shows the ledger of every movement (where `q`, `type` and `branchId` apply).
 */
export interface KardexUrlFilters {
  productId: string | null;
  warehouseId: string | null;
  branchId: string | null;
  type: StockMovementType | null;
  q: string;
  from: string | null;
  to: string | null;
  page: number;
}

/** A movement type of the URL, or null for anything else (a hand-edited URL). */
export function parseType(raw: string | null): StockMovementType | null {
  return raw !== null && (STOCK_MOVEMENT_TYPES as readonly string[]).includes(raw) ? (raw as StockMovementType) : null;
}

/** The "Tipo" filter: the eight real movement types, with their Spanish names. */
export const TYPE_OPTIONS: SelectOption[] = STOCK_MOVEMENT_TYPES.map((value) => ({ value, label: STOCK_MOVEMENT_TYPE_LABELS[value] }));

/** A `YYYY-MM-DD` date, or null for anything else (a hand-edited URL). */
export function parseDay(raw: string | null): string | null {
  return raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** The range the picker shows: the one in the URL, or the current month the API falls back to. */
export function shownRange(filters: Pick<KardexUrlFilters, 'from' | 'to'>, now: Date = new Date()): { from: string; to: string } {
  const fallback = defaultKardexRange(now);
  return { from: filters.from ?? fallback.from, to: filters.to ?? fallback.to };
}

/**
 * The filters of the URL as the API query. With a product it is the kardex of that product (warehouse and dates only);
 * without one it is the ledger, which also takes the branch, the type and the search text.
 */
export function toQuery(filters: KardexUrlFilters): KardexQuery {
  const common = {
    from: filters.from ?? undefined,
    to: filters.to ?? undefined,
    page: filters.page,
    pageSize: KARDEX_PAGE_SIZE,
  };
  if (filters.productId) return { productId: filters.productId, warehouseId: filters.warehouseId ?? undefined, ...common };
  return { ...common, branchId: filters.branchId ?? undefined, type: filters.type ?? undefined, q: filters.q || undefined };
}

/** Whether any filter of the ledger is set, so "Limpiar" has something to clear. */
export function hasLedgerFilters(filters: KardexUrlFilters): boolean {
  return !!(filters.q || filters.type || filters.branchId || filters.from || filters.to);
}

// ── Ledger (every movement) ───────────────────────────────────────────────────────────────────────────────────────

/** Figma Tipo pill of each kind of movement. */
export const LEDGER_PILLS: Record<KardexPill, DocTableStatus> = {
  IN: { label: KARDEX_PILL_LABELS.IN, status: 'success', icon: 'check' },
  OUT: { label: KARDEX_PILL_LABELS.OUT, status: 'warning', icon: 'alert' },
  TRANSFER: { label: KARDEX_PILL_LABELS.TRANSFER, status: 'info', icon: 'alert' },
};

/** The columns of the ledger; the valued ones only when the member may see costs. */
export function ledgerColumnsOf(includesCost: boolean): DocTableColumn[] {
  const columns: DocTableColumn[] = [
    { key: 'date', label: 'Fecha', type: 'number', width: '7.5rem' },
    { key: 'product', label: 'Producto', type: 'custom', width: '13rem' },
    { key: 'movement', label: 'Movimiento', type: 'text' },
    { key: 'detail', label: 'Detalle', type: 'custom' },
    { key: 'quantity', label: 'Cantidad', type: 'number', width: '6.5rem' },
    { key: 'balance', label: 'Saldo', type: 'number', width: '6rem' },
  ];
  if (includesCost) {
    columns.push({ key: 'unitCost', label: 'Costo unit.', type: 'number', width: '8rem' }, { key: 'value', label: 'Valor', type: 'number', width: '8rem' });
  }
  columns.push({ key: 'pill', label: 'Tipo', type: 'custom', width: '10rem' }, { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' });
  return columns;
}

/** "Compra COM-0112": the type of the movement and its document number. */
export function movementText(row: Pick<KardexLedgerRow, 'typeLabel' | 'document'>): string {
  return row.document.refNumber ? `${row.typeLabel} ${row.document.refNumber}` : row.typeLabel;
}

/** The line under the location in the Detalle column: where a transfer goes to or comes from; empty for any other movement. */
export function counterpartText(row: Pick<KardexLedgerRow, 'counterpart'>): string {
  return row.counterpart ? kardexCounterpartText(row.counterpart) : '';
}

export function toLedgerRow(row: KardexLedgerRow, includesCost: boolean): DocTableRow {
  const cells: Record<string, DocTableCell> = {
    date: formatNumericDay(row.date),
    product: row.product.manufacturerCode,
    movement: movementText(row),
    detail: `${row.branch.name} · ${row.warehouse.name}`,
    quantity: formatSigned(row.quantity),
    balance: row.balance,
    pill: LEDGER_PILLS[row.pill],
  };
  if (includesCost) {
    cells['unitCost'] = money(row.unitCost);
    cells['value'] = money(row.value);
  }
  return { id: row.id, label: movementText(row), cells };
}

/** The total row of the ledger: how many movements match and what they net out to. */
export function ledgerTotalsRow(response: Pick<KardexLedgerResponse, 'totals' | 'total' | 'includesCost'>): Record<string, DocTableCell> {
  const cells: Record<string, DocTableCell> = {
    date: 'Total',
    product: '',
    movement: `${response.total.toLocaleString('es-BO')} ${response.total === 1 ? 'movimiento' : 'movimientos'}`,
    detail: '',
    quantity: formatSigned(response.totals.net),
    balance: '–',
    pill: '',
    actions: '',
  };
  if (response.includesCost) Object.assign(cells, { unitCost: '', value: '' });
  return cells;
}

/** The row menu of a ledger row: its document when the ERP has a screen for it, and the kardex of its product. */
export function ledgerMenuOf(row: Pick<KardexLedgerRow, 'documentLink'>): RowMenuItem[] {
  const items: RowMenuItem[] = [];
  if (row.documentLink) items.push({ key: 'document', label: 'Ver documento', icon: 'eye' });
  items.push({ key: 'product', label: 'Ver kardex del producto', icon: 'bearing' });
  return items;
}

/** The ERP route of the document a ledger row came from, or null when it has none. */
export function ledgerDocumentRoute(row: Pick<KardexLedgerRow, 'documentLink'>): string | null {
  return row.documentLink ? kardexDocumentRoute(row.documentLink) : null;
}

/** The columns of IN-09 in order; the valued ones only when the member may see costs. */
export function columnsOf(includesCost: boolean): DocTableColumn[] {
  const columns: DocTableColumn[] = [
    { key: 'date', label: 'Fecha', type: 'number', width: '7.5rem' },
    { key: 'type', label: 'Tipo', type: 'text', width: '13rem' },
    { key: 'document', label: 'Documento', type: 'text' },
    { key: 'warehouse', label: 'Almacén', type: 'text' },
    { key: 'user', label: 'Usuario', type: 'text' },
    { key: 'in', label: 'Entrada', type: 'number', width: '6rem' },
    { key: 'out', label: 'Salida', type: 'number', width: '6rem' },
    { key: 'balance', label: 'Saldo', type: 'number', width: '6rem' },
  ];
  if (includesCost) {
    columns.push({ key: 'unitCost', label: 'Costo unit.', type: 'number', width: '8rem' }, { key: 'value', label: 'Valor', type: 'number', width: '8rem' });
  }
  return columns;
}

/** The document number of a movement, its type when it has no number, or a dash (the initial stock has neither). */
export function documentOf(row: Pick<KardexRow, 'document'>): string {
  const { refType, refNumber } = row.document;
  return refNumber ?? refType ?? '–';
}

const money = (amount: string | null | undefined) => (amount ? formatMoney(amount) : '–');

export function toRow(row: KardexRow, includesCost: boolean): DocTableRow {
  const cells: Record<string, DocTableCell> = {
    date: formatNumericDay(row.date),
    type: row.typeLabel,
    document: documentOf(row),
    warehouse: `${row.branch.name} · ${row.warehouse.name}`,
    user: row.user ?? '–',
    in: row.quantityIn || '',
    out: row.quantityOut || '',
    balance: row.balance,
  };
  if (includesCost) {
    cells['unitCost'] = money(row.unitCost);
    cells['value'] = money(row.quantityIn > 0 ? row.valueIn : row.valueOut);
  }
  return { id: row.id, label: `${row.typeLabel} ${documentOf(row)}`, cells };
}

/** The first row of the table: the stock the range starts from. */
export function openingRow(opening: number, includesCost: boolean): DocTableRow {
  const cells: Record<string, DocTableCell> = { date: '', type: 'Saldo inicial', document: '', warehouse: '', user: '', in: '', out: '', balance: opening };
  if (includesCost) Object.assign(cells, { unitCost: '', value: '' });
  return { id: 'opening', label: 'Saldo inicial', cells };
}

/** The footer of the table: pieces in and out of the whole range and the closing balance. */
export function totalsRow(response: Pick<KardexResponse, 'totals' | 'includesCost'>): Record<string, DocTableCell> {
  const cells: Record<string, DocTableCell> = {
    date: 'Saldo final',
    type: '',
    document: '',
    warehouse: '',
    user: '',
    in: response.totals.quantityIn,
    out: response.totals.quantityOut,
    balance: response.totals.closingBalance,
  };
  if (response.includesCost) Object.assign(cells, { unitCost: '', value: '' });
  return cells;
}

/** "1–25 de 80 movimientos", or empty when there are none. */
export function rangeLabel(page: number, shown: number, total: number): string {
  if (!total) return '';
  const from = (page - 1) * KARDEX_PAGE_SIZE + 1;
  const to = Math.min(total, from + shown - 1);
  const fmt = (n: number) => n.toLocaleString('es-BO');
  return `${fmt(from)}–${fmt(to)} de ${fmt(total)} ${total === 1 ? 'movimiento' : 'movimientos'}`;
}

/** Spanish messages of the codes the kardex can get; they replace the shared map, whose wording is for other screens. */
export const KARDEX_ERROR_MESSAGES: Record<string, string> = {
  PRODUCT_NOT_FOUND: 'El producto ya no existe. Elige otro.',
  WAREHOUSE_NOT_FOUND: 'El almacén elegido ya no existe o no lo operas.',
  BRANCH_NOT_FOUND: 'La sucursal elegida ya no existe.',
  BRANCH_NOT_ALLOWED: 'No puedes operar en esta sucursal.',
  INVALID_FILTER: 'Revisa las fechas: el rango no puede ser al revés ni superar un año.',
  EXPORT_TOO_LARGE: 'Hay demasiados movimientos para exportar. Elige un rango de fechas más corto.',
};

/** The Spanish message of an API problem: the kardex-specific one when the code has it, else the server's own. */
export function kardexErrorMessage(problem: { code: string; message: string }): string {
  return KARDEX_ERROR_MESSAGES[problem.code] ?? problem.message;
}
