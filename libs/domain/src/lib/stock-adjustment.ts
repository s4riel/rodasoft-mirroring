import { COST_SCALE, Decimal, MONEY_SCALE } from './money';
import type { MovementDirection } from './stock';
import { isTransferHeaderRow, splitPasteLine } from './transfer';

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

export type AdjustmentErrorCode = 'REASON_REQUIRED' | 'REASON_NOTE_REQUIRED' | 'NO_STOCK_CHANGE' | 'ADJUSTMENT_EMPTY' | 'DUPLICATE_LINE';

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

// ── Adjustment documents (HU-INV-22) ──

/** Most lines one manual adjustment can carry. */
export const ADJUSTMENT_LINES_MAX = 200;
/** Largest quantity a line can hold. */
export const ADJUSTMENT_LINE_QUANTITY_MAX = 1_000_000;
export const ADJUSTMENT_PAGE_SIZE_DEFAULT = 25;
export const ADJUSTMENT_PAGE_SIZE_MAX = 100;

export interface AdjustmentDraftLine {
  productId: string;
  kind: AdjustmentKind;
  quantity: number;
}

/**
 * Checks what a manual adjustment needs before it touches the stock: a reason (and a note for "Otro"), at least one line,
 * no product twice, and whole quantities (at least 1 for `IN` and `OUT`, 0 or more for `COUNT`). Returns the reason and
 * the trimmed note to store.
 */
export function validateAdjustmentDraft(input: {
  reason: AdjustmentReason | null | undefined;
  note?: string | null;
  lines: readonly AdjustmentDraftLine[];
}): { reason: AdjustmentReason; note: string | null } {
  if (!input.reason || !ADJUSTMENT_REASONS.includes(input.reason)) {
    throw new AdjustmentError('REASON_REQUIRED', 'An adjustment needs a reason');
  }
  const note = input.note?.trim() ?? '';
  if (input.reason === 'OTHER' && !note) {
    throw new AdjustmentError('REASON_NOTE_REQUIRED', 'The reason "Otro" needs a note');
  }
  if (input.lines.length === 0) throw new AdjustmentError('ADJUSTMENT_EMPTY', 'An adjustment needs at least one line');
  const seen = new Set<string>();
  for (const line of input.lines) {
    if (seen.has(line.productId)) throw new AdjustmentError('DUPLICATE_LINE', 'A product can only appear once in an adjustment');
    seen.add(line.productId);
    if (!Number.isInteger(line.quantity)) throw new RangeError('Stock quantities are whole numbers');
    const minimum = line.kind === 'COUNT' ? 0 : 1;
    if (line.quantity < minimum) throw new RangeError(`The quantity must be at least ${minimum}`);
  }
  return { reason: input.reason, note: note || null };
}

/**
 * The change a line makes to the balance: `IN` adds the quantity, `OUT` takes it out, `COUNT` moves the stock to the
 * counted quantity. Unlike `resolveAdjustment`, a count equal to the balance is a delta of 0 (the document refuses it only
 * when every line is 0, see `assertStockChanges`).
 */
export function adjustmentDelta(input: { kind: AdjustmentKind; quantity: number; balance: number }): number {
  const { kind, quantity, balance } = input;
  if (!Number.isInteger(quantity) || !Number.isInteger(balance)) throw new RangeError('Stock quantities are whole numbers');
  if (kind === 'IN') return quantity;
  if (kind === 'OUT') return -quantity;
  if (quantity < 0) throw new RangeError('The counted stock cannot be negative');
  return quantity - balance;
}

/** An adjustment whose lines all leave the stock as it is changes nothing and is refused. */
export function assertStockChanges(deltas: readonly number[]): void {
  if (deltas.every((d) => d === 0)) throw new AdjustmentError('NO_STOCK_CHANGE', 'The adjustment does not change any stock');
}

/** Σ |delta| × unit cost, a decimal string with 2 decimals. A line without a cost is worth 0. */
export function adjustmentTotalValue(lines: readonly { delta: number; unitCost: string | null }[]): string {
  return lines
    .reduce((total, l) => (l.unitCost === null ? total : total.add(Decimal.of(l.unitCost, COST_SCALE).mul(Math.abs(l.delta), COST_SCALE))), Decimal.zero(COST_SCALE))
    .round(MONEY_SCALE)
    .toString();
}

// ── Pasted or uploaded lists ──

export interface AdjustmentPasteRow {
  /** 1-based line of the pasted text, to point at errors. */
  line: number;
  code: string;
  quantity: number;
  kind: AdjustmentKind;
}

export interface AdjustmentPasteError {
  line: number;
  reason: 'MISSING_CODE' | 'MISSING_QUANTITY' | 'INVALID_QUANTITY' | 'INVALID_KIND' | 'DUPLICATE_CODE';
  /** The offending text of the line, as pasted. */
  text: string;
}

export interface AdjustmentPasteResult {
  rows: AdjustmentPasteRow[];
  errors: AdjustmentPasteError[];
}

