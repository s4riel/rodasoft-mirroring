import { COST_SCALE, Decimal, MONEY_SCALE } from './money';
import type { StockMovementType } from './stock';
import { TRANSFER_RECEIPT_REF_TYPE, TRANSFER_REF_TYPE } from './transfer';
import { ADJUSTMENT_REF_TYPE } from './stock-adjustment';

/** Spanish display labels of the movement types in the kardex (user-facing text). */
export const STOCK_MOVEMENT_TYPE_LABELS: Record<StockMovementType, string> = {
  PURCHASE_RECEIPT: 'Compra',
  SALE: 'Venta',
  TRANSFER_OUT: 'Salida por transferencia',
  TRANSFER_IN: 'Entrada por transferencia',
  ADJUSTMENT_IN: 'Ajuste (+)',
  ADJUSTMENT_OUT: 'Ajuste (−)',
  INITIAL: 'Inventario inicial',
  RETURN: 'Devolución',
};

/** Longest date range one kardex request may cover. */
export const KARDEX_MAX_RANGE_DAYS = 366;

export const KARDEX_PAGE_SIZE_DEFAULT = 25;

/** Business timezone (`America/La_Paz`, UTC−4 all year, no DST). */
const LA_PAZ_OFFSET_HOURS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number): string => String(n).padStart(2, '0');

export interface KardexRange {
  /** First day, `YYYY-MM-DD` (La Paz). */
  from: string;
  /** Last day included, `YYYY-MM-DD` (La Paz). */
  to: string;
}

/** The current La Paz month, from its first to its last day. */
export function defaultKardexRange(now: Date): KardexRange {
  const local = new Date(now.getTime() - LA_PAZ_OFFSET_HOURS * 3_600_000);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const prefix = `${year}-${pad(month + 1)}`;
  return { from: `${prefix}-01`, to: `${prefix}-${pad(lastDay)}` };
}

