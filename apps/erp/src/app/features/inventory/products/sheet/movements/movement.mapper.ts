import { movementDirection, type ProductMovementItem } from '@rodasoft/domain';

/** Spanish labels of the source documents (refType from the API). */
const DOCUMENT_LABEL: Record<string, string> = {
  PURCHASE: 'Compra',
  SALE: 'Venta',
  TRANSFER: 'Transferencia',
  ADJUSTMENT: 'Ajuste',
};

/** Movements without a source document (the initial stock) are named by the type. */
const TYPE_LABEL: Record<ProductMovementItem['type'], string> = {
  INITIAL: 'Stock inicial',
  PURCHASE_RECEIPT: 'Recepción de compra',
  SALE: 'Venta',
  TRANSFER_OUT: 'Transferencia',
  TRANSFER_IN: 'Transferencia',
  ADJUSTMENT_IN: 'Ajuste',
  ADJUSTMENT_OUT: 'Ajuste',
  RETURN: 'Devolución',
};

/** "Venta V-00231", "Transferencia TR-0045", "Stock inicial". */
export function documentText(item: ProductMovementItem): string {
  const { refType, refNumber } = item.document;
  const label = (refType && DOCUMENT_LABEL[refType]) || TYPE_LABEL[item.type];
  return refNumber ? `${label} ${refNumber}` : label;
}

/** "Entrada" / "Salida" from the direction of the movement. */
export function directionLabel(item: ProductMovementItem): string {
  return movementDirection(item.quantity) === 'IN' ? 'Entrada' : 'Salida';
}

/** Signed display of a quantity: "+26", "−6" (U+2212 minus, as in the design). */
export function formatSigned(value: number): string {
  if (value === 0) return '0';
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}
