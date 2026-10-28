import type { WarehouseListItem, WarehouseStatus } from '@rodasoft/domain';
import type { DocTableRow, SelectOption } from '@rodasoft/ui';
import type { WarehouseListQuery } from './warehouses-api.service';

/** Rows per page of the list (Figma DocTable with a 10-row pagination). */
export const WAREHOUSES_PAGE_SIZE = 10;

export const STATUS_OPTIONS: SelectOption[] = [
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'INACTIVE', label: 'Inactivo' },
];

/** What the URL holds: every filter is optional and the page starts at 1. */
export interface WarehouseUrlFilters {
  q: string;
  branchId: string | null;
  status: WarehouseStatus | null;
  page: number;
}

export function parseStatus(raw: string | null): WarehouseStatus | null {
  return raw === 'ACTIVE' || raw === 'INACTIVE' ? raw : null;
}

/** The filters of the URL as the API query; an empty filter is left out. */
export function toQuery(f: WarehouseUrlFilters): WarehouseListQuery {
  return {
    q: f.q || undefined,
    branchId: f.branchId ?? undefined,
    status: f.status ?? undefined,
    page: f.page,
    pageSize: WAREHOUSES_PAGE_SIZE,
  };
}

/** Row of the table: the code and the pills are drawn from the item by cell templates where they need more than text. */
export function toRow(item: WarehouseListItem): DocTableRow {
  return {
    id: item.id,
    label: item.code,
    cells: {
      code: item.code,
      name: item.name,
      branch: item.branch.name,
      main: item.isMain ? { label: 'Principal', status: 'info' } : null,
      visibleInStore: item.visibleInStore
        ? { label: 'Visible', status: 'success' }
        : { label: 'Oculto', status: 'idle' },
      products: item.productCount,
      units: item.totalUnits,
      status: item.status === 'ACTIVE' ? { label: 'Activo', status: 'success' } : { label: 'Inactivo', status: 'idle' },
    },
  };
}

/** "1–10 de 23 almacenes", or empty when there are none. */
export function rangeLabel(page: number, shown: number, total: number): string {
  if (!total) return '';
  const from = (page - 1) * WAREHOUSES_PAGE_SIZE + 1;
  const to = Math.min(total, from + shown - 1);
  const fmt = (n: number) => n.toLocaleString('es-BO');
  return `${fmt(from)}–${fmt(to)} de ${fmt(total)} ${total === 1 ? 'almacén' : 'almacenes'}`;
}

/** Spanish messages of the codes the warehouse form can get; the shared map covers the rest. */
export const WAREHOUSE_ERROR_MESSAGES: Record<string, string> = {
  WAREHOUSE_CODE_EXISTS: 'Ya existe un almacén con este código.',
  BRANCH_INVALID: 'La sucursal elegida no existe o está inactiva.',
  BRANCH_FORBIDDEN: 'No puedes operar en esta sucursal.',
  WAREHOUSE_BRANCH_LOCKED: 'La sucursal no se puede cambiar: el almacén ya tiene movimientos.',
  WAREHOUSE_HAS_STOCK: 'No se puede desactivar: el almacén todavía tiene stock.',
  WAREHOUSE_MAIN_REQUIRED: 'Define otro almacén como principal antes de quitar o desactivar este.',
  WAREHOUSE_MAIN_INACTIVE: 'Un almacén inactivo no puede ser el principal.',
  WAREHOUSE_MODIFIED: 'Otro usuario modificó este almacén. Recarga para ver los cambios.',
  WAREHOUSE_NOT_FOUND: 'El almacén ya no existe. Vuelve al listado.',
};

/** The code is the only field the server can refuse for a reason tied to one input. */
export function fieldOfError(code: string): 'code' | 'branchId' | null {
  if (code === 'WAREHOUSE_CODE_EXISTS') return 'code';
  if (code === 'BRANCH_INVALID' || code === 'BRANCH_FORBIDDEN' || code === 'WAREHOUSE_BRANCH_LOCKED') return 'branchId';
  return null;
}
