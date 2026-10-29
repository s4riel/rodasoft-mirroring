import { COST_SCALE, Decimal, MONEY_SCALE } from './money';
import type { TransferStatus } from './state-machine';

/** `refType` of the movements written by a transfer, and the prefix of its document number. */
export const TRANSFER_REF_TYPE = 'TRANSFER';
export const TRANSFER_NUMBER_PREFIX = 'TR-';
/** `refType` of the `TRANSFER_IN` movements written by a receiving session; the `refId` is the receipt. */
export const TRANSFER_RECEIPT_REF_TYPE = 'TRANSFER_RECEIPT';

/** Default of the setting `transfers.maxLines`: how many distinct products a transfer may carry. */
export const TRANSFER_DEFAULT_MAX_LINES = 500;
/** Longest note a transfer carries. */
export const TRANSFER_NOTE_MAX = 500;
/** Largest quantity of one line, so a typo cannot overflow the integer column. */
export const TRANSFER_LINE_QUANTITY_MAX = 1_000_000;
/** Upload limit of the Excel/CSV list a transfer reads (code + quantity). */
export const TRANSFER_FILE_MAX_BYTES = 1024 * 1024;
export const TRANSFER_PAGE_SIZE_DEFAULT = 25;
export const TRANSFER_PAGE_SIZE_MAX = 100;

/** Formats the sequential document number of a transfer: `TR-000123`. */
export function formatTransferNumber(sequence: number): string {
  return `${TRANSFER_NUMBER_PREFIX}${String(sequence).padStart(6, '0')}`;
}

/** The sequence inside a transfer number, or null when the text is not one. */
export function parseTransferNumber(number: string): number | null {
  const match = /^TR-(\d+)$/.exec(number);
  return match ? Number(match[1]) : null;
}

export type TransferErrorCode =
  | 'SAME_WAREHOUSE'
  | 'WAREHOUSE_INACTIVE'
  | 'TOO_MANY_LINES'
  | 'RECEIPT_EMPTY'
  | 'RECEIPT_LINE_INVALID'
  | 'RECEIPT_EXCEEDS_SENT'
  | 'SURPLUS_NOT_ALLOWED';

export class TransferError extends Error {
  constructor(
    readonly code: TransferErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TransferError';
  }
}

/** A transfer moves stock between two different, active warehouses. */
export function assertTransferWarehouses(origin: { id: string; active: boolean }, destination: { id: string; active: boolean }): void {
  if (origin.id === destination.id) {
    throw new TransferError('SAME_WAREHOUSE', 'The origin and the destination must be different warehouses');
  }
  if (!origin.active || !destination.active) {
    throw new TransferError('WAREHOUSE_INACTIVE', 'The origin and the destination warehouses must be active');
  }
}

export function assertTransferLineCount(count: number, maxLines: number): void {
  if (count > maxLines) throw new TransferError('TOO_MANY_LINES', `A transfer carries at most ${maxLines} products`);
}

// ── Line validation ──

export type TransferLineStatus = 'OK' | 'INVALID_QUANTITY' | 'PRODUCT_INACTIVE' | 'INSUFFICIENT_STOCK';

export interface TransferLineToValidate {
  productId: string;
  quantity: number;
  /** Average cost of the product; `null` when it has none (the line then counts as 0 in the value). */
  unitCost: string | null;
  active: boolean;
}

export interface ValidatedTransferLine {
  productId: string;
  quantity: number;
  /** Stock at the origin when the line was checked. */
  available: number;
  status: TransferLineStatus;
}

export interface TransferSummary {
  products: number;
  pieces: number;
  /** Decimal string, scale 2, valued at average cost. */
  value: string;
  errors: number;
  /** Lines whose product has no cost, so they count as 0 in `value`. */
  withoutCost: number;
}

export interface TransferValidation {
  lines: ValidatedTransferLine[];
  summary: TransferSummary;
}

const isValidQuantity = (quantity: number) => Number.isInteger(quantity) && quantity >= 1 && quantity <= TRANSFER_LINE_QUANTITY_MAX;

/**
 * Checks every line against the stock at the origin (`availableByProduct`, on-hand quantity) and totals the transfer.
 * A line is flagged, never dropped: the user fixes it in the editor. The check order is quantity, product state, stock.
 */
