import type { CashMovementDetail, CashShiftDetail, CurrentCashShift } from '@rodasoft/domain';

/** Shared data of the cash register specs (HU-VEN-22, HU-VEN-23). */
export const CURRENT_SHIFT: CurrentCashShift = {
  id: 's1',
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
