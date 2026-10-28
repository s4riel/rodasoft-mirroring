import { COST_SCALE, Decimal, MONEY_SCALE } from './money';
import type { TransferStatus } from './state-machine';

/** `refType` of the movements written by a transfer, and the prefix of its document number. */
export const TRANSFER_REF_TYPE = 'TRANSFER';
export const TRANSFER_NUMBER_PREFIX = 'TR-';

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

export type TransferErrorCode = 'SAME_WAREHOUSE' | 'WAREHOUSE_INACTIVE' | 'TOO_MANY_LINES';

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

/**
 * Whether the transfer must be approved before it leaves (decision #36): more pieces or more value than the company's
 * limit. A limit that is `null` is not applied, so with both `null` nothing needs approval.
 */
export function requiresTransferApproval(
  summary: Pick<TransferSummary, 'pieces' | 'value'>,
  limits: { pieces: number | null; value: string | null },
): boolean {
  if (limits.pieces !== null && summary.pieces > limits.pieces) return true;
  if (limits.value !== null && Decimal.of(summary.value).units > Decimal.of(limits.value).units) return true;
  return false;
}

/** Statuses in which a transfer's pieces have left the origin and not all reached the destination. */
export const TRANSFER_IN_TRANSIT_STATUSES: readonly TransferStatus[] = ['IN_TRANSIT', 'PARTIALLY_RECEIVED'];

/** A draft is the only status whose lines may still change. */
export function isTransferEditable(status: TransferStatus): boolean {
  return status === 'DRAFT';
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
function splitPasteLine(text: string): string[] {
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
  createdAt: string;
  sentAt: string | null;
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
  /** Stock at the origin now (in a draft) so the editor can flag the line. */
  available: number;
  /** Average cost; `null` without `inventory.costs.view` or when the product has none. */
  unitCost: string | null;
  status: TransferLineStatus;
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
  /** True when sending would ask for approval instead of moving the stock. */
  needsApproval: boolean;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

export interface TransferSaveInput {
  originWarehouseId: string;
  destinationWarehouseId: string;
  note?: string | null;
  lines: { productId: string; quantity: number }[];
  /** `updatedAt` the client read; the save is refused if the transfer changed since (update only). */
  expectedUpdatedAt?: string;
}
