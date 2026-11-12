/**
 * Integration test of the approvals inbox (HU-VEN-29, VP-25) against the real Postgres: one pending request of each type made
 * through the real services, what each card carries, the permission subsets, the branch scope, the visibility of cancellations,
 * tenant isolation, the KPIs of the La Paz day, the own-shift rule, and that a decision (made through the existing endpoint of
 * its type) takes the request out of the inbox and into "today".
 */
import { randomUUID } from 'node:crypto';
import type { ApprovalInboxItem, ApprovalInboxResponse, ApprovalType } from '@rodasoft/domain';
import { codeOf, createPosFixture, type Caller } from '../pos/pos.int-fixture';

jest.setTimeout(60_000);

const fx = createPosFixture('inbox');
const { state } = fx;
const run = randomUUID().slice(0, 8);

const OPEN = 'sales.cash-register.open';
const REVIEW = 'sales.cash-register.review';
const CANCELLATIONS = 'sales.cancellations.approve';
const RETURNS = 'sales.returns.approve';
const EXPENSES = 'sales.cash-expenses.approve';
const VIEW_ALL = 'sales.history.view-all';

const count = (denomination: string, quantity: number) => ({ denomination, quantity });
/** Bs 580 counted against Bs 600 expected: Bs 20 short. */
const SHORT = { counts: [count('100', 5), count('20', 4)], declared: { QR: '100.00', CARD: '0', TRANSFER: '0' }, closingFloat: '100.00', comment: 'Faltó un vuelto de Bs 20' };

const setSetting = (key: string, value: unknown) =>
  state.base.companySetting.upsert({
    where: { companyId_key: { companyId: state.companyId, key } },
    create: { companyId: state.companyId, key, value: value as never },
    update: { value: value as never },
  });

const group = (response: ApprovalInboxResponse, type: ApprovalType) => response.groups.find((g) => g.type === type);
const only = (response: ApprovalInboxResponse, type: ApprovalType): ApprovalInboxItem => {
  const items = group(response, type)?.items ?? [];
  expect(items).toHaveLength(1);
  return items[0];
};

