/** Warehouse management (HU-INV-17): code rules, the deactivation rule and the contracts of the warehouses API. */

/** Upper-case letters, digits and `-`, 2 to 12 characters (e.g. `HK-01`). */
export const WAREHOUSE_CODE_PATTERN = /^[A-Z0-9-]{2,12}$/;
export const WAREHOUSE_NAME_MAX = 80;
export const WAREHOUSE_LOCATION_NOTE_MAX = 200;

export const WAREHOUSE_PAGE_SIZE_DEFAULT = 25;
export const WAREHOUSE_PAGE_SIZE_MAX = 100;

/** The code as stored: trimmed and upper case. Validate the result with `WAREHOUSE_CODE_PATTERN`. */
export function normalizeWarehouseCode(code: string): string {
  return code.trim().toUpperCase();
}

export type WarehouseDeactivationBlock = 'HAS_STOCK' | 'MAIN_REQUIRED';

/**
 * Whether a warehouse can be deactivated: it must hold no units, and it must not be the main one of its branch
 * (the user picks another main first, so a branch never loses its receiving warehouse by accident).
 */
export function canDeactivateWarehouse(warehouse: { totalUnits: number; isMain: boolean }): 'ok' | WarehouseDeactivationBlock {
  if (warehouse.totalUnits > 0) return 'HAS_STOCK';
  if (warehouse.isMain) return 'MAIN_REQUIRED';
  return 'ok';
}

export function clampWarehousePageSize(value: number | undefined): number {
  if (!value || !Number.isFinite(value) || value < 1) return WAREHOUSE_PAGE_SIZE_DEFAULT;
  return Math.min(Math.floor(value), WAREHOUSE_PAGE_SIZE_MAX);
}

export type WarehouseStatus = 'ACTIVE' | 'INACTIVE';

export interface WarehouseBranchRef {
  id: string;
  name: string;
}

/** One row of the warehouse list (IN-14). */
export interface WarehouseListItem {
  id: string;
  code: string;
  name: string;
  branch: WarehouseBranchRef;
  isMain: boolean;
  visibleInStore: boolean;
  status: WarehouseStatus;
  /** Products with units in this warehouse. */
  productCount: number;
  totalUnits: number;
}

export interface WarehouseListResponse {
  items: WarehouseListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** A warehouse as the form (IN-30a/b) loads it. */
export interface WarehouseDetail {
  id: string;
  code: string;
  name: string;
  branch: WarehouseBranchRef;
  isMain: boolean;
  visibleInStore: boolean;
  locationNote: string | null;
  status: WarehouseStatus;
  /** Echoed back as `expectedUpdatedAt` to detect a concurrent edit. */
  updatedAt: string;
  /** True once any stock movement exists: the branch can no longer change. */
  hasMovements: boolean;
  totalUnits: number;
}

export interface WarehouseCreateInput {
  code: string;
  name: string;
  branchId: string;
  isMain?: boolean;
  visibleInStore?: boolean;
  locationNote?: string | null;
}

export interface WarehouseUpdateInput {
  code?: string;
  name?: string;
  branchId?: string;
  isMain?: boolean;
  visibleInStore?: boolean;
  locationNote?: string | null;
  status?: WarehouseStatus;
  expectedUpdatedAt?: string;
}

/** Previous main warehouse that lost the flag because another one was set as main. */
export interface WarehouseSaveResponse {
  warehouse: WarehouseDetail;
  demotedMain: { id: string; code: string } | null;
}
