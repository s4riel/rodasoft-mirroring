/**
 * Integration test of the shift summary behind VP-22 (HU-VEN-22) against the real Postgres: the sales per payment method without
 * the cancelled ones, the cash the register should hold (posted movements only), the movement list, and who may read a shift.
 */
import { randomUUID } from 'node:crypto';
import type { Caller } from '../pos/pos.int-fixture';
import { codeOf, createPosFixture } from '../pos/pos.int-fixture';

jest.setTimeout(30_000);

const fx = createPosFixture('cashsum');
const { state } = fx;
const run = randomUUID().slice(0, 8);

const OPEN = 'sales.cash-register.open';
const REVIEW = 'sales.cash-register.review';

type Method = 'CASH' | 'QR' | 'CARD' | 'TRANSFER' | 'CREDIT';
interface PaymentSeed {
  method: Method;
  amount: string;
}

describe('Cash shift summary (integration, real Postgres)', () => {
  let seq = 0;

  beforeAll(() => fx.setup(), 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));
  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'sales.cashExpenseApprovalLimit' } });
  });

  async function cashier(label: string, openingFloat = '100.00') {
    const shift = await fx.newShift(label, openingFloat);
    fx.grant(shift.caller, OPEN);
    return shift;
  }

  /** A sale of the shift with its payments, like the POS writes it; cash also posts to the register. */
  async function addSale(shift: { shiftId: string; caller: Caller }, payments: PaymentSeed[], status: 'COMPLETED' | 'CANCELLED' = 'COMPLETED') {
    seq += 1;
    const total = payments.reduce((acc, p) => acc + Number(p.amount), 0).toFixed(2);
    // a POS sale comes from a completed cart (a check constraint of the schema)
    const checkout = await state.base.posCheckout.create({
      data: { companyId: state.companyId, cashierId: shift.caller.userId, shiftId: shift.shiftId, status: 'COMPLETED' },
    });
    const sale = await state.base.sale.create({
      data: {
        companyId: state.companyId,
        checkoutId: checkout.id,
        number: `V-${run}-${seq}`,
        branchId: state.branchId,
        warehouseId: state.centralId,
        shiftId: shift.shiftId,
        status,
        subtotal: total,
        total,
        createdById: shift.caller.userId,
        payments: {
          create: payments.map((p) => ({
            companyId: state.companyId,
            method: p.method,
            amount: p.amount,
            // a credit payment always carries its due date (check constraint, HU-VEN-34)
            dueDate: p.method === 'CREDIT' ? new Date('2026-12-01T00:00:00Z') : null,
          })),
        },
      },
    });
    for (const payment of payments.filter((p) => p.method === 'CASH')) {
      await movement(shift, 'SALE_PAYMENT', payment.amount, { refType: 'SALE', refId: sale.id });
    }
    return sale;
  }

  const movement = (
    shift: { shiftId: string; caller: Caller },
    type: 'INCOME' | 'EXPENSE' | 'SALE_PAYMENT' | 'REFUND',
    amount: string,
    extra: { status?: 'PENDING' | 'POSTED' | 'REJECTED' | 'WITHDRAWN'; concept?: string; refType?: string; refId?: string } = {},
  ) =>
    state.base.cashMovement.create({
      data: { companyId: state.companyId, shiftId: shift.shiftId, type, amount, userId: shift.caller.userId, status: extra.status ?? 'POSTED', concept: extra.concept ?? null, refType: extra.refType, refId: extra.refId },
    });

  it('shows the sales per payment method without the cancelled ones, and the totals of the shift', async () => {
    const shift = await cashier('methods');
    await addSale(shift, [{ method: 'CASH', amount: '100.00' }]);
    await addSale(shift, [{ method: 'QR', amount: '70.00' }]);
    await addSale(shift, [{ method: 'CARD', amount: '50.00' }]);
    await addSale(shift, [{ method: 'TRANSFER', amount: '30.00' }]);
    await addSale(shift, [
      { method: 'CASH', amount: '20.00' },
      { method: 'QR', amount: '40.00' },
    ]);
    await addSale(shift, [{ method: 'CREDIT', amount: '300.00' }]);
    await addSale(shift, [{ method: 'CASH', amount: '999.00' }], 'CANCELLED');

    const detail = await fx.as(shift.caller).cashSummary.shiftDetail(shift.shiftId);

    expect(detail.methods).toEqual([
      { method: 'CASH', amount: '120.00', count: 2 },
      { method: 'QR', amount: '110.00', count: 2 },
      { method: 'CARD', amount: '50.00', count: 1 },
      { method: 'TRANSFER', amount: '30.00', count: 1 },
      { method: 'CREDIT', amount: '300.00', count: 1 },
    ]);
    expect(detail.sales).toEqual({ total: '610.00', count: 6 });
  });

  it('lists credit only when there was a credit sale, and every other method with zero', async () => {
    const shift = await cashier('no-credit');
    const detail = await fx.as(shift.caller).cashSummary.shiftDetail(shift.shiftId);
    expect(detail.methods.map((m) => m.method)).toEqual(['CASH', 'QR', 'CARD', 'TRANSFER']);
    expect(detail.methods.every((m) => m.amount === '0.00' && m.count === 0)).toBe(true);
    expect(detail.sales).toEqual({ total: '0.00', count: 0 });
  });

  it('computes the expected cash from the posted movements only', async () => {
    const shift = await cashier('cash-calc', '100.00');
    await addSale(shift, [{ method: 'CASH', amount: '100.00' }]);
    const cancelled = await addSale(shift, [{ method: 'CASH', amount: '999.00' }], 'CANCELLED');
    await movement(shift, 'REFUND', '999.00', { refType: 'SALE', refId: cancelled.id });
    await movement(shift, 'REFUND', '10.00', { refType: 'SALE_RETURN', refId: randomUUID() });
    await movement(shift, 'INCOME', '50.00', { concept: 'BALANCE_COLLECTION' });
    await movement(shift, 'EXPENSE', '30.00', { concept: 'FREIGHT' });
    await movement(shift, 'EXPENSE', '40.00', { concept: 'SERVICES', status: 'PENDING' });
    await movement(shift, 'EXPENSE', '25.00', { concept: 'TRAVEL', status: 'REJECTED' });
    await movement(shift, 'EXPENSE', '15.00', { concept: 'SUPPLIES', status: 'WITHDRAWN' });

    const detail = await fx.as(shift.caller).cashSummary.shiftDetail(shift.shiftId);

    // 100 float + 100 + 999 cash sales + 50 income − 30 expense − 1009 refunds
    expect(detail.cash).toEqual({ openingFloat: '100.00', cashSales: '1099.00', income: '50.00', expenses: '30.00', refunds: '1009.00', expected: '210.00' });
    expect(detail.pendingExpenses).toBe(1);
  });

  it('lists the income, expenses and refunds with their state, oldest first, and not the sales', async () => {
    const shift = await cashier('list');
    await addSale(shift, [{ method: 'CASH', amount: '100.00' }]);
    await movement(shift, 'INCOME', '50.00', { concept: 'BALANCE_COLLECTION' });
    await movement(shift, 'EXPENSE', '40.00', { concept: 'SERVICES', status: 'PENDING' });
    await movement(shift, 'EXPENSE', '25.00', { concept: 'TRAVEL', status: 'REJECTED' });
    await movement(shift, 'REFUND', '10.00');

    const detail = await fx.as(shift.caller).cashSummary.shiftDetail(shift.shiftId);

    expect(detail.movements.map((m) => [m.type, m.status, m.amount])).toEqual([
      ['INCOME', 'POSTED', '50.00'],
      ['EXPENSE', 'PENDING', '40.00'],
      ['EXPENSE', 'REJECTED', '25.00'],
      ['REFUND', 'POSTED', '10.00'],
    ]);
    expect(detail.movements[0]).toMatchObject({ concept: 'BALANCE_COLLECTION', by: { id: shift.caller.userId }, hasReceipt: false });
  });

  it('describes the shift: who opened it, where, the limit of the expenses and the bills and coins to count', async () => {
    await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'sales.cashExpenseApprovalLimit', value: '250.00' } });
    const shift = await cashier('describe', '500.00');
    const detail = await fx.as(shift.caller).cashSummary.shiftDetail(shift.shiftId);

    expect(detail).toMatchObject({
      id: shift.shiftId,
      status: 'OPEN',
      openingFloat: '500.00',
      openedBy: { id: shift.caller.userId },
      closedAt: null,
      branch: { id: state.branchId, name: 'Sucursal central' },
      warehouse: { id: state.centralId },
      expenseApprovalLimit: '250.00',
    });
    expect(detail.register.id).toBe(shift.registerId);
    expect(detail.denominations).toEqual(['200.00', '100.00', '50.00', '20.00', '10.00', '5.00', '2.00', '1.00', '0.50']);
    expect(detail.cash.expected).toBe('500.00');
  });

  it('has no limit when none is configured', async () => {
    const shift = await cashier('no-limit');
    expect((await fx.as(shift.caller).cashSummary.shiftDetail(shift.shiftId)).expenseApprovalLimit).toBeNull();
  });

  describe('who may read a shift', () => {
    it('refuses another cashier’s shift, and allows it with the review permission', async () => {
      const mine = await cashier('mine');
      const theirs = await cashier('theirs');
      expect(await codeOf(fx.as(mine.caller).cashSummary.shiftDetail(theirs.shiftId))).toBe('CASH_SHIFT_NOT_OWNED');

      const reviewer = await fx.newMember('reviewer', state.companyId);
      fx.grant(reviewer, REVIEW);
      expect((await fx.as(reviewer).cashSummary.shiftDetail(theirs.shiftId)).id).toBe(theirs.shiftId);
    });

    it('answers an unknown shift and another company’s shift as not found', async () => {
      const shift = await cashier('foreign');
      expect(await codeOf(fx.as(shift.caller).cashSummary.shiftDetail(randomUUID()))).toBe('CASH_SHIFT_NOT_FOUND');
      fx.useCompany(state.otherCompanyId);
      fx.grant(state.other, OPEN, REVIEW);
      expect(await codeOf(fx.as(state.other).cashSummary.shiftDetail(shift.shiftId))).toBe('CASH_SHIFT_NOT_FOUND');
    });
  });
});
