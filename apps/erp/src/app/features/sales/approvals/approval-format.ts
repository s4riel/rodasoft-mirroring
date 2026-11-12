import { isInlineApprovalType, type ApprovalInboxItem, type ApprovalType } from '@rodasoft/domain';
import { CONCEPT_LABELS, formatBs } from '../cash/cash-format';
import { cancellationReasonLabel, elapsedText } from '../history/sale-format';
import { returnReasonLabel } from '../returns/returns-format';

/** The small line above a card: the kind of request. */
export const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  CANCELLATION: 'Anulación',
  CASH_DIFFERENCE: 'Diferencia de caja',
  RETURN: 'Devolución',
  CASH_EXPENSE: 'Gasto de caja',
};

/** The heading of each section and the label of each chip. */
export const APPROVAL_GROUP_LABELS: Record<ApprovalType, string> = {
  CANCELLATION: 'Anulaciones',
  CASH_DIFFERENCE: 'Diferencias de caja',
  RETURN: 'Devoluciones',
  CASH_EXPENSE: 'Gastos de caja',
};

/** Who decides each type, for the note at the end of the screen (decisions #11, #15, #16, #17). */
export const APPROVAL_WHO_TEXT =
  'Hoy: anulaciones → Gerencia; diferencias de caja → Contabilidad; devoluciones sobre el límite → Gerencia; gastos de caja sobre el límite → quien tenga el permiso. Solo ves las que puedes decidir.';

/** The reason the requester gave, in Spanish. */
export function approvalReasonLabel(item: Pick<ApprovalInboxItem, 'type' | 'reason'>): string {
  if (item.type === 'CASH_DIFFERENCE') return 'Diferencia al cerrar la caja';
  if (!item.reason) return '';
  switch (item.type) {
    case 'CANCELLATION':
      return cancellationReasonLabel(item.reason);
    case 'RETURN':
      return returnReasonLabel(item.reason);
    default:
      return CONCEPT_LABELS.EXPENSE[item.reason] ?? item.reason;
  }
}

/** The title of a card: the document the request is about. */
export function approvalTitle(item: ApprovalInboxItem): string {
  switch (item.type) {
    case 'CANCELLATION':
      return item.customerName ? `${item.number} · ${item.customerName}` : item.number;
    case 'CASH_DIFFERENCE':
      return item.registerName ? `Turno ${item.number} · ${item.registerName}` : `Turno ${item.number}`;
    case 'RETURN': {
      const sale = item.saleNumber ? `${item.number} · venta ${item.saleNumber}` : item.number;
      return item.customerName ? `${sale} · ${item.customerName}` : sale;
    }
    default:
      return item.registerName ? `Egreso de ${item.registerName} · turno ${item.number}` : `Egreso del turno ${item.number}`;
  }
}

/** Who asked, why and how long ago: `Ana Cajera · Falla de fábrica · hace 3 horas`. */
export function approvalDescription(item: ApprovalInboxItem, now: Date = new Date()): string {
  const parts = [item.requestedBy, approvalReasonLabel(item)];
  if (item.type === 'RETURN' && item.pieces !== null) parts.push(`${item.pieces} ${item.pieces === 1 ? 'pieza' : 'piezas'}`);
  parts.push(`hace ${elapsedText(item.requestedAt, now)}`);
  return parts.filter(Boolean).join(' · ');
}

/** What the requester wrote, in quotes; empty when they wrote nothing. */
export function approvalDetail(item: Pick<ApprovalInboxItem, 'comment'>): string {
  const text = item.comment?.trim();
  return text ? `“${text}”` : '';
}

/** The amount as the card shows it (`−Bs 200,00`); empty when the request has none. */
export function approvalAmount(item: Pick<ApprovalInboxItem, 'amount'>): string {
  return item.amount === null ? '' : formatBs(item.amount);
}

/** Money that leaves the company (or a shortage) is drawn in the danger tone. */
export function approvalTone(item: Pick<ApprovalInboxItem, 'amount'>): 'neutral' | 'negative' {
  return item.amount !== null && item.amount.startsWith('-') ? 'negative' : 'neutral';
}

/** The review page of each type, where "Ver detalle" goes. */
export function approvalDetailLink(item: Pick<ApprovalInboxItem, 'type' | 'subjectId'>): string {
  switch (item.type) {
    case 'CANCELLATION':
      return `/sales/history/${item.subjectId}/cancellation`;
    case 'CASH_DIFFERENCE':
      return `/sales/cash-register/shifts/${item.subjectId}/review`;
    case 'RETURN':
      return `/sales/returns/${item.subjectId}`;
    default:
      return `/sales/cash-register/movements/${item.subjectId}`;
  }
}

/** Returns and cash expenses are decided in the inbox itself, unless it is the caller's own request to decide. */
export function canDecideInline(item: Pick<ApprovalInboxItem, 'type' | 'canDecide'>): boolean {
  return isInlineApprovalType(item.type) && item.canDecide;
}

/** The KPI "Más antigua": how long the oldest request has waited, or a dash when none is pending. */
export function oldestText(oldestAt: string | null, now: Date = new Date()): string {
  if (oldestAt === null) return '—';
  // the short form of the Figma KPI: `hace 2 h`
  const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(oldestAt)) / 60_000));
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `hace ${hours} h` : `hace ${Math.floor(hours / 24)} d`;
}

/** The heading of the decision dialog. */
export function decisionHeading(type: ApprovalType, decision: 'approve' | 'reject'): string {
  const noun = type === 'RETURN' ? 'devolución' : 'gasto de caja';
  return decision === 'approve' ? `Aprobar ${noun}` : `Rechazar ${noun}`;
}
