import { computeTransferDifferences, type TransferDetail, type TransferDifference, type TransferDifferenceKind } from '@rodasoft/domain';

/** Rows per page of the receipt table (Figma DocTable with a 10-row pagination). */
export const RECEIPT_PAGE_SIZE = 10;

/** A line of the receipt as the screen edits it: what is still on the way and what the user counted now. */
export interface ReceiptLineState {
  productId: string;
  code: string;
  name: string;
  brand: string;
  sent: number;
  /** Received in earlier sessions. */
  received: number;
  /** Counted in the session being filled in. */
  counted: number;
  unitCost: string | null;
}

export const pendingOf = (line: ReceiptLineState): number => line.sent - line.received;

export function fromDetail(detail: TransferDetail): ReceiptLineState[] {
  return detail.lines.map((l) => ({
    productId: l.productId,
    code: l.manufacturerCode,
    name: l.name,
    brand: l.brand,
    sent: l.quantity,
    received: l.receivedQuantity,
    counted: 0,
    unitCost: l.unitCost,
  }));
}

/** A count is a whole number of 0 or more; anything else is kept as typed so the row can flag it. */
export function setCounted(lines: readonly ReceiptLineState[], productId: string, counted: number): ReceiptLineState[] {
  return lines.map((l) => (l.productId === productId ? { ...l, counted } : l));
}

/** "Todo" on a line: the pieces still pending are the ones that arrived. */
export function receiveLine(lines: readonly ReceiptLineState[], productId: string): ReceiptLineState[] {
  return lines.map((l) => (l.productId === productId ? { ...l, counted: pendingOf(l) } : l));
}

/** "Recibir todo": every line counted in full. */
export function receiveAll(lines: readonly ReceiptLineState[]): ReceiptLineState[] {
  return lines.map((l) => ({ ...l, counted: pendingOf(l) }));
}

export type ReceiptLineError = 'INVALID' | 'EXCEEDS_PENDING';

export const RECEIPT_ERROR_LABELS: Record<ReceiptLineError, string> = {
  INVALID: 'Ingresa un número entero',
  EXCEEDS_PENDING: 'Supera lo pendiente',
};

export function errorOf(line: ReceiptLineState): ReceiptLineError | null {
  if (!Number.isInteger(line.counted) || line.counted < 0) return 'INVALID';
  return line.counted > pendingOf(line) ? 'EXCEEDS_PENDING' : null;
}

export interface ReceiptSummary {
  /** Pieces counted in this session. */
  receivingNow: number;
  /** Pieces still on the way after this session. */
  stillPending: number;
  errors: number;
}

export function summarize(lines: readonly ReceiptLineState[]): ReceiptSummary {
  let receivingNow = 0;
  let stillPending = 0;
  let errors = 0;
  for (const line of lines) {
    if (errorOf(line)) {
      errors += 1;
      stillPending += pendingOf(line);
      continue;
    }
    receivingNow += line.counted;
    stillPending += pendingOf(line) - line.counted;
  }
  return { receivingNow, stillPending, errors };
}

/** The lines of a session as the API takes them: only the products with pieces counted. */
export function toSessionLines(lines: readonly ReceiptLineState[]): { productId: string; quantity: number }[] {
  return lines.filter((l) => l.counted > 0).map((l) => ({ productId: l.productId, quantity: l.counted }));
}

/** The lines matching the text typed in the search box (code, name or brand). */
export function filterLines(lines: readonly ReceiptLineState[], text: string): ReceiptLineState[] {
  const q = text.trim().toLowerCase();
  if (!q) return [...lines];
  return lines.filter((l) => `${l.code} ${l.name} ${l.brand}`.toLowerCase().includes(q));
}

export const pageCountOf = (total: number): number => Math.max(1, Math.ceil(total / RECEIPT_PAGE_SIZE));

export function pageOf<T>(items: readonly T[], page: number): T[] {
  const start = (Math.min(Math.max(page, 1), pageCountOf(items.length)) - 1) * RECEIPT_PAGE_SIZE;
  return items.slice(start, start + RECEIPT_PAGE_SIZE);
}

/** A line of the differences dialog: shortage or surplus, with its value. */
export interface DifferenceRow {
  productId: string;
  code: string;
  name: string;
  kind: TransferDifferenceKind;
  /** Signed: negative for a shortage. */
  quantity: number;
  value: string;
}

/** Whether a line can carry a surplus: only one that ends up received in full. */
export const canHaveSurplus = (line: ReceiptLineState): boolean => line.received + line.counted === line.sent;

/**
 * What closing the receipt leaves as differences, given the final counts and the surplus the user typed: the shortage of
 * each line that ends short, and the surplus of each line received in full. Matching lines are not listed.
 */
export function differencesOf(lines: readonly ReceiptLineState[], surplus: Readonly<Record<string, number>>): DifferenceRow[] {
  const byProduct = new Map(lines.map((l) => [l.productId, l]));
  const found: TransferDifference[] = computeTransferDifferences(
    lines.map((l) => ({
      productId: l.productId,
      sent: l.sent,
      received: l.received + l.counted,
      surplus: canHaveSurplus(l) ? (surplus[l.productId] ?? 0) : 0,
      unitCost: l.unitCost,
    })),
  );
  return found.map((d) => {
    const line = byProduct.get(d.productId) as ReceiptLineState;
    return { productId: d.productId, code: line.code, name: `${line.name} · ${line.brand}`, kind: d.kind, quantity: d.quantity, value: d.value };
  });
}

/** The surplus entries to send: only lines that can carry one and a whole number above 0. */
export function toSurplusLines(lines: readonly ReceiptLineState[], surplus: Readonly<Record<string, number>>): { productId: string; quantity: number }[] {
  return lines
    .filter((l) => canHaveSurplus(l) && Number.isInteger(surplus[l.productId]) && surplus[l.productId] > 0)
    .map((l) => ({ productId: l.productId, quantity: surplus[l.productId] }));
}

/** Spanish messages of the codes receiving a transfer can get; the shared transfer map covers the rest. */
export const RECEIPT_ERROR_MESSAGES: Record<string, string> = {
  RECEIPT_EXCEEDS_SENT: 'Una línea supera lo que se envió. Revisa las cantidades; los sobrantes se registran al finalizar.',
  RECEIPT_EMPTY: 'Ingresa al menos una pieza recibida.',
  RECEIPT_LINE_INVALID: 'Alguna cantidad no es válida o el producto no está en la transferencia.',
  SURPLUS_NOT_ALLOWED: 'Solo puedes registrar sobrante en un producto recibido completo.',
};