export function validateTransferLines(
  lines: readonly TransferLineToValidate[],
  availableByProduct: ReadonlyMap<string, number>,
): TransferValidation {
  let pieces = 0;
  let value = Decimal.zero(MONEY_SCALE);
  let errors = 0;
  let withoutCost = 0;

  const validated = lines.map((line): ValidatedTransferLine => {
    const available = availableByProduct.get(line.productId) ?? 0;
    const status: TransferLineStatus = !isValidQuantity(line.quantity)
      ? 'INVALID_QUANTITY'
      : !line.active
        ? 'PRODUCT_INACTIVE'
        : line.quantity > available
          ? 'INSUFFICIENT_STOCK'
          : 'OK';
    if (status !== 'OK') errors += 1;
    if (isValidQuantity(line.quantity)) {
      pieces += line.quantity;
      if (line.unitCost === null) withoutCost += 1;
      else value = value.add(Decimal.of(line.unitCost, COST_SCALE).mul(line.quantity, MONEY_SCALE));
    }
    return { productId: line.productId, quantity: line.quantity, available, status };
  });

  return { lines: validated, summary: { products: lines.length, pieces, value: value.toString(), errors, withoutCost } };
}

/** Statuses in which a transfer's pieces have left the origin and not all reached the destination. */
export const TRANSFER_IN_TRANSIT_STATUSES: readonly TransferStatus[] = ['IN_TRANSIT', 'PARTIALLY_RECEIVED'];

/**
 * Statuses of a transfer that is still open: sent and not fully received. The sub-nav badge counts them. There is no
 * approval step (client feedback): a sent transfer is in transit at once, so the approval statuses are never reached.
 */
export const TRANSFER_OPEN_STATUSES: readonly TransferStatus[] = ['IN_TRANSIT', 'PARTIALLY_RECEIVED'];

export interface TransferOpenCountResponse {
  count: number;
}

/** A draft is the only status whose lines may still change. */
export function isTransferEditable(status: TransferStatus): boolean {
  return status === 'DRAFT';
}

// ── Receipt (HU-INV-21) ──

/** A line of the transfer as the receipt sees it. `unitCost` is the cost frozen when the transfer was sent. */
export interface ReceiptLine {
  productId: string;
  sent: number;
  /** Pieces already received in earlier sessions. */
  received: number;
  unitCost: string | null;
}

/** What was counted for one product: in a session, the pieces received now; at close, the surplus. */
export interface ReceiptCount {
  productId: string;
  quantity: number;
}

export interface ReceiptSessionLine {
  productId: string;
  /** Pieces received in this session (always at least 1). */
  quantity: number;
  /** Cumulative pieces received after the session. */
  received: number;
}

const isWholeCount = (quantity: number) => Number.isInteger(quantity) && quantity >= 0 && quantity <= TRANSFER_LINE_QUANTITY_MAX;

function indexCounts(lines: readonly ReceiptLine[], counts: readonly ReceiptCount[]): Map<string, ReceiptLine & { count: number }> {
  const byProduct = new Map(lines.map((l) => [l.productId, l]));
  const indexed = new Map<string, ReceiptLine & { count: number }>();
  for (const count of counts) {
    const line = byProduct.get(count.productId);
    if (!line) throw new TransferError('RECEIPT_LINE_INVALID', 'The product is not on the transfer');
    if (!isWholeCount(count.quantity)) throw new TransferError('RECEIPT_LINE_INVALID', 'A received quantity is a whole number of 0 or more');
    if (indexed.has(count.productId)) throw new TransferError('RECEIPT_LINE_INVALID', 'A product appears twice in the receipt');
    indexed.set(count.productId, { ...line, count: count.quantity });
  }
  return indexed;
}

/**
 * Applies one receiving session: the pieces counted now are added to what each line already received, and no line may
 * go above what was sent (extra pieces are a surplus, entered when the receipt is closed). Lines counted as 0 are left
 * out of the result. A session with no piece at all is refused.
 */
export function applyReceiptSession(lines: readonly ReceiptLine[], counts: readonly ReceiptCount[]): ReceiptSessionLine[] {
  const result: ReceiptSessionLine[] = [];
  for (const line of indexCounts(lines, counts).values()) {
    const received = line.received + line.count;
    if (received > line.sent) throw new TransferError('RECEIPT_EXCEEDS_SENT', 'A line cannot receive more than what was sent');
    if (line.count > 0) result.push({ productId: line.productId, quantity: line.count, received });
  }
  if (!result.length) throw new TransferError('RECEIPT_EMPTY', 'The receipt has no pieces');
  return result;
}

/** The event a session causes: everything received completes the transfer, anything pending leaves it partially received. */
export function nextReceiptEvent(lines: readonly Pick<ReceiptLine, 'sent' | 'received'>[]): 'receivePartial' | 'receiveAll' {
  return lines.every((l) => l.received >= l.sent) ? 'receiveAll' : 'receivePartial';
}

/**
 * The surplus entered at close, by product. Pieces beyond what was sent only make sense on a line that was received in
 * full; a line still short cannot also have a surplus. Zero entries are dropped.
 */