/** Today in La Paz, `YYYY-MM-DD`. */
export function laPazToday(now: Date): string {
  const local = new Date(now.getTime() - LA_PAZ_OFFSET_HOURS * 3_600_000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

export type KardexRangeError = 'INVALID_DATE' | 'FROM_AFTER_TO' | 'RANGE_TOO_LONG';

/** Why a range cannot be used, or `null` when it can: both days exist, `from` is not after `to`, and it spans at most 366 days. */
export function kardexRangeError(range: KardexRange): KardexRangeError | null {
  if (!ISO_DAY.test(range.from) || !ISO_DAY.test(range.to)) return 'INVALID_DATE';
  const from = Date.parse(`${range.from}T00:00:00Z`);
  const to = Date.parse(`${range.to}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 'INVALID_DATE';
  // Date.parse rolls 2026-02-31 over to 3 March instead of failing
  if (new Date(from).toISOString().slice(0, 10) !== range.from || new Date(to).toISOString().slice(0, 10) !== range.to) return 'INVALID_DATE';
  if (from > to) return 'FROM_AFTER_TO';
  if (Math.round((to - from) / DAY_MS) + 1 > KARDEX_MAX_RANGE_DAYS) return 'RANGE_TOO_LONG';
  return null;
}

/**
 * Value of a movement: pieces x unit cost, as money ("1280.00"). `null` when the movement has no unit cost (older
 * movements, or a product with no cost), so the screen shows "—" instead of a made-up zero.
 */
export function kardexValue(quantity: number, unitCost: string | null): string | null {
  if (unitCost === null) return null;
  return Decimal.of(unitCost, COST_SCALE).mul(quantity, MONEY_SCALE).toString();
}

/** One movement of the kardex. The valued fields are present only when the member may see costs. */
export interface KardexRow {
  id: string;
  date: string;
  type: StockMovementType;
  typeLabel: string;
  /** Source document: refType ("SALE", "TRANSFER", "ADJUSTMENT", "PURCHASE") and its number for display. */
  document: { refType: string | null; refNumber: string | null };
  branch: { id: string; name: string };
  warehouse: { id: string; name: string };
  /** Name of the user who made the movement; `null` for system movements. */
  user: string | null;
  /** Pieces that came in (0 for an outflow). */
  quantityIn: number;
  /** Pieces that went out, as a positive number (0 for an inflow). */
  quantityOut: number;
  /** Balance of the scope after this row: the warehouse's balance, or the running total across warehouses. */
  balance: number;
  /** Balance of this row's own warehouse after it (the same as `balance` when one warehouse is selected). */
  warehouseBalance: number;
  unitCost?: string | null;
  valueIn?: string | null;
  valueOut?: string | null;
  /** `balance` valued at this movement's unit cost. */
  balanceValue?: string | null;
}

export interface KardexProduct {
  id: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  brand: string;
  unit: string;
  /** Sum of the product's `stock_levels` in the scope. */
  currentStock: number;
}

export interface KardexTotals {
  /** Pieces that came in within the range. */
  quantityIn: number;
  /** Pieces that went out within the range, as a positive number. */
  quantityOut: number;
  /** Opening balance + inflows − outflows. */
  closingBalance: number;
  valueIn?: string | null;
  valueOut?: string | null;
}

export interface KardexResponse {
  product: KardexProduct;
  /** Filters as applied, with the defaults filled in. */
  filters: { warehouseId: string | null; from: string; to: string };
  /** Stock in the scope just before `from`. */
  openingBalance: number;
  totals: KardexTotals;
  /** Whether the valued fields are present (`inventory.costs.view`). */
  includesCost: boolean;
  items: KardexRow[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Ledger: the movements of every product (IN-09 without a product) ─────────────────────────────────────────────

/** The pill of a movement: transfers have their own, everything else is an inflow or an outflow by its sign. */
export type KardexPill = 'IN' | 'OUT' | 'TRANSFER';

export const KARDEX_PILL_LABELS: Record<KardexPill, string> = { IN: 'Entrada', OUT: 'Salida', TRANSFER: 'Transferencia' };

export function movementPill(type: StockMovementType, quantity: number): KardexPill {
  if (type === 'TRANSFER_OUT' || type === 'TRANSFER_IN') return 'TRANSFER';
  return quantity >= 0 ? 'IN' : 'OUT';
}

/** The other side of a transfer movement, seen from the warehouse where the movement happened. */
export interface KardexCounterpart {
  direction: 'TO' | 'FROM';
  branch: string;
  warehouse: string;
  /** The transfer has been sent and not fully received. */
  inTransit: boolean;
}

/** "Hacia Sacaba · en tránsito", "Desde Huayna Kapac · Principal". */
export function kardexCounterpartText(c: KardexCounterpart): string {
  const side = c.direction === 'TO' ? 'Hacia' : 'Desde';
  return `${side} ${c.branch} · ${c.warehouse}${c.inTransit ? ' · en tránsito' : ''}`;
}

/** Which document screen a movement can open. */
export type KardexDocumentLink = { kind: 'TRANSFER' | 'ADJUSTMENT'; id: string };

/**
 * The document a movement came from, when the ERP has a screen for it: a transfer (its dispatch or its receipt) or an
 * adjustment document. A quick adjustment of the product sheet has a number but no document, so it has no link.
 */
export function kardexDocumentLink(refType: string | null, transferId: string | null, refId: string | null): KardexDocumentLink | null {
  if ((refType === TRANSFER_REF_TYPE || refType === TRANSFER_RECEIPT_REF_TYPE) && transferId) return { kind: 'TRANSFER', id: transferId };
  if (refType === ADJUSTMENT_REF_TYPE && refId) return { kind: 'ADJUSTMENT', id: refId };
  return null;
}

/** The ERP route of a document link. */
export function kardexDocumentRoute(link: KardexDocumentLink): string {
  return link.kind === 'TRANSFER' ? `/inventory/transfers/${link.id}` : `/inventory/adjustments/${link.id}`;
}

export interface KardexLedgerRow {
  id: string;
  date: string;
  type: StockMovementType;
  typeLabel: string;
  pill: KardexPill;
  document: { refType: string | null; refNumber: string | null };
  documentLink: KardexDocumentLink | null;
  product: { id: string; manufacturerCode: string; name: string; brand: string };
  branch: { id: string; name: string };
  warehouse: { id: string; name: string };
  counterpart: KardexCounterpart | null;
  user: string | null;
  /** Signed: positive adds stock. */
  quantity: number;
  /** Balance of this product in this warehouse after the movement. */
  balance: number;
  unitCost?: string | null;
  /** Absolute value of the movement; present with the unit cost. */
  value?: string | null;
}

export interface KardexLedgerTotals {
  quantityIn: number;
  /** As a positive number. */
  quantityOut: number;
  /** Inflows minus outflows. */
  net: number;
}

/** What the ledger was filtered by, with the dates filled in. */
export interface KardexLedgerFilters {
  warehouseId: string | null;
  branchId: string | null;
  type: StockMovementType | null;
  q: string | null;
  from: string;
  to: string;
}

export interface KardexLedgerResponse {
  filters: KardexLedgerFilters;
  includesCost: boolean;
  totals: KardexLedgerTotals;
  items: KardexLedgerRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** Longest search text of the ledger. */
export const KARDEX_SEARCH_MAX = 100;
