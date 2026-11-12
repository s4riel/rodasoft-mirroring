import type { CashMovementDetail, CashShiftDetail, CashShiftListResponse, CashShiftListRow, CashShiftReview, CurrentCashShift } from '@rodasoft/domain';

/** Shared data of the cash register specs (HU-VEN-22, HU-VEN-23). */
export const CURRENT_SHIFT: CurrentCashShift = {
  id: 's1',
  number: 'T-0142',
  openingFloat: '500.00',
  openedAt: '2026-11-04T12:02:00.000Z',
  openedBy: { id: 'u1', name: 'Ana Cajera' },
  register: { id: 'r1', name: 'Caja 1' },
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Principal' },
};

export function shiftDetail(over: Partial<CashShiftDetail> = {}): CashShiftDetail {
  return {
    id: 's1',
    status: 'OPEN',
    openingFloat: '500.00',
    openedAt: '2026-11-04T12:02:00.000Z',
    openedBy: { id: 'u1', name: 'Ana Cajera' },
    closedAt: null,
    register: { id: 'r1', name: 'Caja 1' },
    branch: { id: 'b1', name: 'Huayna Kapac' },
    warehouse: { id: 'w1', name: 'Principal' },
    expenseApprovalLimit: null,
    differenceTolerance: '0.00',
    denominations: ['200.00', '100.00', '50.00', '20.00', '10.00', '5.00', '2.00', '1.00', '0.50'],
    sales: { total: '700.00', count: 3 },
    methods: [
      { method: 'CASH', amount: '450.00', count: 2 },
      { method: 'QR', amount: '100.00', count: 1 },
      { method: 'CARD', amount: '150.00', count: 1 },
      { method: 'TRANSFER', amount: '0.00', count: 0 },
    ],
    cash: { openingFloat: '500.00', cashSales: '450.00', income: '50.00', expenses: '30.00', refunds: '0.00', expected: '970.00' },
    pendingExpenses: 0,
    movements: [
      {
        id: 'm1',
        type: 'INCOME',
        status: 'POSTED',
        concept: 'BALANCE_COLLECTION',
        detail: null,
        amount: '50.00',
        by: { id: 'u1', name: 'Ana Cajera' },
        createdAt: '2026-11-04T14:30:00.000Z',
        hasReceipt: false,
      },
      {
        id: 'm2',
        type: 'EXPENSE',
        status: 'POSTED',
        concept: 'FREIGHT',
        detail: 'Flete a Oruro',
        amount: '30.00',
        by: { id: 'u1', name: 'Ana Cajera' },
        createdAt: '2026-11-04T15:10:00.000Z',
        hasReceipt: true,
      },
    ],
    ...over,
  };
}

export function movementDetail(over: Partial<CashMovementDetail> = {}): CashMovementDetail {
  return {
    id: 'm3',
    type: 'EXPENSE',
    status: 'PENDING',
    concept: 'SERVICES',
    detail: 'Reparación de la puerta',
    amount: '150.00',
    by: { id: 'u1', name: 'Ana Cajera' },
    createdAt: '2026-11-04T16:00:00.000Z',
    hasReceipt: true,
    shift: { id: 's1', status: 'OPEN', register: { id: 'r1', name: 'Caja 1' } },
    approval: { requestId: 'a1', requestedBy: { id: 'u1', name: 'Ana Cajera' }, decidedBy: null, decidedAt: null, comment: null },
    canDecide: true,
    canWithdraw: false,
    ...over,
  };
}

/** A closing Bs 20 short waiting for Accounting (HU-VEN-24). */
export function shiftReview(over: Partial<CashShiftReview> = {}): CashShiftReview {
  return {
    id: 's1',
    number: 'T-0142',
    status: 'CLOSED',
    displayStatus: 'PENDING_REVIEW',
    register: { id: 'r1', name: 'Caja 1' },
    branch: { id: 'b1', name: 'Huayna Kapac' },
    cashier: { id: 'u1', name: 'Ana Cajera' },
    openedAt: '2026-10-14T12:02:00.000Z',
    closedAt: '2026-10-14T23:05:00.000Z',
    expected: '600.00',
    counted: '580.00',
    difference: '-20.00',
    sales: { total: '700.00', count: 3 },
    closingComment: 'Faltó un vuelto de Bs 20',
    closingFloat: '100.00',
    deposit: '480.00',
    methods: [
      { method: 'CASH', system: '600.00', declared: '580.00', difference: '-20.00' },
      { method: 'QR', system: '100.00', declared: '100.00', difference: '0.00' },
      { method: 'CARD', system: '0.00', declared: '0.00', difference: '0.00' },
      { method: 'TRANSFER', system: '0.00', declared: '0.00', difference: '0.00' },
    ],
    review: null,
    timeline: [
      { at: '2026-10-14T12:02:00.000Z', action: 'OPEN', by: { id: 'u1', name: 'Ana Cajera' }, automatic: false },
      { at: '2026-10-14T23:05:00.000Z', action: 'CLOSE', by: { id: 'u1', name: 'Ana Cajera' }, automatic: false },
    ],
    canDecide: true,
    ...over,
  };
}

export function shiftRow(over: Partial<CashShiftListRow> = {}): CashShiftListRow {
  return {
    id: 's1',
    number: 'T-0142',
    status: 'CLOSED',
    displayStatus: 'PENDING_REVIEW',
    cashier: { id: 'u1', name: 'Ana Cajera' },
    register: { id: 'r1', name: 'Caja 1' },
    branch: { id: 'b1', name: 'Huayna Kapac' },
    openedAt: '2026-10-14T12:02:00.000Z',
    closedAt: '2026-10-14T23:05:00.000Z',
    sales: { total: '700.00', count: 3 },
    difference: '-20.00',
    hasDifference: true,
    ...over,
  };
}

/** The history as a reviewer gets it (HU-VEN-25): one closing waiting, one clean, one still open. */
export function shiftList(over: Partial<CashShiftListResponse> = {}): CashShiftListResponse {
  const items = [
    shiftRow(),
    shiftRow({ id: 's2', number: 'T-0141', status: 'APPROVED', displayStatus: 'CLOSED_CLEAN', cashier: { id: 'u2', name: 'Beto Cajero' }, difference: '0.00', hasDifference: false }),
    shiftRow({ id: 's3', number: 'T-0143', status: 'OPEN', displayStatus: 'OPEN', closedAt: null, difference: null, hasDifference: false }),
  ];
  return {
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    totals: { shifts: 3, salesCount: 9, salesTotal: '2100.00', difference: '-20.00' },
    month: { shifts: 12, withDifference: 2, pendingReview: 1, accumulatedDifference: '-35.50' },
    canReview: true,
    cashiers: [
      { id: 'u1', name: 'Ana Cajera' },
      { id: 'u2', name: 'Beto Cajero' },
    ],
    registers: [{ id: 'r1', name: 'Caja 1' }],
    ...over,
  };
}
