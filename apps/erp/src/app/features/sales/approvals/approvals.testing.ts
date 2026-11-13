import { APPROVAL_TYPES, type ApprovalInboxGroup, type ApprovalInboxItem, type ApprovalInboxResponse, type ApprovalType } from '@rodasoft/domain';

/** Shared data of the approvals specs (HU-VEN-29). Times are relative to the real clock so "hace N horas" is stable. */
export const HOURS_AGO = (hours: number): string => new Date(Date.now() - hours * 3_600_000).toISOString();

export function approvalItem(over: Partial<ApprovalInboxItem> = {}): ApprovalInboxItem {
  return {
    id: 'r1',
    type: 'RETURN',
    subjectId: 'ret1',
    number: 'DEV-000012',
    saleNumber: 'V-000231',
    customerName: 'Minera Demo Ltda.',
    registerName: null,
    pieces: 2,
    requestedBy: 'Ana Cajera',
    requestedAt: HOURS_AGO(3),
    reason: 'FACTORY_DEFECT',
    comment: 'El cliente trajo el rodamiento roto',
    amount: '-200.00',
    canDecide: true,
    ...over,
  };
}

/** One request of each type, the way the API would list them for Management. */
export const CANCELLATION_ITEM = approvalItem({
  id: 'r-cancel',
  type: 'CANCELLATION',
  subjectId: 'sale1',
  number: 'V-000231',
  saleNumber: null,
  customerName: null,
  registerName: 'Caja 1',
  pieces: null,
  reason: 'CUSTOMER_DATA_ERROR',
  comment: 'Factura a otra empresa',
  requestedAt: HOURS_AGO(5),
});
export const DIFFERENCE_ITEM = approvalItem({
  id: 'r-diff',
  type: 'CASH_DIFFERENCE',
  subjectId: 'shift1',
  number: 'T-0142',
  saleNumber: null,
  customerName: null,
  registerName: 'Caja 1',
  pieces: null,
  reason: 'CASH_DIFFERENCE',
  comment: 'Faltó un vuelto de Bs 20',
  amount: '-20.00',
  requestedAt: HOURS_AGO(4),
});
export const RETURN_ITEM = approvalItem({ id: 'r-return', requestedAt: HOURS_AGO(3) });
export const EXPENSE_ITEM = approvalItem({
  id: 'r-expense',
  type: 'CASH_EXPENSE',
  subjectId: 'mov1',
  number: 'T-0143',
  saleNumber: null,
  customerName: null,
  registerName: 'Caja 2',
  pieces: null,
  reason: 'FREIGHT',
  comment: 'Flete a Oruro',
  amount: '-30.00',
  requestedAt: HOURS_AGO(1),
});

export const NIT_EXCEPTION_ITEM = approvalItem({
  id: 'r-nit',
  type: 'NIT_EXCEPTION',
  subjectId: 'inv1',
  number: '000004',
  saleNumber: 'V-000124',
  customerName: 'Industrias Demo S.A.',
  reason: 'NIT_EXCEPTION',
  comment: 'El cliente no recuerda su NIT',
  amount: null,
  requestedAt: HOURS_AGO(2),
});

export const ALL_ITEMS: ApprovalInboxItem[] = [CANCELLATION_ITEM, DIFFERENCE_ITEM, RETURN_ITEM, EXPENSE_ITEM];

export function approvalInbox(over: Partial<ApprovalInboxResponse> = {}, items: ApprovalInboxItem[] = ALL_ITEMS, types: readonly ApprovalType[] = APPROVAL_TYPES): ApprovalInboxResponse {
  const groups: ApprovalInboxGroup[] = types.map((type) => {
    const own = items.filter((item) => item.type === type);
    return { type, count: own.length, items: own };
  });
  return {
    groups,
    kpis: { pending: items.length, oldestAt: items[0]?.requestedAt ?? null, approvedToday: 2, rejectedToday: 1 },
    truncated: false,
    ...over,
  };
}
