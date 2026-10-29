import { ADJUSTMENT_REASON_LABELS, ADJUSTMENT_REASONS, type AdjustmentListItem, type AdjustmentReason, type StockAdjustmentDocumentStatus } from '@rodasoft/domain';
import type { DocTableCell, DocTableRow, DocTableStatus, SelectOption } from '@rodasoft/ui';
import { formatMoney } from '../products/sheet/product-sheet.mapper';
import { formatNumericDay } from '../transfers/transfers.mapper';
import type { AdjustmentListQuery } from './adjustments-api.service';

/** Rows per page of the list (Figma DocTable with a 10-row pagination). */
export const ADJUSTMENTS_PAGE_SIZE = 10;

/** Spanish label, pill color and icon of each status (IN-27). A manual adjustment is always "Aplicado". */
export const ADJUSTMENT_STATUS_PILLS: Record<StockAdjustmentDocumentStatus, DocTableStatus> = {
  APPROVED: { label: 'Aplicado', status: 'success', icon: 'check' },
  PENDING_APPROVAL: { label: 'Pendiente de aprobación', status: 'warning', icon: 'alert' },
  REJECTED: { label: 'Rechazado', status: 'danger', icon: 'alert' },
};

export const STATUS_OPTIONS: SelectOption[] = (Object.keys(ADJUSTMENT_STATUS_PILLS) as StockAdjustmentDocumentStatus[]).map((value) => ({
  value,
  label: ADJUSTMENT_STATUS_PILLS[value].label,
}));

export const REASON_OPTIONS: SelectOption[] = ADJUSTMENT_REASONS.map((value) => ({ value, label: ADJUSTMENT_REASON_LABELS[value] }));

/** Spanish label of a line kind. */
export const KIND_LABELS = {
  IN: 'Entrada',
  OUT: 'Salida',
  COUNT: 'Conteo',
  SHORTAGE: 'Faltante',
  SURPLUS: 'Sobrante',
  MANUAL: 'Manual',
} as const;

/** What the URL holds: every filter is optional and the page starts at 1. */
export interface AdjustmentUrlFilters {
  q: string;
  status: StockAdjustmentDocumentStatus | null;
  warehouseId: string | null;
  reason: AdjustmentReason | null;
  from: string | null;
  to: string | null;
  page: number;
}

export function parseStatus(raw: string | null): StockAdjustmentDocumentStatus | null {
  return raw !== null && Object.hasOwn(ADJUSTMENT_STATUS_PILLS, raw) ? (raw as StockAdjustmentDocumentStatus) : null;
}

export function parseReason(raw: string | null): AdjustmentReason | null {
  return raw !== null && (ADJUSTMENT_REASONS as readonly string[]).includes(raw) ? (raw as AdjustmentReason) : null;
}

/** A `YYYY-MM-DD` date, or null for anything else (a hand-edited URL). */
export function parseDate(raw: string | null): string | null {
  return raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** The filters of the URL as the API query; an empty filter is left out. */
export function toQuery(f: AdjustmentUrlFilters): AdjustmentListQuery {
  return {
    q: f.q || undefined,
    status: f.status ?? undefined,
    warehouseId: f.warehouseId ?? undefined,
    reason: f.reason ?? undefined,
    from: f.from ?? undefined,
    to: f.to ?? undefined,
    page: f.page,
    pageSize: ADJUSTMENTS_PAGE_SIZE,
  };
}

/** Row of the table: the number links to the detail through a cell template; the pill is drawn by the table. */
export function toRow(item: AdjustmentListItem): DocTableRow {
  return {
    id: item.id,
    label: item.number,
    cells: {
      number: item.number,
      date: formatNumericDay(item.createdAt),
      warehouse: `${item.warehouse.branch.name} · ${item.warehouse.name}`,
      reason: item.reason,
      lines: item.lines,
      value: item.value === null ? '–' : formatMoney(item.value),
      createdBy: item.createdBy ?? '–',
      status: ADJUSTMENT_STATUS_PILLS[item.status],
    },
  };
}

/** The total row of IN-27: how many adjustments the page shows and how many lines they carry. */
export function toTotals(items: readonly AdjustmentListItem[]): Record<string, DocTableCell> {
  return {
    number: 'Total',
    date: '',
    warehouse: `${items.length} ${items.length === 1 ? 'ajuste' : 'ajustes'}`,
    reason: '',
    lines: items.reduce((sum, i) => sum + i.lines, 0),
    value: '',
    createdBy: '',
    status: '—',
  };
}

/** "1–10 de 23 ajustes", or empty when there are none. */
export function rangeLabel(page: number, shown: number, total: number): string {
  if (!total) return '';
  const from = (page - 1) * ADJUSTMENTS_PAGE_SIZE + 1;
  const to = Math.min(total, from + shown - 1);
  const fmt = (n: number) => n.toLocaleString('es-BO');
  return `${fmt(from)}–${fmt(to)} de ${fmt(total)} ${total === 1 ? 'ajuste' : 'ajustes'}`;
}

/** Spanish messages of the codes adjustments can get; the shared map covers the rest. */
export const ADJUSTMENT_ERROR_MESSAGES: Record<string, string> = {
  REASON_REQUIRED: 'Elige el motivo del ajuste.',
  REASON_NOTE_REQUIRED: 'Describe el motivo cuando eliges "Otro".',
  ADJUSTMENT_EMPTY: 'Agrega al menos un producto al ajuste.',
  DUPLICATE_LINE: 'Un producto solo puede aparecer una vez en el ajuste.',
  NO_STOCK_CHANGE: 'Ninguna línea cambia el stock: los conteos son iguales al stock actual.',
  INSUFFICIENT_STOCK: 'El stock cambió y ya no alcanza para alguna salida. Revisa las cantidades.',
  STOCK_CHANGED: 'El stock de un producto cambió mientras armabas el ajuste. Actualizamos su stock actual: revisa las cantidades y confirma de nuevo.',
  WAREHOUSE_NOT_FOUND: 'El almacén elegido ya no existe o no lo operas.',
  PRODUCT_NOT_FOUND: 'Algún producto del ajuste ya no existe.',
  ADJUSTMENT_NOT_FOUND: 'El ajuste ya no existe. Vuelve al listado.',
  TOO_MANY_LINES: 'Un ajuste admite hasta 200 productos.',
  FILE_INVALID: 'No pudimos leer el archivo. Usa un .xlsx o .csv con código, cantidad y, si quieres, el tipo.',
  FILE_TOO_LARGE: 'El archivo supera el límite de 1 MB.',
};

/** Spanish reason a line of a pasted or uploaded list could not be read. */
export const PASTE_ERROR_LABELS = {
  MISSING_CODE: 'Falta el código',
  MISSING_QUANTITY: 'Falta la cantidad',
  INVALID_QUANTITY: 'La cantidad debe ser un entero (mínimo 1, o 0 en un conteo)',
  INVALID_KIND: 'El tipo debe ser Entrada, Salida o Conteo',
  DUPLICATE_CODE: 'El producto ya está en la lista',
} as const;

/** The Spanish message of an API problem: the adjustment-specific one when the code has it, else the server's own. */
export function adjustmentErrorMessage(problem: { code: string; message: string }): string {
  return ADJUSTMENT_ERROR_MESSAGES[problem.code] ?? problem.message;
}