/** What the optional third column may say, in Spanish or English, without accents or case. */
const KIND_WORDS: Record<string, AdjustmentKind> = { entrada: 'IN', in: 'IN', salida: 'OUT', out: 'OUT', conteo: 'COUNT', count: 'COUNT' };
const normalizeWord = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/**
 * Reads a pasted list of `code, quantity[, kind]` lines. The kind is "Entrada", "Salida" or "Conteo" (or IN, OUT, COUNT) and
 * is `OUT` when left out. Blank lines and a header row are skipped. A line with no code, no quantity, an unknown kind or a
 * quantity that is not a whole number (at least 1, or 0 for a count) goes to `errors`. A code repeated with the same
 * `IN`/`OUT` kind is summed into its first line; any other repetition is an error, since a product appears once.
 */
export function parseAdjustmentPaste(text: string): AdjustmentPasteResult {
  const rows: AdjustmentPasteRow[] = [];
  const errors: AdjustmentPasteError[] = [];
  const indexByCode = new Map<string, number>();

  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    const cells = splitPasteLine(raw);
    if (isTransferHeaderRow(cells)) return;

    const [code = '', quantityText = '', kindText = ''] = cells;
    if (!code) return void errors.push({ line, reason: 'MISSING_CODE', text: raw.trim() });
    if (!quantityText) return void errors.push({ line, reason: 'MISSING_QUANTITY', text: raw.trim() });
    const kind = kindText ? KIND_WORDS[normalizeWord(kindText)] : 'OUT';
    if (!kind) return void errors.push({ line, reason: 'INVALID_KIND', text: raw.trim() });
    const quantity = Number(quantityText);
    const minimum = kind === 'COUNT' ? 0 : 1;
    if (!/^\d+$/.test(quantityText) || quantity < minimum || quantity > ADJUSTMENT_LINE_QUANTITY_MAX) {
      return void errors.push({ line, reason: 'INVALID_QUANTITY', text: raw.trim() });
    }

    const key = code.toUpperCase();
    const existing = indexByCode.get(key);
    if (existing === undefined) {
      indexByCode.set(key, rows.length);
      rows.push({ line, code, quantity, kind });
    } else if (rows[existing].kind === kind && kind !== 'COUNT') {
      rows[existing].quantity = Math.min(rows[existing].quantity + quantity, ADJUSTMENT_LINE_QUANTITY_MAX);
    } else {
      errors.push({ line, reason: 'DUPLICATE_CODE', text: raw.trim() });
    }
  });

  return { rows, errors };
}

export type AdjustmentLineGroup = 'RECOGNIZED' | 'NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'INACTIVE';

export interface AdjustmentResolvedLine {
  line: number;
  code: string;
  quantity: number;
  kind: AdjustmentKind;
  group: AdjustmentLineGroup;
  /** Present when the product exists. */
  product: { id: string; sku: string; manufacturerCode: string; name: string; brand: string } | null;
  /** Stock in the warehouse; `null` when the product was not found. */
  available: number | null;
  /** Decimal string; `null` without `inventory.costs.view` or without a cost. */
  unitCost: string | null;
}

export interface AdjustmentResolveResponse {
  lines: AdjustmentResolvedLine[];
  errors: AdjustmentPasteError[];
  counts: Record<AdjustmentLineGroup, number>;
}

export type StockAdjustmentDocumentStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
export type StockAdjustmentDocumentSource = 'MANUAL' | 'TRANSFER';

export interface AdjustmentListItem {
  id: string;
  number: string;
  status: StockAdjustmentDocumentStatus;
  source: StockAdjustmentDocumentSource;
  warehouse: { id: string; name: string; branch: { id: string; name: string } };
  /** The reason label ("Merma"), or the text of a transfer-difference adjustment. */
  reason: string;
  lines: number;
  /** Decimal string; `null` for a viewer without `inventory.costs.view`. */
  value: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface AdjustmentListResponse {
  items: AdjustmentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdjustmentLineDetail {
  productId: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  brand: string;
  kind: 'IN' | 'OUT' | 'COUNT' | 'SHORTAGE' | 'SURPLUS' | 'MANUAL';
  /** What the user typed (the counted stock for `COUNT`); `null` on a transfer difference. */
  enteredQuantity: number | null;
  /** Signed change applied to the stock. */
  delta: number;
  /** Decimal string; `null` without `inventory.costs.view` or without a cost. */
  unitCost: string | null;
  value: string | null;
}

export interface AdjustmentDetail extends AdjustmentListItem {
  note: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  items: AdjustmentLineDetail[];
}

export interface AdjustmentProductSearchItem {
  id: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  brand: string;
  /** Stock in the warehouse being adjusted. */
  available: number;
  /** Decimal string; `null` without `inventory.costs.view` or without a cost. */
  unitCost: string | null;
}

export interface AdjustmentProductSearchResponse {
  items: AdjustmentProductSearchItem[];
}

export interface CreateAdjustmentResponse {
  id: string;
  number: string;
  status: StockAdjustmentDocumentStatus;
  /** Decimal string; `null` without `inventory.costs.view`. */
  totalValue: string | null;
  /** Lines that moved stock (a count equal to the stock moves none). */
  movements: number;
}
