import type { StockAvailability } from './product-catalog';

/** Types of the immutable `stock_movements` history (mirrors the Prisma enum StockMovementType). */
export const STOCK_MOVEMENT_TYPES = [
  'PURCHASE_RECEIPT',
  'SALE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'INITIAL',
  'RETURN',
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

export type MovementDirection = 'IN' | 'OUT';

/** Inflow when the signed quantity is positive, outflow otherwise. */
export function movementDirection(quantity: number): MovementDirection {
  return quantity >= 0 ? 'IN' : 'OUT';
}

/** Business timezone (`America/La_Paz`, UTC−4 all year, no DST). */
const LA_PAZ_OFFSET_HOURS = 4;

/**
 * Start of the window of the last `days` La Paz calendar days, today included. The result is an instant:
 * La Paz midnight is 04:00 UTC of the same calendar date.
 */
export function movementWindowStart(now: Date, days = 30): Date {
  const local = new Date(now.getTime() - LA_PAZ_OFFSET_HOURS * 3_600_000);
  const midnightUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (days - 1), LA_PAZ_OFFSET_HOURS);
  return new Date(midnightUtc);
}

export interface ProductMovementItem {
  id: string;
  date: string;
  type: StockMovementType;
  /** Source document: refType ("SALE", "TRANSFER", "ADJUSTMENT", "PURCHASE") and its number for display. */
  document: { refType: string | null; refNumber: string | null };
  /** Signed quantity: positive adds stock. */
  quantity: number;
  balanceAfter: number;
  branch: { id: string; name: string };
  warehouse: { id: string; name: string };
}

export interface ProductMovementsSummary {
  /** Sum of inflows in the last 30 days. */
  inLast30Days: number;
  /** Sum of outflows in the last 30 days, as a positive number. */
  outLast30Days: number;
  /** Sum of the product's levels in the warehouses the member may see. */
  currentBalance: number;
}

export interface ProductMovementsResponse {
  items: ProductMovementItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: ProductMovementsSummary;
}

/** IN-23: one row per warehouse that has stock or thresholds. */
export interface ProductWarehouseStockItem {
  branch: { id: string; name: string };
  warehouse: { id: string; name: string };
  location: string | null;
  quantity: number;
  minStock: number | null;
  maxStock: number | null;
  availability: StockAvailability;
}

export interface ProductWarehouseStockResponse {
  items: ProductWarehouseStockItem[];
  /** Sum of the quantities shown (the footer "Total N uds"). */
  total: number;
}

/** Raised when a movement would leave a warehouse below zero and the company does not allow negative stock. */
export class InsufficientStockError extends Error {
  readonly code = 'INSUFFICIENT_STOCK';

  constructor(
    readonly currentQuantity: number,
    readonly delta: number,
  ) {
    super('Insufficient stock for this movement');
    this.name = 'InsufficientStockError';
  }
}

/**
 * Balance after a signed movement (HU-INV-06). Pure: the stock service locks the level row, calls this, then writes
 * both the level and the movement. Throws InsufficientStockError when the result would be negative and not allowed.
 */
export function applyMovement(currentQuantity: number, delta: number, allowNegative: boolean): { balanceAfter: number } {
  if (!Number.isInteger(currentQuantity) || !Number.isInteger(delta)) {
    throw new RangeError('Stock quantities are whole numbers');
  }
  const balanceAfter = currentQuantity + delta;
  if (balanceAfter < 0 && !allowNegative) throw new InsufficientStockError(currentQuantity, delta);
  return { balanceAfter };
}
