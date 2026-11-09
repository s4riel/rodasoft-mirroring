import {
  RETURN_REASONS,
  type RefundMethod,
  type ReturnCondition,
  type ReturnReason,
  type ReturnTimelineKey,
  type SaleReturnDetail,
  type SaleReturnStatus,
  type SaleReturnSummary,
} from '@rodasoft/domain';
import type { DocTableRow, DocTableStatus, StatusTimelineStep } from '@rodasoft/ui';
import { formatBs, formatDateTime } from '../cash/cash-format';

/** The reasons of the Figma dropdown (VP-10), in its order. */
const REASON_LABELS: Record<ReturnReason, string> = {
  FACTORY_DEFECT: 'Producto con falla de fábrica',
  WRONG_PRODUCT: 'Producto equivocado',
  CUSTOMER_CHANGED_MIND: 'El cliente cambió de opinión',
  OTHER: 'Otro',
};
export const RETURN_REASON_OPTIONS = RETURN_REASONS.map((value) => ({ value, label: REASON_LABELS[value] }));
export const returnReasonLabel = (code: string): string => REASON_LABELS[code as ReturnReason] ?? code;

export const REFUND_LABELS: Record<RefundMethod, string> = {
  CASH: 'Efectivo de caja',
  STORE_CREDIT: 'Saldo a favor',
  TRANSFER: 'Transferencia',
};
export const REFUND_METHODS_ORDER: readonly RefundMethod[] = ['CASH', 'STORE_CREDIT', 'TRANSFER'];
export const refundLabel = (method: string): string => REFUND_LABELS[method as RefundMethod] ?? method;

export const CONDITION_LABELS: Record<ReturnCondition, string> = { RESTOCK: 'A stock', SCRAP: 'A merma' };

/** The status filter of the list (VP-20), with the Spanish labels of the pills. */
export const RETURN_STATUS_OPTIONS = [
  { value: 'APPROVED', label: 'Aprobada' },
  { value: 'PENDING_APPROVAL', label: 'Por aprobar' },
  { value: 'REJECTED', label: 'Rechazada' },
];
export const parseReturnStatus = (raw: string | null): SaleReturnStatus | null =>
  RETURN_STATUS_OPTIONS.some((option) => option.value === raw) ? (raw as SaleReturnStatus) : null;

const isCreditNoteIssued = (creditNoteStatus: SaleReturnSummary['creditNoteStatus']): boolean =>
  creditNoteStatus === 'VALID' || creditNoteStatus === 'OBSERVED';

/** "Nota emitida" once the SIAT epic issued the credit note, "Aprobada" until then. */
export function returnStatusPill(item: Pick<SaleReturnSummary, 'status' | 'creditNoteStatus'>): DocTableStatus {
  if (item.status === 'PENDING_APPROVAL') return { label: 'Por aprobar', status: 'warning', icon: 'alert' };
  if (item.status === 'REJECTED') return { label: 'Rechazada', status: 'danger' };
  return isCreditNoteIssued(item.creditNoteStatus) ? { label: 'Nota emitida', status: 'success' } : { label: 'Aprobada', status: 'info' };
}

export function toReturnRow(item: SaleReturnSummary): DocTableRow {
  return {
    id: item.id,
    label: item.number,
    cells: {
      number: item.number,
      customer: item.customerName ?? 'Consumidor final',
      sale: item.saleNumber,
      items: `${item.pieces} ${item.pieces === 1 ? 'pieza' : 'piezas'}`,
      total: formatBs(item.total),
      status: returnStatusPill(item),
    },
  };
}

const TIMELINE_LABELS: Record<ReturnTimelineKey, string> = {
  requested: 'Solicitada',
  approved: 'Aprobada',
  creditNote: 'Nota emitida',
  refunded: 'Reembolsada',
};

/** The steps of VP-21 for `rs-status-timeline`; a rejected return shows its stop as a warning. */
export function timelineSteps(detail: Pick<SaleReturnDetail, 'timeline' | 'status'>): StatusTimelineStep[] {
  return detail.timeline.map((step) => {
    const rejected = step.key === 'approved' && detail.status === 'REJECTED';
    return {
      label: rejected ? 'Rechazada' : TIMELINE_LABELS[step.key],
      caption: step.at ? formatDateTime(step.at) : '—',
      state: rejected ? 'warning' : step.state,
      stateLabel: rejected ? 'Rechazada' : step.state === 'done' ? 'Completado' : step.state === 'current' ? 'En curso' : 'Pendiente',
    };
  });
}

const AUDIT_LABELS: Record<string, string> = {
  'sales.return.create': 'Devolución registrada y aprobada',
  'sales.return.request': 'Devolución enviada a aprobación',
  'sales.return.approve': 'Devolución aprobada por Gerencia',
  'sales.return.reject': 'Devolución rechazada por Gerencia',
};
export const returnAuditLabel = (action: string): string => AUDIT_LABELS[action] ?? action;

/** The credit note KPI of VP-21. */
export function creditNoteText(detail: Pick<SaleReturnDetail, 'status' | 'creditNoteStatus'>): string {
  if (detail.status === 'REJECTED') return 'Sin nota';
  if (detail.status === 'PENDING_APPROVAL') return 'Se emite al aprobar';
  return isCreditNoteIssued(detail.creditNoteStatus) ? 'Emitida' : 'Pendiente';
}

/** The refund KPI of VP-21: the method, or what is pending. */
export function refundText(detail: Pick<SaleReturnDetail, 'status' | 'refundMethod'>): string {
  if (detail.status === 'REJECTED') return 'Sin reembolso';
  if (detail.status === 'PENDING_APPROVAL') return 'Por aprobar';
  return refundLabel(detail.refundMethod);
}
