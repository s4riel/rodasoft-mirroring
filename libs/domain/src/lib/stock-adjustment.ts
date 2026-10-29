import { COST_SCALE, Decimal } from './money';
import type { MovementDirection } from './stock';

/** Reason catalog of a stock adjustment (design-notes: shrinkage, count error, damage, other). */
export const ADJUSTMENT_REASONS = ['SHRINKAGE', 'COUNT_ERROR', 'DAMAGE', 'OTHER'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** Spanish display labels of the reasons (user-facing text). */
export const ADJUSTMENT_REASON_LABELS: Record<AdjustmentReason, string> = {
  SHRINKAGE: 'Merma',
  COUNT_ERROR: 'Error de conteo',
  DAMAGE: 'Daño',
  OTHER: 'Otro',
};

/** `refType` of the movements written by an adjustment, and the prefix of their document number. */
export const ADJUSTMENT_REF_TYPE = 'ADJUSTMENT';
export const ADJUSTMENT_NUMBER_PREFIX = 'AJ-';

/** Reason of the adjustment that a transfer receipt with differences creates (HU-INV-21). */
export const TRANSFER_DIFFERENCE_REASON = 'Diferencia en transferencia';

/** Longest note the movement reason can carry next to the reason label. */
export const ADJUSTMENT_NOTE_MAX = 200;

/**
 * What the user is doing: take pieces in (`IN`), take pieces out (`OUT`), or correct the stock to what was counted
 * (`COUNT`, where the quantity is the counted stock and the movement is the difference).
 */
export const ADJUSTMENT_KINDS = ['IN', 'OUT', 'COUNT'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export type AdjustmentErrorCode = 'REASON_REQUIRED' | 'REASON_NOTE_REQUIRED' | 'NO_STOCK_CHANGE';

export class AdjustmentError extends Error {
  constructor(
    readonly code: AdjustmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AdjustmentError';
  }
}

export interface QuickAdjustmentInput {
  warehouseId: string;
  kind: AdjustmentKind;
  /** Whole pieces: at least 1 for `IN` and `OUT`; the counted stock (0 or more) for `COUNT`. */
  quantity: number;
  reason: AdjustmentReason;
  note?: string;
  /** Balance the user saw; the adjustment is refused if the locked balance differs. */
  expectedBalance?: number;
}

export interface QuickAdjustmentResponse {
  movementId: string;
  refNumber: string;
  balanceAfter: number;
  /** Sum of the product's levels in every warehouse after the adjustment. */
  totalStock: number;
}

export interface AdjustmentMovement {
  type: 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT';
  signedQuantity: number;
  /** Text stored on the movement: the reason label, plus the note when there is one. */
  reasonText: string;
}

/**
 * The movement a kind and quantity mean against the balance on hand: `IN` and `OUT` are the quantity as given, `COUNT`
 * is the difference between the counted stock and the balance. A count equal to the balance changes nothing and is refused.
 */
export function resolveAdjustment(input: {
  kind: AdjustmentKind;
  quantity: number;
  balance: number;
}): { direction: MovementDirection; quantity: number } {
  const { kind, quantity, balance } = input;
  if (!Number.isInteger(quantity) || !Number.isInteger(balance)) throw new RangeError('Stock quantities are whole numbers');
  if (kind === 'COUNT') {
    if (quantity < 0) throw new RangeError('The counted stock cannot be negative');
    const delta = quantity - balance;
    if (delta === 0) throw new AdjustmentError('NO_STOCK_CHANGE', 'The counted stock equals the current stock');
    return { direction: delta > 0 ? 'IN' : 'OUT', quantity: Math.abs(delta) };
  }
  if (quantity < 1) throw new RangeError('The adjusted quantity is a whole number of at least 1');
  return { direction: kind, quantity };
}

/**
 * Turns the user's choice into the movement to write (HU-INV-16). The reason is mandatory and "Otro" needs a note;
 * the stored text is the Spanish label, because the kardex shows it as is.
 */
export function buildAdjustmentMovement(input: {
  direction: MovementDirection;
  quantity: number;
  reason: AdjustmentReason | null | undefined;
  note?: string | null;
}): AdjustmentMovement {
  if (!input.reason || !ADJUSTMENT_REASONS.includes(input.reason)) {
    throw new AdjustmentError('REASON_REQUIRED', 'An adjustment needs a reason');
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new RangeError('The adjusted quantity is a whole number of at least 1');
  }
  const note = input.note?.trim() ?? '';
  if (input.reason === 'OTHER' && !note) {
    throw new AdjustmentError('REASON_NOTE_REQUIRED', 'The reason "Otro" needs a note');
  }
  const label = ADJUSTMENT_REASON_LABELS[input.reason];
  const incoming = input.direction === 'IN';
  return {
    type: incoming ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
    signedQuantity: incoming ? input.quantity : -input.quantity,
    reasonText: note ? `${label}: ${note}` : label,
  };
}

/**
 * Whether an adjustment is worth more than the company's limit (decision #37). The value is `quantity × unitCost`,
 * compared strictly: a value equal to the limit does not need approval. No limit, or no cost to value it with, never asks.
 */
export function needsApproval(quantity: number, unitCost: string | null, threshold: string | null): boolean {
  if (threshold === null || unitCost === null) return false;
  const value = Decimal.of(unitCost, COST_SCALE).mul(Math.abs(quantity), COST_SCALE);
  return value.cmp(Decimal.of(threshold, COST_SCALE)) > 0;
}

/** Formats the sequential document number of an adjustment: `AJ-000123`. */
export function formatAdjustmentNumber(sequence: number): string {
  return `${ADJUSTMENT_NUMBER_PREFIX}${String(sequence).padStart(6, '0')}`;
}

/** The sequence inside an adjustment number, or null when the text is not one. Older numbers may be shorter (`AJ-0015`). */
export function parseAdjustmentNumber(refNumber: string): number | null {
  const match = /^AJ-(\d+)$/.exec(refNumber);
  return match ? Number(match[1]) : null;
}
