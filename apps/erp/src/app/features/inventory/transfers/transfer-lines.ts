import {
  COST_SCALE,
  Decimal,
  MONEY_SCALE,
  TRANSFER_LINE_QUANTITY_MAX,
  type TransferDetail,
  type TransferProductSearchItem,
  type TransferResolvedLine,
  type TransferSaveInput,
} from '@rodasoft/domain';

/** Rows per page of the lines table (design notes: lists of 100+ products are paginated by 10). */
export const TRANSFER_LINES_PAGE_SIZE = 10;

/** One line of the editor: what the user sees and edits before the draft is saved. */
export interface EditorLine {
  productId: string;
  sku: string;
  manufacturerCode: string;
  name: string;
  brand: string;
  quantity: number;
  /** The quantity in the saved draft; `null` for a line not saved yet. Drives the "Sin cambios" filter. */
  savedQuantity: number | null;
  /** Stock at the origin when it was read. */
  available: number;
  /** Average cost; `null` without permission to see costs, or when the product has none. */
  unitCost: string | null;
}

export type LineError = 'INVALID_QUANTITY' | 'INSUFFICIENT_STOCK';
export type LineFilter = 'all' | 'error' | 'unchanged';

export const LINE_FILTERS: readonly { key: LineFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'error', label: 'Con error' },
  { key: 'unchanged', label: 'Sin cambios' },
];

export const LINE_ERROR_LABELS: Record<LineError, string> = {
  INVALID_QUANTITY: 'Cantidad no válida',
  INSUFFICIENT_STOCK: 'Sin stock suficiente',
};

export interface EditorSummary {
  products: number;
  pieces: number;
  /** Decimal string, scale 2; `null` when no line has a cost to value (the viewer cannot see costs). */
  value: string | null;
  errors: number;
}

export const isValidQuantity = (quantity: number) => Number.isInteger(quantity) && quantity >= 1 && quantity <= TRANSFER_LINE_QUANTITY_MAX;

/** Why a line cannot be sent, or `null` when it can. Same rules as the server's `validateTransferLines`. */
export function errorOf(line: EditorLine): LineError | null {
  if (!isValidQuantity(line.quantity)) return 'INVALID_QUANTITY';
  return line.quantity > line.available ? 'INSUFFICIENT_STOCK' : null;
}

export function fromDetail(detail: TransferDetail): EditorLine[] {
  return detail.lines.map((l) => ({
    productId: l.productId,
    sku: l.sku,
    manufacturerCode: l.manufacturerCode,
    name: l.name,
    brand: l.brand,
    quantity: l.quantity,
    savedQuantity: l.quantity,
    available: l.available,
    unitCost: l.unitCost,
  }));
}

export function toSaveLines(lines: readonly EditorLine[]): TransferSaveInput['lines'] {
  return lines.map((l) => ({ productId: l.productId, quantity: l.quantity }));
}

/** A product picked from the search or recognized in a list. */
export type AddableProduct = Pick<TransferProductSearchItem, 'id' | 'sku' | 'manufacturerCode' | 'name' | 'brand' | 'available' | 'unitCost'>;

/**
 * Adds a product, or adds the quantity to its line when it is already there, so a product never appears twice.
 * New lines go to the top, where the user is looking; an existing line keeps its place.
 */
export function addProduct(lines: readonly EditorLine[], product: AddableProduct, quantity = 1): EditorLine[] {
  const index = lines.findIndex((l) => l.productId === product.id);
  if (index >= 0) {
    return lines.map((l, i) =>
      i === index
        ? { ...l, quantity: Math.min(l.quantity + quantity, TRANSFER_LINE_QUANTITY_MAX), available: product.available, unitCost: product.unitCost }
        : l,
    );
  }
  return [
    {
      productId: product.id,
      sku: product.sku,
      manufacturerCode: product.manufacturerCode,
      name: product.name,
      brand: product.brand,
      quantity,
      savedQuantity: null,
      available: product.available,
      unitCost: product.unitCost,
    },
    ...lines,
  ];
}

/** The lines of a resolved list that were recognized with enough stock: the only ones "Agregar" adds. */
export function recognizedLines(lines: readonly TransferResolvedLine[]): { product: AddableProduct; quantity: number }[] {
  return lines
    .filter((l) => l.group === 'RECOGNIZED' && l.product)
    .map((l) => ({ product: { ...(l.product as NonNullable<TransferResolvedLine['product']>), available: l.available ?? 0, unitCost: l.unitCost }, quantity: l.quantity }));
}

export function setQuantity(lines: readonly EditorLine[], productId: string, quantity: number): EditorLine[] {
  return lines.map((l) => (l.productId === productId ? { ...l, quantity } : l));
}

export function removeLine(lines: readonly EditorLine[], productId: string): EditorLine[] {
  return lines.filter((l) => l.productId !== productId);
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** The lines the table shows: the filter chip first, then the internal search over code, name and brand. */
export function visibleLines(lines: readonly EditorLine[], filter: LineFilter, search: string): EditorLine[] {
  const needle = normalize(search.trim());
  return lines.filter((l) => {
    if (filter === 'error' && !errorOf(l)) return false;
    if (filter === 'unchanged' && l.savedQuantity !== l.quantity) return false;
    if (!needle) return true;
    return normalize(`${l.manufacturerCode} ${l.sku} ${l.name} ${l.brand}`).includes(needle);
  });
}

/** The number of lines behind each filter chip. */
export function countLines(lines: readonly EditorLine[]): Record<LineFilter, number> {
  return {
    all: lines.length,
    error: lines.filter((l) => errorOf(l) !== null).length,
    unchanged: lines.filter((l) => l.savedQuantity === l.quantity).length,
  };
}

export function pageOf<T>(items: readonly T[], page: number): T[] {
  const from = (page - 1) * TRANSFER_LINES_PAGE_SIZE;
  return items.slice(from, from + TRANSFER_LINES_PAGE_SIZE);
}

export const pageCountOf = (total: number) => Math.max(1, Math.ceil(total / TRANSFER_LINES_PAGE_SIZE));

/** Products, pieces, value at cost (money as `Decimal`, never `number`) and the lines with an error. */
export function summarize(lines: readonly EditorLine[]): EditorSummary {
  let pieces = 0;
  let errors = 0;
  let value = Decimal.zero(MONEY_SCALE);
  let costed = 0;
  for (const line of lines) {
    if (errorOf(line)) errors += 1;
    if (!isValidQuantity(line.quantity)) continue;
    pieces += line.quantity;
    if (line.unitCost !== null) {
      costed += 1;
      value = value.add(Decimal.of(line.unitCost, COST_SCALE).mul(line.quantity, MONEY_SCALE));
    }
  }
  return { products: lines.length, pieces, value: costed > 0 ? value.toString() : null, errors };
}

/** Whether the editor differs from the saved draft: header, note or any line. */
export function sameLines(a: readonly EditorLine[], b: readonly EditorLine[]): boolean {
  return a.length === b.length && a.every((l, i) => l.productId === b[i].productId && l.quantity === b[i].quantity);
}