export function validateSurplus(lines: readonly ReceiptLine[], surplus: readonly ReceiptCount[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const line of indexCounts(lines, surplus).values()) {
    if (line.count > 0 && line.received < line.sent) {
      throw new TransferError('SURPLUS_NOT_ALLOWED', 'A surplus can only be entered on a line received in full');
    }
    if (line.count > 0) result.set(line.productId, line.count);
  }
  return result;
}

export type TransferDifferenceKind = 'SHORTAGE' | 'SURPLUS';

export interface TransferDifference {
  productId: string;
  kind: TransferDifferenceKind;
  /** Negative for a shortage, positive for a surplus. */
  quantity: number;
  /** Frozen unit cost; `null` when the product had none. */
  unitCost: string | null;
  /** Absolute value of the difference, decimal string, scale 2 (0 without cost). */
  value: string;
}

/** What did not match when the receipt closes: `sent − received` short, or the surplus entered. A line that matched has none. */
export function computeTransferDifferences(lines: readonly (ReceiptLine & { surplus: number })[]): TransferDifference[] {
  const differences: TransferDifference[] = [];
  for (const line of lines) {
    const shortage = line.sent - line.received;
    const quantity = shortage > 0 ? -shortage : line.surplus;
    if (quantity === 0) continue;
    const value = line.unitCost === null ? Decimal.zero(MONEY_SCALE) : Decimal.of(line.unitCost, COST_SCALE).mul(Math.abs(quantity), MONEY_SCALE);
    differences.push({ productId: line.productId, kind: quantity < 0 ? 'SHORTAGE' : 'SURPLUS', quantity, unitCost: line.unitCost, value: value.toString() });
  }
  return differences;
}

/** Sum of the values of the differences, the `total_value` of the adjustment; decimal string, scale 2. */
export function totalDifferenceValue(differences: readonly TransferDifference[]): string {
  return differences.reduce((sum, d) => sum.add(Decimal.of(d.value, MONEY_SCALE)), Decimal.zero(MONEY_SCALE)).toString();
}

// ── Paste parsing ──

export interface TransferPasteRow {
  /** 1-based line of the pasted text, to point at errors. */
  line: number;
  code: string;
  quantity: number;
}

export interface TransferPasteError {
  line: number;
  reason: 'MISSING_CODE' | 'MISSING_QUANTITY' | 'INVALID_QUANTITY';
  /** The offending text of the line, as pasted. */
  text: string;
}

export interface TransferPasteResult {
  rows: TransferPasteRow[];
  errors: TransferPasteError[];
}

const HEADER_CODES = new Set(['codigo', 'code', 'cod', 'sku']);
const HEADER_QUANTITIES = new Set(['cantidad', 'qty', 'quantity', 'cant']);
const normalizeHeader = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/** Whether a row of two cells is the column header of a list (`Código, Cantidad`). */
export function isTransferHeaderRow(cells: readonly string[]): boolean {
  return cells.length >= 2 && HEADER_CODES.has(normalizeHeader(cells[0])) && HEADER_QUANTITIES.has(normalizeHeader(cells[1]));
}

/** Splits a pasted line on tab, semicolon or comma, in that order of preference: the first one present is the separator. */
export function splitPasteLine(text: string): string[] {
  const separator = text.includes('\t') ? '\t' : text.includes(';') ? ';' : ',';
  return text.split(separator).map((cell) => unquote(cell.trim()));
}

/** Excel's "CSV UTF-8" wraps text cells in double quotes (`"6204-2RS","5"`); the quotes are not part of the code. */
function unquote(cell: string): string {
  return cell.length >= 2 && cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).trim() : cell;
}

/**
 * Reads a pasted list of `code, quantity` lines. Blank lines and a header row are skipped; a line with no code, no
 * quantity or a quantity that is not a whole number of at least 1 is reported in `errors` and left out of `rows`.
 * The same code on several lines is summed into the first line it appeared on.
 */
export function parseTransferPaste(text: string): TransferPasteResult {
  const rows: TransferPasteRow[] = [];
  const errors: TransferPasteError[] = [];
  const indexByCode = new Map<string, number>();

  text.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    const cells = splitPasteLine(raw);
    if (isTransferHeaderRow(cells)) return;

    const code = cells[0] ?? '';
    const quantityText = cells[1] ?? '';
    if (!code) return void errors.push({ line, reason: 'MISSING_CODE', text: raw.trim() });
    if (!quantityText) return void errors.push({ line, reason: 'MISSING_QUANTITY', text: raw.trim() });
    if (!/^\d+$/.test(quantityText) || !isValidQuantity(Number(quantityText))) {
      return void errors.push({ line, reason: 'INVALID_QUANTITY', text: raw.trim() });
    }

    const quantity = Number(quantityText);
    const key = code.toUpperCase();
    const existing = indexByCode.get(key);
    if (existing === undefined) {
      indexByCode.set(key, rows.length);
      rows.push({ line, code, quantity });
    } else {
      rows[existing].quantity = Math.min(rows[existing].quantity + quantity, TRANSFER_LINE_QUANTITY_MAX);
    }
  });

  return { rows, errors };
}