describe('Approvals inbox (integration, real Postgres)', () => {
  let manager: Caller;
  let accountant: Caller;
  let nobody: Caller;
  let seq = 0;
  /** The things the requests are about, to compare with what the inbox says. */
  const made = {
    cancellation: { saleId: '', number: '' },
    returned: { returnId: '', number: '', saleNumber: '' },
    expense: { movementId: '', shiftNumber: '', registerName: '', cashier: {} as Caller },
    difference: { shiftId: '', shiftNumber: '', registerName: '', cashier: {} as Caller },
  };

  const svc = (caller: Caller, opts: { operableBranchIds?: string[] } = {}) => fx.as(caller, opts);
  const inbox = (caller: Caller = manager, opts: { operableBranchIds?: string[] } = {}) => svc(caller, opts).approvals;

  async function sell(): Promise<{ saleId: string; number: string; itemId: string }> {
    const product = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 50 } });
    await svc(state.cashier).checkout.addItem({ productId: product.id, quantity: 2 });
    const { total } = await svc(state.cashier).payment.pay();
    const done = await svc(state.cashier).payment.complete({ payments: [{ method: 'CASH', received: total }], expectedTotal: total, idempotencyKey: randomUUID() });
    const sale = await state.base.sale.findUniqueOrThrow({ where: { id: done.sale.saleId }, include: { items: true } });
    return { saleId: sale.id, number: sale.number, itemId: sale.items[0].id };
  }

  /** A cash sale directly in the database, so a shift has something to count. */
  async function addCashSale(shift: { shiftId: string; caller: Caller }, amount: string) {
    seq += 1;
    const checkout = await state.base.posCheckout.create({ data: { companyId: state.companyId, cashierId: shift.caller.userId, shiftId: shift.shiftId, status: 'COMPLETED' } });
    const sale = await state.base.sale.create({
      data: {
        companyId: state.companyId,
        checkoutId: checkout.id,
        number: `V-${run}-${seq}`,
        branchId: state.branchId,
        warehouseId: state.centralId,
        shiftId: shift.shiftId,
        status: 'COMPLETED',
        subtotal: amount,
        total: amount,
        createdById: shift.caller.userId,
        payments: { create: [{ companyId: state.companyId, method: 'CASH', amount }] },
      },
    });
    await state.base.cashMovement.create({
      data: { companyId: state.companyId, shiftId: shift.shiftId, type: 'SALE_PAYMENT', amount, userId: shift.caller.userId, refType: 'SALE', refId: sale.id },
    });
  }

  async function registerOf(shiftId: string) {
    const shift = await state.base.cashShift.findUniqueOrThrow({ where: { id: shiftId }, include: { register: true } });
    return { shiftNumber: shift.number, registerName: shift.register.name };
  }

  /** A pending return of a cash sale over the approval limit. */
  async function pendingReturn() {
    const sold = await sell();
    const detail = await svc(state.cashier).returns.create(
      { saleId: sold.saleId, reason: 'FACTORY_DEFECT', refundMethod: 'CASH', items: [{ saleItemId: sold.itemId, quantity: 2, condition: 'RESTOCK' }] } as never,
      randomUUID(),
    );
    return { returnId: detail.id, number: detail.number, saleNumber: sold.number };
  }

  async function pendingExpense(amount = '30.00') {
    const shift = await fx.newShift(`exp${(seq += 1)}`);
    fx.grant(shift.caller, OPEN);
    const detail = await svc(shift.caller).cashMovements.create(
      shift.shiftId,
      { type: 'EXPENSE', amount, concept: 'FREIGHT', detail: 'Flete a Oruro' } as never,
      undefined,
      randomUUID(),
    );
    return { movementId: detail.id, cashier: shift.caller, ...(await registerOf(shift.shiftId)) };
  }

  async function pendingDifference() {
    const shift = await fx.newShift(`diff${(seq += 1)}`, '100.00');
    fx.grant(shift.caller, OPEN, REVIEW);
    await addCashSale(shift, '500.00');
    await svc(shift.caller).cashClosing.close(shift.shiftId, SHORT as never);
    return { shiftId: shift.shiftId, cashier: shift.caller, ...(await registerOf(shift.shiftId)) };
  }

  beforeAll(async () => {
    await fx.setup();
    manager = await fx.newMember('manager', state.companyId);
    accountant = await fx.newMember('accountant', state.companyId);
    nobody = await fx.newMember('nobody', state.companyId);
    fx.grant(manager, VIEW_ALL, CANCELLATIONS, REVIEW, RETURNS, EXPENSES);
    fx.grant(accountant, REVIEW);
    fx.grant(nobody, 'sales.prices.edit');
    await setSetting('sales.returnApprovalLimit', '50.00');
    await setSetting('sales.cashExpenseApprovalLimit', '10.00');

    const sale = await sell();
    await svc(state.cashier).cancellations.request(sale.saleId, { reason: 'CUSTOMER_DATA_ERROR', comment: 'Factura a otra empresa' } as never);
    made.cancellation = { saleId: sale.saleId, number: sale.number };
    made.returned = await pendingReturn();
    made.expense = await pendingExpense();
    made.difference = await pendingDifference();
  }, 120_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  describe('what the inbox lists', () => {
    it('groups the pending requests by type, in the order of the screen, each with its count', async () => {
      const response = await inbox().list();
      expect(response.groups.map((g) => g.type)).toEqual(['CANCELLATION', 'CASH_DIFFERENCE', 'RETURN', 'CASH_EXPENSE']);
      expect(Object.fromEntries(response.groups.map((g) => [g.type, g.count]))).toEqual({ CANCELLATION: 1, CASH_DIFFERENCE: 1, RETURN: 1, CASH_EXPENSE: 1 });
      expect(response.truncated).toBe(false);
    });

    it('carries what each card shows', async () => {
      const response = await inbox().list();

      expect(only(response, 'CANCELLATION')).toMatchObject({
        subjectId: made.cancellation.saleId,
        number: made.cancellation.number,
        saleNumber: null,
        customerName: null,
        requestedBy: 'User cashier',
        reason: 'CUSTOMER_DATA_ERROR',
        comment: 'Factura a otra empresa',
        amount: '-200.00',
        canDecide: true,
        pieces: null,
      });
      expect(only(response, 'RETURN')).toMatchObject({
        subjectId: made.returned.returnId,
        number: made.returned.number,
        saleNumber: made.returned.saleNumber,
        pieces: 2,
        amount: '-200.00',
        reason: 'FACTORY_DEFECT',
        requestedBy: 'User cashier',
        canDecide: true,
      });
      expect(only(response, 'CASH_DIFFERENCE')).toMatchObject({
        subjectId: made.difference.shiftId,
        number: made.difference.shiftNumber,
        registerName: made.difference.registerName,
        amount: '-20.00',
        comment: 'Faltó un vuelto de Bs 20',
        canDecide: true,
      });
      expect(only(response, 'CASH_EXPENSE')).toMatchObject({
        subjectId: made.expense.movementId,
        number: made.expense.shiftNumber,
        registerName: made.expense.registerName,
        amount: '-30.00',
        reason: 'FREIGHT',
        comment: 'Flete a Oruro',
        canDecide: true,
      });
    });

    it('lists each group oldest first and reports the KPIs', async () => {
      const response = await inbox().list();
      for (const g of response.groups) {
        const times = g.items.map((item) => item.requestedAt);
        expect([...times].sort()).toEqual(times);
      }
      const oldest = await state.base.approvalRequest.findFirstOrThrow({ where: { companyId: state.companyId, status: 'PENDING' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      expect(response.kpis).toEqual({ pending: 4, oldestAt: oldest.createdAt.toISOString(), approvedToday: 0, rejectedToday: 0 });
    });

    it('counts the same in the summary of the badge', async () => {
      expect(await inbox().summary()).toEqual({ pending: 4 });
      expect(await inbox(accountant).summary()).toEqual({ pending: 1 });
      expect(await inbox(nobody).summary()).toEqual({ pending: 0 });
    });

    it('asks only for one type', async () => {
      const response = await inbox().list('RETURN');
      expect(response.groups.map((g) => g.type)).toEqual(['RETURN']);
      expect(response.groups[0].count).toBe(1);
      // the KPIs do not depend on the chip
      expect(response.kpis.pending).toBe(4);
    });

    it('refuses a type it does not know', async () => {
      expect(await codeOf(inbox().list('DISCOUNT'))).toBe('INVALID_FILTER');
    });
  });

  describe('who sees what', () => {
    it('shows only the types the caller may decide', async () => {
      const response = await inbox(accountant).list();
      expect(response.groups.map((g) => [g.type, g.count])).toEqual([['CASH_DIFFERENCE', 1]]);
      expect(response.kpis.pending).toBe(1);
      expect((await inbox(accountant).list('RETURN')).groups).toEqual([]);
    });

    it('shows nothing to a user with none of the four permissions', async () => {
      const response = await inbox(nobody).list();
      expect(response.groups).toEqual([]);
      expect(response.kpis).toEqual({ pending: 0, oldestAt: null, approvedToday: 0, rejectedToday: 0 });
    });

    it('follows the branches the caller operates', async () => {
      const elsewhere = await inbox(manager, { operableBranchIds: [randomUUID()] }).list();
      expect(elsewhere.groups.every((g) => g.count === 0 && g.items.length === 0)).toBe(true);
      expect(elsewhere.kpis.pending).toBe(0);
      const here = await inbox(manager, { operableBranchIds: [state.branchId] }).list();
      expect(here.kpis.pending).toBe(4);
    });

    it('hides the cancellations of sales the caller may not see in the history', async () => {
      const approver = await fx.newMember('approver-only', state.companyId);
      fx.grant(approver, CANCELLATIONS);
      const response = await inbox(approver).list();
      expect(group(response, 'CANCELLATION')).toMatchObject({ count: 0, items: [] });
      // the cashier who asked sees their own sale, if they could approve
      fx.grant(state.cashier, CANCELLATIONS);
      try {
        expect(only(await inbox(state.cashier).list(), 'CANCELLATION').subjectId).toBe(made.cancellation.saleId);
      } finally {
        fx.grant(state.cashier);
      }
    });

    it('never lists the requests of another company', async () => {
      fx.useCompany(state.otherCompanyId);
      fx.grant(state.other, VIEW_ALL, CANCELLATIONS, REVIEW, RETURNS, EXPENSES);
      const response = await inbox(state.other).list();
      expect(response.groups.map((g) => g.count)).toEqual([0, 0, 0, 0]);
      expect(response.kpis).toEqual({ pending: 0, oldestAt: null, approvedToday: 0, rejectedToday: 0 });
    });

    it('does not let the cashier review their own closing', async () => {
      const own = await inbox(made.difference.cashier).list();
      expect(only(own, 'CASH_DIFFERENCE')).toMatchObject({ subjectId: made.difference.shiftId, canDecide: false });
      expect(only(await inbox(accountant).list(), 'CASH_DIFFERENCE').canDecide).toBe(true);
    });
  });

  describe('after a decision', () => {
    it('takes a decided request out of the list and counts it in today', async () => {
      await svc(manager).returns.approve(made.returned.returnId, { comment: 'Conforme' } as never);
      await svc(manager).cashMovements.reject(made.expense.movementId, { comment: 'Sin comprobante' } as never);
      await svc(accountant).cashReview.observe(made.difference.shiftId, { comment: 'Recontar' } as never);

      const response = await inbox().list();
      expect(group(response, 'RETURN')).toMatchObject({ count: 0, items: [] });
      expect(group(response, 'CASH_DIFFERENCE')).toMatchObject({ count: 0, items: [] });
      expect(group(response, 'CASH_EXPENSE')).toMatchObject({ count: 0, items: [] });
      expect(group(response, 'CANCELLATION')?.count).toBe(1);
      // approved: the return; rejected: the expense and the observed shift
      expect(response.kpis).toMatchObject({ pending: 1, approvedToday: 1, rejectedToday: 2 });
      expect(await inbox().summary()).toEqual({ pending: 1 });
    });

    it('does not count a decision of another day, nor a withdrawn request', async () => {
      const before = (await inbox().list()).kpis;
      const request = await state.base.approvalRequest.findFirstOrThrow({ where: { companyId: state.companyId, type: 'RETURN', subjectId: made.returned.returnId } });
      await state.base.approvalRequest.update({ where: { id: request.id }, data: { decidedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) } });

      const withdrawn = await pendingExpense('40.00');
      await svc(withdrawn.cashier).cashMovements.withdraw(withdrawn.movementId);

      const after = (await inbox().list()).kpis;
      expect(after.approvedToday).toBe(before.approvedToday - 1);
      expect(after.rejectedToday).toBe(before.rejectedToday);
      expect(after.pending).toBe(before.pending);
    });
  });
});
