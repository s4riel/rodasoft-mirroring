import type { TransferListItem, TransferStatus } from '@rodasoft/domain';
import type { DocTableCell, DocTableRow, DocTableStatus, RowMenuItem, SelectOption } from '@rodasoft/ui';
import { RECEIPT_ERROR_MESSAGES } from './transfer-receipt';
import type { TransferListQuery } from './transfers-api.service';

/** Rows per page of the list (Figma DocTable with a 10-row pagination). */
export const TRANSFERS_PAGE_SIZE = 10;

/**
 * Spanish label, pill color and icon of each status (IN-05). The Figma StatusPill draws a check for success and an alert
 * for the other colors; idle has none.
 */
export const TRANSFER_STATUS_PILLS: Record<TransferStatus, DocTableStatus> = {
  DRAFT: { label: 'Borrador', status: 'idle' },
  PENDING_APPROVAL: { label: 'Pendiente de aprobación', status: 'warning', icon: 'alert' },
  APPROVED: { label: 'Aprobada', status: 'info', icon: 'alert' },
  IN_TRANSIT: { label: 'En tránsito', status: 'info', icon: 'alert' },
  PARTIALLY_RECEIVED: { label: 'Recibida parcialmente', status: 'warning', icon: 'alert' },
  RECEIVED: { label: 'Recibida', status: 'success', icon: 'check' },
  REJECTED: { label: 'Rechazada', status: 'danger', icon: 'alert' },
  CANCELLED: { label: 'Cancelada', status: 'idle' },
};

/** The tooltip of the warning next to the status of a transfer whose receipt left an adjustment waiting for approval. */
export function pendingAdjustmentTooltip(number: string): string {
  return `Tiene el ajuste ${number} pendiente de aprobación: la recepción tuvo diferencias (faltantes o sobrantes) que deben revisarse.`;
}

/** The statuses a transfer can reach. There is no approval step, so the filter does not offer the approval statuses. */
const FILTERABLE_STATUSES: readonly TransferStatus[] = ['DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];

export const STATUS_OPTIONS: SelectOption[] = FILTERABLE_STATUSES.map((value) => ({ value, label: TRANSFER_STATUS_PILLS[value].label }));

/** What the URL holds: every filter is optional and the page starts at 1. */
export interface TransferUrlFilters {
  q: string;
  status: TransferStatus | null;
  originWarehouseId: string | null;
  destinationWarehouseId: string | null;
  page: number;
}

export function parseStatus(raw: string | null): TransferStatus | null {
  return raw !== null && Object.hasOwn(TRANSFER_STATUS_PILLS, raw) ? (raw as TransferStatus) : null;
}

/** The filters of the URL as the API query; an empty filter is left out. */
export function toQuery(f: TransferUrlFilters): TransferListQuery {
  return {
    q: f.q || undefined,
    status: f.status ?? undefined,
    originWarehouseId: f.originWarehouseId ?? undefined,
    destinationWarehouseId: f.destinationWarehouseId ?? undefined,
    page: f.page,
    pageSize: TRANSFERS_PAGE_SIZE,
  };
}

const dateFormat = new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/La_Paz' });
/** "28 oct 2026" in the business timezone, or a dash when there is no date. */
export function formatDay(iso: string | null): string {
  return iso ? dateFormat.format(new Date(iso)) : '–';
}

const timeFormat = new Intl.DateTimeFormat('es-BO', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'America/La_Paz' });
/** "14 oct 2026 · 09:30" in the business timezone, or a dash when there is no date. */
export function formatDayTime(iso: string | null): string {
  return iso ? `${formatDay(iso)} · ${timeFormat.format(new Date(iso))}` : '–';
}

const numericDayFormat = new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/La_Paz' });
/** "14/10/2026" in the business timezone, as the Fecha column of IN-05 shows it. */
export function formatNumericDay(iso: string): string {
  return numericDayFormat.format(new Date(iso));
}

/**
 * "Huayna Kapac → Sacaba": the branches, as in IN-05. Warehouses repeat their names across branches ("Principal"), so they
 * only appear when both sides are the same branch and the branch alone would not tell the two apart.
 */
export function routeOf(item: Pick<TransferListItem, 'origin' | 'destination'>): string {
  const { origin, destination } = item;
  return origin.branch.id === destination.branch.id
    ? `${origin.branch.name} · ${origin.name} → ${destination.name}`
    : `${origin.branch.name} → ${destination.branch.name}`;
}

/** The "Detalle" column: what happened last to the transfer, in a sentence. */
export function detailOf(item: Pick<TransferListItem, 'status' | 'createdBy' | 'sentBy'>): string {
  switch (item.status) {
    case 'DRAFT':
      return item.createdBy ? `Borrador de ${item.createdBy}` : 'Borrador';
    case 'PENDING_APPROVAL':
      return 'Espera la aprobación de un responsable';
    case 'APPROVED':
      return 'Aprobada, lista para enviar';
    case 'IN_TRANSIT':
      return item.sentBy ? `Enviada por ${item.sentBy}` : 'Enviada';
    case 'PARTIALLY_RECEIVED':
      return 'Recibida en parte';
    case 'RECEIVED':
      return 'Recibida completa';
    case 'REJECTED':
      return 'Rechazada';
    case 'CANCELLED':
      return 'Cancelada';
  }
}