// ── API contracts ──

export type TransferLineGroup = 'RECOGNIZED' | 'NOT_FOUND' | 'INSUFFICIENT_STOCK' | 'INACTIVE';

export interface TransferResolvedLine {
  line: number;
  code: string;
  quantity: number;
  group: TransferLineGroup;
  /** Present when the product exists. */
  product: { id: string; sku: string; manufacturerCode: string; name: string; brand: string } | null;
  available: number | null;
  /** Average cost; `null` without `inventory.costs.view` or when the product has none. */
  unitCost: string | null;
}

export interface TransferResolveResponse {
  lines: TransferResolvedLine[];
  errors: TransferPasteError[];
  counts: Record<TransferLineGroup, number>;
}

/** An active warehouse the editor can pick; the destination may be in a branch the member does not operate. */
export interface TransferWarehouseOption {
  id: string;
  code: string;
  name: string;
  branch: { id: string; name: string };
  /** Whether the member may send from it (origin); every warehouse can be a destination. */
  canSendFrom: boolean;
}

export interface TransferWarehousesResponse {
  items: TransferWarehouseOption[];
}

export interface TransferProductSearchItem {
  id: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  brand: string;
  /** Stock at the origin warehouse. */
  available: number;
  /** Average cost; `null` without `inventory.costs.view` or when the product has none. */
  unitCost: string | null;
}

export interface TransferProductSearchResponse {
  items: TransferProductSearchItem[];
}

export interface TransferListItem {
  id: string;
  number: string;
  status: TransferStatus;
  origin: { id: string; name: string; branch: { id: string; name: string } };
  destination: { id: string; name: string; branch: { id: string; name: string } };
  products: number;
  pieces: number;
  /** Decimal string; `null` for a viewer without `inventory.costs.view`. */
  value: string | null;
  createdBy: string | null;
  /** Who sent it; `null` until it is sent. */
  sentBy: string | null;
  createdAt: string;
  sentAt: string | null;
  /** The adjustment its receipt differences left, while it waits for approval; `null` when there is none or it was decided. */
  pendingAdjustment: { number: string } | null;
}

export interface TransferListResponse {
  items: TransferListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface TransferLineDetail {
  productId: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  brand: string;
  quantity: number;
  receivedQuantity: number;
  /** Pieces that arrived beyond `quantity`; entered when the receipt was closed. */
  surplusQuantity: number;
  /** Pieces still on the way: `quantity − receivedQuantity` while the transfer is open, 0 otherwise. */
  pendingQuantity: number;
  /** Stock at the origin now (in a draft) so the editor can flag the line. */
  available: number;
  /** Average cost; `null` without `inventory.costs.view` or when the product has none. */
  unitCost: string | null;
  status: TransferLineStatus;
}

/** One receiving session, as the detail lists it. */
export interface TransferReceiptSummary {
  id: string;
  receivedBy: string | null;
  note: string | null;
  pieces: number;
  createdAt: string;
}

/** The adjustment a closed receipt left pending (differences only). */
export interface TransferAdjustmentSummary {
  id: string;
  number: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  /** `null` without `inventory.costs.view`. */
  totalValue: string | null;
}

export interface TransferDetail {
  id: string;
  number: string;
  status: TransferStatus;
  origin: { id: string; name: string; branch: { id: string; name: string } };
  destination: { id: string; name: string; branch: { id: string; name: string } };
  note: string | null;
  lines: TransferLineDetail[];
  /** `value` is `null` for a viewer without `inventory.costs.view`. */
  summary: Omit<TransferSummary, 'value' | 'withoutCost'> & { value: string | null; withoutCost: number | null };
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  sentBy: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  receipts: TransferReceiptSummary[];
  adjustment: TransferAdjustmentSummary | null;
}

export interface TransferReceiptInput {
  lines: { productId: string; quantity: number }[];
  note?: string | null;
  expectedUpdatedAt: string;
}

export interface TransferCloseInput {
  /** Last count, applied as one more session before closing; optional. */
  lines?: { productId: string; quantity: number }[];
  /** Pieces beyond what was sent, by product. */
  surplus: { productId: string; quantity: number }[];
  note?: string | null;
  expectedUpdatedAt: string;
}

export interface TransferSaveInput {
  originWarehouseId: string;
  destinationWarehouseId: string;
  note?: string | null;
  lines: { productId: string; quantity: number }[];
  /** `updatedAt` the client read; the save is refused if the transfer changed since (update only). */
  expectedUpdatedAt?: string;
}
