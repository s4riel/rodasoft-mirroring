import {
  adjustmentDelta,
  adjustmentTotalValue,
  type AdjustmentKind,
  type AdjustmentProductSearchItem,
  type AdjustmentResolvedLine,
} from '@rodasoft/domain';

/** The kinds a user can pick on a line. */
export const LINE_KINDS: readonly { value: AdjustmentKind; label: string }[] = [
  { value: 'IN', label: 'Entrada' },
  { value: 'OUT', label: 'Salida' },
  { value: 'COUNT', label: 'Conteo' },
];

/** One line of the adjustment being built: the product, what the user chose, and the stock it was read against. */
export interface AdjustmentLine {
  productId: string;
  manufacturerCode: string;
  name: string;
  brand: string;
  kind: AdjustmentKind;
  /** What the user typed; null while the box is empty. */
  quantity: number | null;
  /** Stock in the warehouse when the product was added; sent back as `expectedBalance`. */
  available: number;
  /** Decimal string; null without cost or without permission to see costs. */
  unitCost: string | null;
}

export function newLine(product: AdjustmentProductSearchItem, kind: AdjustmentKind = 'OUT', quantity: number | null = null): AdjustmentLine {
  return {
    productId: product.id,
    manufacturerCode: product.manufacturerCode,
    name: product.name,
    brand: product.brand,
    kind,
    quantity,
    available: product.available,
    unitCost: product.unitCost,
  };
}

/** A product that a pasted or uploaded list asked for, with the kind and quantity it came with. */
export interface AdjustmentAddition {
  product: AdjustmentProductSearchItem;
  kind: AdjustmentKind;
  quantity: number;
}

/** The lines of a read list that can be added: the recognized ones, with the kind and quantity of the list. */
export function recognizedAdditions(lines: readonly AdjustmentResolvedLine[]): AdjustmentAddition[] {
  return lines
    .filter((l) => l.group === 'RECOGNIZED' && l.product)
    .map((l) => ({
      product: { ...(l.product as NonNullable<AdjustmentResolvedLine['product']>), available: l.available ?? 0, unitCost: l.unitCost },
      kind: l.kind,
      quantity: l.quantity,
    }));
}

/** The change this line makes to the stock, or null while the quantity is empty. */
export function lineDelta(line: AdjustmentLine): number | null {
  return line.quantity === null ? null : adjustmentDelta({ kind: line.kind, quantity: line.quantity, balance: line.available });
}

/** The stock after the line, or null while the quantity is empty. */
export function resultingStock(line: AdjustmentLine): number | null {
  const delta = lineDelta(line);
  return delta === null ? null : line.available + delta;
}

/** Spanish reason a line cannot be confirmed, or null when it is fine. */
export function lineError(line: AdjustmentLine): string | null {
  if (line.quantity === null) return 'Ingresa la cantidad';
  if (line.kind !== 'COUNT' && line.quantity < 1) return 'La cantidad debe ser al menos 1';
  const stock = resultingStock(line);
  if (stock !== null && stock < 0) return 'Supera el stock disponible';
  return null;
}

export interface AdjustmentSummary {
  products: number;
  /** Pieces that move: the sum of the absolute deltas. */
  pieces: number;
  /** Decimal string, 2 decimals. */
  value: string;
  errors: number;
  /** Whether at least one line changes the stock; an adjustment where nothing changes is refused. */
  changesStock: boolean;
}

export function summarize(lines: readonly AdjustmentLine[]): AdjustmentSummary {
  const deltas = lines.map((l) => ({ delta: lineDelta(l) ?? 0, unitCost: l.unitCost }));
  return {
    products: lines.length,
    pieces: deltas.reduce((sum, d) => sum + Math.abs(d.delta), 0),
    value: adjustmentTotalValue(deltas),
    errors: lines.filter((l) => lineError(l) !== null).length,
    changesStock: deltas.some((d) => d.delta !== 0),
  };
}

/** The value of one line, or null while the quantity is empty or the cost is unknown. */
export function lineValue(line: AdjustmentLine): string | null {
  const delta = lineDelta(line);
  return delta === null || line.unitCost === null ? null : adjustmentTotalValue([{ delta, unitCost: line.unitCost }]);
}
