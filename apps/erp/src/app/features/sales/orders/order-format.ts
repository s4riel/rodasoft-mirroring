import type { OrderTimelineKey, OrderTimelineStep, SalesOrderDetail, SalesOrderLineDetail } from '@rodasoft/domain';
import type { DocTableStatus, ReceiptItem, ReceiptRow, StatusTimelineStep } from '@rodasoft/ui';
import { formatDateTime } from '../cash/cash-format';
import { formatDay } from '../quotes/quote-format';

/** Spanish label of each step of the order timeline (VP-19). */
export const ORDER_TIMELINE_LABELS: Record<OrderTimelineKey, string> = {
  created: 'Creado',
  reserved: 'Reservado',
  dispatch: 'Despacho parcial',
  invoiced: 'Facturado',
  completed: 'Completado',
};

const TIMELINE_STATE_LABELS: Record<OrderTimelineStep['state'], string> = {
  done: 'Completado',
  current: 'Paso actual',
  pending: 'Pendiente',
};

const shortDay = (iso: string): string => formatDay(iso.slice(0, 10)).slice(0, 5);

/** The timeline as `rs-status-timeline` draws it: a short date under each step, "Pendiente" under the current one. */
export function toOrderTimelineSteps(steps: readonly OrderTimelineStep[]): StatusTimelineStep[] {
  return steps.map((step) => ({
    label: ORDER_TIMELINE_LABELS[step.key],
    caption: step.at ? shortDay(step.at) : step.state === 'current' ? 'Pendiente' : '—',
    state: step.state,
    stateLabel: TIMELINE_STATE_LABELS[step.state],
  }));
}

/** "Listo" when the line has nothing left to dispatch, "Pendiente 3" otherwise. */
export function lineStatus(line: Pick<SalesOrderLineDetail, 'pendingQuantity'>): DocTableStatus {
  return line.pendingQuantity === 0
    ? { label: 'Listo', status: 'success' }
    : { label: `Pendiente ${line.pendingQuantity}`, status: 'warning' };
}

/** Pieces: "19 piezas", "1 pieza". */
export const piecesLabel = (count: number): string => `${count} ${count === 1 ? 'pieza' : 'piezas'}`;

/** The dispatch order drawn for `rs-receipt` on letter paper: what is still pending, to pick it in the warehouse. */
export function dispatchOrderDocument(order: SalesOrderDetail): {
  headerLines: string[];
  metaRows: ReceiptRow[];
  items: ReceiptItem[];
  totalRows: ReceiptRow[];
  footerLines: string[];
} {
  const pending = order.lines.filter((line) => line.pendingQuantity > 0);
  const pieces = pending.reduce((sum, line) => sum + line.pendingQuantity, 0);
  return {
    headerLines: ['Orden de despacho'],
    metaRows: [
      { label: 'Pedido', value: order.number },
      { label: 'Fecha', value: formatDateTime(order.createdAt) },
      { label: 'Cliente', value: order.customer.name },
      { label: 'Almacén', value: `${order.branchName} · ${order.warehouseName}` },
    ],
    items: pending.map((line) => ({
      description: `${line.code} · ${line.name}`,
      detail: `Pedido ${line.quantity} · ya despachado ${line.dispatchedQuantity}`,
      total: piecesLabel(line.pendingQuantity),
    })),
    totalRows: [{ label: 'Por despachar', value: piecesLabel(pieces), strong: true }],
    footerLines: ['Cada despacho genera su factura por lo entregado.'],
  };
}