/** Row of the table: the number links to the transfer through a cell template; the pill is drawn by the table. */
export function toRow(item: TransferListItem): DocTableRow {
  return {
    id: item.id,
    label: item.number,
    cells: {
      number: item.number,
      route: routeOf(item),
      detail: detailOf(item),
      products: item.products,
      // the day it left, or the day it was created while it is still a draft
      date: formatNumericDay(item.sentAt ?? item.createdAt),
      status: TRANSFER_STATUS_PILLS[item.status],
    },
  };
}

/** The total row of IN-05: how many transfers the page shows and how many items they carry. */
export function toTotals(items: readonly TransferListItem[]): Record<string, DocTableCell> {
  return {
    number: 'Total',
    route: `${items.length} ${items.length === 1 ? 'transferencia' : 'transferencias'}`,
    detail: '',
    products: items.reduce((sum, i) => sum + i.products, 0),
    date: '—',
    status: '—',
  };
}

/** The CSV columns of "Exportar": the ones the table shows, with the route split into its two sides. */
const CSV_HEADER = ['N.º', 'Origen', 'Destino', 'Detalle', 'Ítems', 'Fecha', 'Estado'];

/** A CSV field: quoted when it holds the separator, a quote or a line break (`;` is what Excel in Spanish expects). */
function csvField(value: string | number): string {
  const text = String(value);
  return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** The transfers as CSV text, one line each, in the order and wording of the table. */
export function toCsv(items: readonly TransferListItem[]): string {
  const lines = items.map((i) =>
    [
      i.number,
      `${i.origin.branch.name} · ${i.origin.name}`,
      `${i.destination.branch.name} · ${i.destination.name}`,
      detailOf(i),
      i.products,
      formatNumericDay(i.sentAt ?? i.createdAt),
      TRANSFER_STATUS_PILLS[i.status].label,
    ]
      .map(csvField)
      .join(';'),
  );
  return [CSV_HEADER.join(';'), ...lines].join('\r\n');
}

/** What "Ver detalle" or "Editar borrador" is for a row: a draft is edited, anything else is read. */
export function rowMenuOf(item: Pick<TransferListItem, 'status'>): RowMenuItem[] {
  return item.status === 'DRAFT'
    ? [{ key: 'open', label: 'Editar borrador', icon: 'edit' }]
    : [{ key: 'open', label: 'Ver detalle', icon: 'eye' }];
}

/** "1–10 de 23 transferencias", or empty when there are none. */
export function rangeLabel(page: number, shown: number, total: number): string {
  if (!total) return '';
  const from = (page - 1) * TRANSFERS_PAGE_SIZE + 1;
  const to = Math.min(total, from + shown - 1);
  const fmt = (n: number) => n.toLocaleString('es-BO');
  return `${fmt(from)}–${fmt(to)} de ${fmt(total)} ${total === 1 ? 'transferencia' : 'transferencias'}`;
}

/** Spanish messages of the codes transfers can get; the shared map covers the rest. */
export const TRANSFER_ERROR_MESSAGES: Record<string, string> = {
  SAME_WAREHOUSE: 'El origen y el destino deben ser almacenes distintos.',
  WAREHOUSE_INACTIVE: 'Uno de los almacenes está inactivo.',
  WAREHOUSE_NOT_FOUND: 'El almacén elegido ya no existe.',
  BRANCH_FORBIDDEN: 'No puedes enviar desde una sucursal que no operas.',
  TOO_MANY_LINES: 'La transferencia supera el máximo de productos permitido.',
  TRANSFER_NOT_FOUND: 'La transferencia ya no existe. Vuelve al listado.',
  TRANSFER_MODIFIED: 'Otro usuario modificó esta transferencia. Recarga para ver los cambios.',
  TRANSFER_NOT_EDITABLE: 'Solo se puede editar un borrador.',
  TRANSFER_EMPTY: 'Agrega al menos un producto antes de enviar.',
  TRANSFER_HAS_ERRORS: 'Hay productos con errores. Corrígelos antes de enviar.',
  INSUFFICIENT_STOCK: 'El stock del origen cambió y ya no alcanza para algún producto. Revisa las cantidades.',
  INVALID_TRANSITION: 'La transferencia ya cambió de estado. Recarga para ver el estado actual.',
  FILE_INVALID: 'No pudimos leer el archivo. Usa un .xlsx o .csv con código y cantidad.',
  FILE_TOO_LARGE: 'El archivo supera el límite de 1 MB.',
  PRODUCT_NOT_FOUND: 'Algún producto de la lista ya no existe.',
  ...RECEIPT_ERROR_MESSAGES,
};

/** The Spanish message of an API problem: the transfer-specific one when the code has it, else the server's own. */
export function transferErrorMessage(problem: { code: string; message: string }): string {
  return TRANSFER_ERROR_MESSAGES[problem.code] ?? problem.message;
}

/** Spanish reason of a line of a pasted list that could not be read. */
export const PASTE_ERROR_LABELS = {
  MISSING_CODE: 'Falta el código',
  MISSING_QUANTITY: 'Falta la cantidad',
  INVALID_QUANTITY: 'La cantidad debe ser un entero mayor que 0',
} as const;
