import type { TransferListItem, TransferStatus } from '@rodasoft/domain';
import type { DocTableRow, DocTableStatus, SelectOption } from '@rodasoft/ui';
import { formatMoney } from '../products/sheet/product-sheet.mapper';
import type { TransferListQuery } from './transfers-api.service';

/** Rows per page of the list (Figma DocTable with a 10-row pagination). */
export const TRANSFERS_PAGE_SIZE = 10;

/** Spanish label and pill color of each status (IN-05). */
export const TRANSFER_STATUS_PILLS: Record<TransferStatus, DocTableStatus> = {
  DRAFT: { label: 'Borrador', status: 'idle' },
  PENDING_APPROVAL: { label: 'Pendiente de aprobación', status: 'warning' },
  APPROVED: { label: 'Aprobada', status: 'info' },
  IN_TRANSIT: { label: 'En tránsito', status: 'info' },
  PARTIALLY_RECEIVED: { label: 'Recibida parcialmente', status: 'warning' },
  RECEIVED: { label: 'Recibida', status: 'success' },
  REJECTED: { label: 'Rechazada', status: 'danger' },
  CANCELLED: { label: 'Cancelada', status: 'idle' },
};

export const STATUS_OPTIONS: SelectOption[] = (Object.keys(TRANSFER_STATUS_PILLS) as TransferStatus[]).map((value) => ({
  value,
  label: TRANSFER_STATUS_PILLS[value].label,
}));

/** What the URL holds: every filter is optional and the page starts at 1. */
export interface TransferUrlFilters {
  q: string;
  status: TransferStatus | null;
  originWarehouseId: string | null;
  destinationWarehouseId: string | null;
  from: string | null;
  to: string | null;
  page: number;
}

export function parseStatus(raw: string | null): TransferStatus | null {
  return raw !== null && Object.hasOwn(TRANSFER_STATUS_PILLS, raw) ? (raw as TransferStatus) : null;
}

/** A calendar day as the date input writes it (`2026-10-28`); anything else is dropped. */
export function parseDay(raw: string | null): string | null {
  return raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** The filters of the URL as the API query; an empty filter is left out. */
export function toQuery(f: TransferUrlFilters): TransferListQuery {
  return {
    q: f.q || undefined,
    status: f.status ?? undefined,
    originWarehouseId: f.originWarehouseId ?? undefined,
    destinationWarehouseId: f.destinationWarehouseId ?? undefined,
    from: f.from ?? undefined,
    to: f.to ?? undefined,
    page: f.page,
    pageSize: TRANSFERS_PAGE_SIZE,
  };
}

const dateFormat = new Intl.DateTimeFormat('es-BO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/La_Paz' });
/** "28 oct 2026" in the business timezone, or a dash when there is no date. */
export function formatDay(iso: string | null): string {
  return iso ? dateFormat.format(new Date(iso)) : '–';
}

/** Row of the table: the number links to the transfer through a cell template; the pill is drawn by the table. */
export function toRow(item: TransferListItem): DocTableRow {
  return {
    id: item.id,
    label: item.number,
    cells: {
      number: item.number,
      // warehouses repeat their names across branches ("Principal"), so the branch says which one
      route: `${item.origin.branch.name} · ${item.origin.name} → ${item.destination.branch.name} · ${item.destination.name}`,
      status: TRANSFER_STATUS_PILLS[item.status],
      products: item.products,
      pieces: item.pieces,
      value: formatMoney(item.value),
      createdBy: item.createdBy ?? '–',
      createdAt: formatDay(item.createdAt),
      sentAt: formatDay(item.sentAt),
    },
  };
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
