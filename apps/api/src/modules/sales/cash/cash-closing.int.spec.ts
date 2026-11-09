/**
 * Integration test of closing a cash shift (HU-VEN-23) against the real Postgres: the count by denomination, the difference the
 * server computes under the shift lock (never the client's), the QR, card and transfer totals the cashier declares, the review
 * request when something differs, every guard, and the races that must never lose a sale or an expense.
 */
import { randomUUID } from 'node:crypto';
import type { Caller } from '../pos/pos.int-fixture';
import { codeOf, createPosFixture } from '../pos/pos.int-fixture';
import { CashRegistersService } from './cash-registers.service';

jest.setTimeout(30_000);

const fx = createPosFixture('cashclose');
const { state } = fx;
const run = randomUUID().slice(0, 8);

const OPEN = 'sales.cash-register.open';
const APPROVE = 'sales.cash-expenses.approve';

const key = () => randomUUID();
const count = (denomination: string, quantity: number) => ({ denomination, quantity });
/** Bs 600: three bills of 200. */
const SIX_HUNDRED = [count('200', 3)];
const declared = (over: Partial<Record<'QR' | 'CARD' | 'TRANSFER', string>> = {}) => ({ QR: '0', CARD: '0', TRANSFER: '0', ...over });
const closing = (over: Record<string, unknown> = {}) => ({ counts: SIX_HUNDRED, declared: declared({ QR: '100.00' }), closingFloat: '500.00', ...over });

describe('Closing a cash shift (integration, real Postgres)', () => {
  let seq = 0;

  beforeAll(() => fx.setup(), 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));
  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.companySetting.deleteMany({
      where: { companyId: state.companyId, key: { in: ['sales.cashDifferenceTolerance', 'sales.cashExpenseApprovalLimit'] } },
    });
  });

  /** A cashier whose shift expects Bs 600 in cash (100 float + 500 in cash sales) and Bs 100 in QR. */
  async function cashier(label: string, opts: { sales?: boolean } = {}) {
    const shift = await fx.newShift(label, '100.00');
    fx.grant(shift.caller, OPEN);
    if (opts.sales ?? true) {
      await addSale(shift, 'CASH', '500.00');
      await addSale(shift, 'QR', '100.00');
    }
    return shift;
  }

  async function addSale(shift: { shiftId: string; caller: Caller }, method: 'CASH' | 'QR' | 'CARD' | 'TRANSFER', amount: string) {
    seq += 1;
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
        status: 'COMPLETED',
        subtotal: amount,
        total: amount,
        createdById: shift.caller.userId,
        payments: { create: [{ companyId: state.companyId, method, amount }] },
      },
    });
    if (method === 'CASH') {
      await state.base.cashMovement.create({
        data: { companyId: state.companyId, shiftId: shift.shiftId, type: 'SALE_PAYMENT', amount, userId: shift.caller.userId, refType: 'SALE', refId: sale.id },
      });
    }
  }

  const svc = (caller: Caller) => fx.as(caller);
  const shiftRow = (id: string) => state.base.cashShift.findUniqueOrThrow({ where: { id } });
  const setSetting = (settingKey: string, value: string) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key: settingKey } },
      create: { companyId: state.companyId, key: settingKey, value },
      update: { value },
    });

  describe('a closing without difference', () => {
    it('stores the count, the totals and the float, and approves the shift in the same transaction', async () => {
      const { caller, shiftId } = await cashier('clean');
      const result = await svc(caller).cashClosing.close(shiftId, closing());

      expect(result).toMatchObject({
        shiftId,
        status: 'APPROVED',
        expectedAmount: '600.00',
        countedAmount: '600.00',
        differenceAmount: '0.00',
        closingFloat: '500.00',
        needsReview: false,
      });
      const shift = await shiftRow(shiftId);
      expect(shift).toMatchObject({ status: 'APPROVED', closedById: caller.userId, closingComment: null, reviewedById: null });
      expect(shift.closedAt).not.toBeNull();
      expect([shift.expectedAmount?.toFixed(2), shift.countedAmount?.toFixed(2), shift.differenceAmount?.toFixed(2), shift.closingFloat?.toFixed(2)]).toEqual([
        '600.00',
        '600.00',
        '0.00',
        '500.00',
      ]);
      const counts = await state.base.cashCount.findMany({ where: { shiftId } });
      expect(counts.map((c) => [c.denomination.toFixed(2), c.quantity])).toEqual([['200.00', 3]]);
      const totals = (await state.base.cashShiftMethodTotal.findMany({ where: { shiftId } })).sort((a, b) => a.method.localeCompare(b.method));
      expect(totals.map((t) => [t.method, t.systemAmount.toFixed(2), t.declaredAmount.toFixed(2), t.differenceAmount.toFixed(2)])).toEqual([
        ['CARD', '0.00', '0.00', '0.00'],
        ['CASH', '600.00', '600.00', '0.00'],
        ['QR', '100.00', '100.00', '0.00'],
        ['TRANSFER', '0.00', '0.00', '0.00'],
      ]);
      expect(await state.base.approvalRequest.count({ where: { companyId: state.companyId, type: 'CASH_DIFFERENCE', subjectId: shiftId } })).toBe(0);
    });

    it('audits the close and the approval, and publishes the closed event only', async () => {
      const { caller, shiftId } = await cashier('clean-audit');
      await svc(caller).cashClosing.close(shiftId, closing());

      const audits = await state.base.auditLog.findMany({ where: { companyId: state.companyId, entityId: shiftId, action: { startsWith: 'sales.cash-shift.' } }, orderBy: { createdAt: 'asc' } });
      expect(audits.map((a) => a.action).sort()).toEqual(['sales.cash-shift.approve', 'sales.cash-shift.close']);
      const close = audits.find((a) => a.action === 'sales.cash-shift.close');
      expect(close?.before).toEqual({ status: 'OPEN' });
      expect(close?.after).toMatchObject({ status: 'CLOSED', countedAmount: '600.00', closingFloat: '500.00', needsReview: false });
      const approve = audits.find((a) => a.action === 'sales.cash-shift.approve');
      expect(approve?.before).toEqual({ status: 'CLOSED' });
      expect(approve?.after).toEqual({ status: 'APPROVED', automatic: true });
      expect(await state.base.outboxEvent.count({ where: { idempotencyKey: `cash-shift-closed:${shiftId}`, type: 'sales.cash-shift.closed' } })).toBe(1);
      expect(await state.base.outboxEvent.count({ where: { idempotencyKey: `cash-shift-difference:${shiftId}` } })).toBe(0);
    });

    it('counts coins and sums every denomination', async () => {
      const { caller, shiftId } = await cashier('coins');
      const counts = [count('100', 4), count('50', 3), count('20', 2), count('5', 1), count('1', 3), count('0.50', 4), count('10', 0)];
      // 400 + 150 + 40 + 5 + 3 + 2 = 600
      const result = await svc(caller).cashClosing.close(shiftId, closing({ counts }));
      expect(result.countedAmount).toBe('600.00');
      const stored = await state.base.cashCount.findMany({ where: { shiftId } });
      // the row of ten with zero pieces is not stored
      expect(stored).toHaveLength(6);
    });

    it('lets the next opening of the register compare against the last close', async () => {
      const { caller, shiftId, registerId } = await cashier('next-open');
      await svc(caller).cashClosing.close(shiftId, closing());
      const registers = new CashRegistersService(state.base as never, { get: () => 'm' } as never, { operableBranchIds: async () => null } as never);
      const { items } = await registers.list({ branchId: state.branchId });
      const register = items.find((r) => r.id === registerId);
      expect(register?.openShift).toBeNull();
      expect(register?.lastClose).toMatchObject({ shiftId, closingFloat: '500.00', differenceAmount: '0.00' });
    });

    it('closes a shift whose expected cash is negative because refunds took more than the drawer held', async () => {
      const { caller, shiftId } = await cashier('negative', { sales: false });
      await state.base.cashMovement.create({ data: { companyId: state.companyId, shiftId, type: 'REFUND', amount: '150.00', userId: caller.userId, refType: 'SALE', refId: randomUUID() } });
      const result = await svc(caller).cashClosing.close(shiftId, { counts: [], declared: declared(), closingFloat: '0.00', comment: 'Devolución de una venta de otro turno' });
      expect(result).toMatchObject({ status: 'CLOSED', expectedAmount: '-50.00', countedAmount: '0.00', differenceAmount: '50.00' });
      const cash = await state.base.cashShiftMethodTotal.findFirstOrThrow({ where: { shiftId, method: 'CASH' } });
      expect(cash.systemAmount.toFixed(2)).toBe('-50.00');
    });

    it('closes the POS: the cashier has no open shift afterwards', async () => {
      const { caller, shiftId } = await cashier('pos-closed');
      await svc(caller).cashClosing.close(shiftId, closing());
      expect(await codeOf(svc(caller).checkout.addItem({ productId: randomUUID(), quantity: 1 }))).toBe('CASH_SHIFT_NOT_OPEN');
      expect(await codeOf(svc(caller).payment.pay())).toBe('CASH_SHIFT_NOT_OPEN');
    });
  });

  describe('the difference', () => {
    it('is computed by the server from the movements, whatever the client believes', async () => {
      const { caller, shiftId } = await cashier('server-side');
      // income and an expense change what the register should hold: 600 + 50 − 30 = 620
      await svc(caller).cashMovements.create(shiftId, { type: 'INCOME', amount: '50.00', concept: 'BALANCE_COLLECTION' }, undefined, key());
      await svc(caller).cashMovements.create(shiftId, { type: 'EXPENSE', amount: '30.00', concept: 'FREIGHT', detail: 'Flete' }, undefined, key());

      const input = { ...closing({ counts: [count('200', 3), count('20', 1)] }), expectedAmount: '1.00', differenceAmount: '0.00' };
      const result = await svc(caller).cashClosing.close(shiftId, input as never);

      expect(result).toMatchObject({ status: 'APPROVED', expectedAmount: '620.00', countedAmount: '620.00', differenceAmount: '0.00' });
    });

    it('asks for a justification when the count is short, then closes pending review with a request for Accounting', async () => {
      const { caller, shiftId } = await cashier('short');
      const short = closing({ counts: [count('100', 5), count('20', 4)], closingFloat: '100.00' });
      expect(await codeOf(svc(caller).cashClosing.close(shiftId, short))).toBe('CLOSING_COMMENT_REQUIRED');
      expect(await codeOf(svc(caller).cashClosing.close(shiftId, { ...short, comment: '   ' }))).toBe('CLOSING_COMMENT_REQUIRED');
      // nothing was written by the refused attempts
      expect((await shiftRow(shiftId)).status).toBe('OPEN');
      expect(await state.base.cashCount.count({ where: { shiftId } })).toBe(0);

      const result = await svc(caller).cashClosing.close(shiftId, { ...short, comment: '  Faltó un vuelto de Bs 20  ' });

      expect(result).toMatchObject({ status: 'CLOSED', expectedAmount: '600.00', countedAmount: '580.00', differenceAmount: '-20.00', needsReview: true });
      expect(await shiftRow(shiftId)).toMatchObject({ status: 'CLOSED', closingComment: 'Faltó un vuelto de Bs 20', reviewedById: null });
      const request = await state.base.approvalRequest.findFirstOrThrow({ where: { companyId: state.companyId, type: 'CASH_DIFFERENCE', subjectId: shiftId } });
      expect(request).toMatchObject({ status: 'PENDING', requestedById: caller.userId, requesterComment: 'Faltó un vuelto de Bs 20' });
      const event = await state.base.outboxEvent.findFirstOrThrow({ where: { type: 'sales.cash-shift.difference', idempotencyKey: `cash-shift-difference:${shiftId}` } });
      expect(event.payload).toMatchObject({ shiftId, differenceAmount: '-20.00', requestId: request.id });
      expect(await state.base.outboxEvent.count({ where: { type: 'sales.cash-shift.closed', idempotencyKey: `cash-shift-closed:${shiftId}` } })).toBe(1);
      const actions = (await state.base.auditLog.findMany({ where: { companyId: state.companyId, entityId: shiftId } })).map((a) => a.action);
      expect(actions).toContain('sales.cash-shift.close');
      expect(actions).not.toContain('sales.cash-shift.approve');
    });

    it('also needs review for a surplus', async () => {
      const { caller, shiftId } = await cashier('surplus');
      const result = await svc(caller).cashClosing.close(shiftId, closing({ counts: [count('200', 3), count('0.50', 1)], comment: 'Sobró una moneda' }));
      expect(result).toMatchObject({ status: 'CLOSED', differenceAmount: '0.50', needsReview: true });
    });

    it('lets a difference within the configured tolerance close without a justification', async () => {
      await setSetting('sales.cashDifferenceTolerance', '5.00');
      const { caller, shiftId } = await cashier('tolerance');
      const result = await svc(caller).cashClosing.close(shiftId, closing({ counts: [count('200', 2), count('100', 1), count('50', 1), count('20', 2), count('5', 1)], closingFloat: '100.00' }));
      // 400 + 100 + 50 + 40 + 5 = 595: Bs 5 short, which the tolerance allows
      expect(result).toMatchObject({ status: 'APPROVED', differenceAmount: '-5.00', needsReview: false });
    });

    it('treats a tolerance that is not an amount as zero', async () => {
      await setSetting('sales.cashDifferenceTolerance', 'abc');
      const { caller, shiftId } = await cashier('bad-tolerance');
      expect(await codeOf(svc(caller).cashClosing.close(shiftId, closing({ counts: [count('200', 3), count('1', 1)] })))).toBe('CLOSING_COMMENT_REQUIRED');
    });

    it('stores what the cashier declared for QR, card and transfer, and needs review when one differs', async () => {
      const { caller, shiftId } = await cashier('methods');
      await addSale({ shiftId, caller }, 'CARD', '200.00');
      await addSale({ shiftId, caller }, 'TRANSFER', '80.00');
      const input = closing({ declared: declared({ QR: '100.00', CARD: '150.00', TRANSFER: '80.00' }) });
      expect(await codeOf(svc(caller).cashClosing.close(shiftId, input))).toBe('CLOSING_COMMENT_REQUIRED');

      const result = await svc(caller).cashClosing.close(shiftId, { ...input, comment: 'El POS de tarjeta cerró un lote antes' });

      expect(result).toMatchObject({ status: 'CLOSED', needsReview: true, differenceAmount: '0.00' });
      const totals = (await state.base.cashShiftMethodTotal.findMany({ where: { shiftId } })).sort((a, b) => a.method.localeCompare(b.method));
      expect(totals.map((t) => [t.method, t.systemAmount.toFixed(2), t.declaredAmount.toFixed(2), t.differenceAmount.toFixed(2)])).toEqual([
        ['CARD', '200.00', '150.00', '-50.00'],
        ['CASH', '600.00', '600.00', '0.00'],
        ['QR', '100.00', '100.00', '0.00'],
        ['TRANSFER', '80.00', '80.00', '0.00'],
      ]);
      expect(await state.base.approvalRequest.count({ where: { type: 'CASH_DIFFERENCE', subjectId: shiftId } })).toBe(1);
    });

    it('does not count a cancelled sale in the QR the system expects', async () => {
      const { caller, shiftId } = await cashier('cancelled-qr');
      await state.base.sale.updateMany({ where: { shiftId, payments: { some: { method: 'QR' } } }, data: { status: 'CANCELLED' } });
      const result = await svc(caller).cashClosing.close(shiftId, closing({ declared: declared() }));
      expect(result.status).toBe('APPROVED');
    });
  });

  describe('the guards', () => {
    it.each([
      ['an unknown denomination', { counts: [count('3', 1)] }, 'INVALID_DENOMINATION'],
      ['a repeated denomination', { counts: [count('50', 1), count('50.00', 1)] }, 'INVALID_DENOMINATION'],
      ['a negative quantity', { counts: [count('50', -1)] }, 'INVALID_COUNT'],
      ['a fraction of a piece', { counts: [count('50', 1.5)] }, 'INVALID_COUNT'],
      ['a negative declared amount', { declared: declared({ QR: '-1' }) }, 'INVALID_CASH_AMOUNT'],
      ['a declared amount with 3 decimals', { declared: declared({ QR: '1.001' }) }, 'INVALID_CASH_AMOUNT'],
      ['a negative float', { closingFloat: '-5' }, 'INVALID_CASH_AMOUNT'],
      ['a float larger than the cash counted', { closingFloat: '600.01' }, 'CLOSING_FLOAT_EXCEEDS_COUNTED'],
    ])('refuses %s and leaves the shift open', async (_label, over, code) => {
      const { caller, shiftId } = await cashier('guard');
      expect(await codeOf(svc(caller).cashClosing.close(shiftId, closing(over)))).toBe(code);
      expect((await shiftRow(shiftId)).status).toBe('OPEN');
      expect(await state.base.cashCount.count({ where: { shiftId } })).toBe(0);
      expect(await state.base.cashShiftMethodTotal.count({ where: { shiftId } })).toBe(0);
    });

    it('refuses another cashier’s shift, an unknown shift and another company’s shift', async () => {
      const mine = await cashier('mine', { sales: false });
      const theirs = await cashier('theirs', { sales: false });
      expect(await codeOf(svc(mine.caller).cashClosing.close(theirs.shiftId, closing()))).toBe('CASH_SHIFT_NOT_OWNED');
      expect(await codeOf(svc(mine.caller).cashClosing.close(randomUUID(), closing()))).toBe('CASH_SHIFT_NOT_FOUND');
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(state.other).cashClosing.close(theirs.shiftId, closing()))).toBe('CASH_SHIFT_NOT_FOUND');
      fx.useCompany(state.companyId);
      expect((await shiftRow(theirs.shiftId)).status).toBe('OPEN');
    });

    it('refuses a shift that is already closed', async () => {
      const { caller, shiftId } = await cashier('twice');
      await svc(caller).cashClosing.close(shiftId, closing());
      expect(await codeOf(svc(caller).cashClosing.close(shiftId, closing()))).toBe('CASH_SHIFT_NOT_OPEN');
      expect(await state.base.cashCount.count({ where: { shiftId } })).toBe(1);
    });

    it('refuses to close while an expense waits for approval, until it is withdrawn', async () => {
      await setSetting('sales.cashExpenseApprovalLimit', '50.00');
      const { caller, shiftId } = await cashier('pending-expense');
      const pending = await svc(caller).cashMovements.create(shiftId, { type: 'EXPENSE', amount: '80.00', concept: 'FREIGHT', detail: 'Flete' }, undefined, key());
      expect(pending.status).toBe('PENDING');
      expect(await codeOf(svc(caller).cashClosing.close(shiftId, closing()))).toBe('CASH_SHIFT_HAS_PENDING_EXPENSES');
      expect((await shiftRow(shiftId)).status).toBe('OPEN');

      await svc(caller).cashMovements.withdraw(pending.id);
      expect((await svc(caller).cashClosing.close(shiftId, closing())).status).toBe('APPROVED');
    });

    it('refuses to close while a QR or card payment of the shift is still waiting', async () => {
      const { caller, shiftId } = await cashier('pending-payment');
      const checkout = await state.base.posCheckout.create({ data: { companyId: state.companyId, cashierId: caller.userId, shiftId, status: 'PAYING' } });
      const payment = await state.base.posCheckoutPayment.create({
        data: { companyId: state.companyId, checkoutId: checkout.id, method: 'QR', amount: '50.00', idempotencyKey: key(), status: 'PENDING', providerRef: 'ref', qrPayload: 'qr', expiresAt: new Date(Date.now() + 300_000) },
      });
      expect(await codeOf(svc(caller).cashClosing.close(shiftId, closing()))).toBe('CASH_SHIFT_HAS_PENDING_PAYMENTS');
      expect((await shiftRow(shiftId)).status).toBe('OPEN');
      expect((await state.base.posCheckout.findUniqueOrThrow({ where: { id: checkout.id } })).status).toBe('PAYING');

      await state.base.posCheckoutPayment.update({ where: { id: payment.id }, data: { status: 'CANCELLED' } });
      expect((await svc(caller).cashClosing.close(shiftId, closing())).status).toBe('APPROVED');
    });
  });

  describe('the carts of the shift', () => {
    it('abandons the open, held and payment-step carts, audited, and leaves finished ones alone', async () => {
      const { caller, shiftId } = await cashier('carts');
      const cart = (status: 'OPEN' | 'ON_HOLD' | 'PAYING' | 'COMPLETED') =>
        state.base.posCheckout.create({ data: { companyId: state.companyId, cashierId: caller.userId, shiftId, status } });
      const open = await cart('OPEN');
      const held = await cart('ON_HOLD');
      const paying = await cart('PAYING');
      const completed = await state.base.posCheckout.findFirstOrThrow({ where: { shiftId, status: 'COMPLETED' } });
      expect(completed).toBeDefined();

      await svc(caller).cashClosing.close(shiftId, closing());

      const statuses = await state.base.posCheckout.findMany({ where: { id: { in: [open.id, held.id, paying.id, completed.id] } } });
      const byId = new Map(statuses.map((c) => [c.id, c.status]));
      expect([byId.get(open.id), byId.get(held.id), byId.get(paying.id), byId.get(completed.id)]).toEqual(['ABANDONED', 'ABANDONED', 'ABANDONED', 'COMPLETED']);
      const audits = await state.base.auditLog.findMany({ where: { companyId: state.companyId, action: 'sales.pos-checkout.abandon', entityId: { in: [open.id, held.id, paying.id] } } });
      expect(audits).toHaveLength(3);
      expect(audits[0].after).toMatchObject({ status: 'ABANDONED', reason: 'CASH_SHIFT_CLOSED', shiftId });
    });
  });

  describe('concurrency', () => {
    /** A cart of one 245 Bs product in PAYING, ready for `payment.complete`. */
    async function readyToPay(caller: Caller) {
      const product = await fx.newProduct({ price: '245.00', stock: { [state.centralId]: 5 } });
      await svc(caller).checkout.addItem({ productId: product.id, quantity: 1 });
      await svc(caller).payment.pay();
    }
    const sell = (caller: Caller) =>
      svc(caller).payment.complete({ payments: [{ method: 'CASH', received: '300.00' }], expectedTotal: '245.00', idempotencyKey: key() });
    const lostCode = (result: PromiseSettledResult<unknown>) => (result as PromiseRejectedResult).reason.getResponse().code as string;

    it('never loses a cash sale that races the closing: either it is in the expected cash or it was refused', async () => {
      for (let round = 0; round < 6; round += 1) {
        const { caller, shiftId } = await cashier(`race-sale-${round}`, { sales: false });
        await readyToPay(caller);
        const input = { counts: [count('200', 5)], declared: declared(), closingFloat: '0.00', comment: 'Venta en curso al cerrar' };

        const [closed, sale] = await Promise.allSettled([svc(caller).cashClosing.close(shiftId, input), sell(caller)]);

        expect(closed.status).toBe('fulfilled');
        const posted = await state.base.cashMovement.count({ where: { shiftId, type: 'SALE_PAYMENT' } });
        const shift = await shiftRow(shiftId);
        if (sale.status === 'fulfilled') {
          // the sale won the lock: it is in the cash the closing compared against
          expect(posted).toBe(1);
          expect(shift.expectedAmount?.toFixed(2)).toBe('345.00');
        } else {
          expect(lostCode(sale)).toBe('CASH_SHIFT_NOT_OPEN');
          expect(posted).toBe(0);
          expect(shift.expectedAmount?.toFixed(2)).toBe('100.00');
        }
        // either way the shift stays closed and its expected cash matches its movements
        expect(shift.status).toBe('CLOSED');
        expect(await state.base.sale.count({ where: { shiftId, status: 'COMPLETED' } })).toBe(sale.status === 'fulfilled' ? 1 : 0);
      }
    });

    it('never loses an expense that races the closing', async () => {
      for (let round = 0; round < 6; round += 1) {
        const { caller, shiftId } = await cashier(`race-expense-${round}`, { sales: false });
        const input = { counts: [count('50', 2)], declared: declared(), closingFloat: '0.00', comment: 'Egreso en curso al cerrar' };

        const [closed, expense] = await Promise.allSettled([
          svc(caller).cashClosing.close(shiftId, input),
          svc(caller).cashMovements.create(shiftId, { type: 'EXPENSE', amount: '30.00', concept: 'FREIGHT', detail: 'Flete' }, undefined, key()),
        ]);

        expect(closed.status).toBe('fulfilled');
        const shift = await shiftRow(shiftId);
        if (expense.status === 'fulfilled') {
          expect(shift.expectedAmount?.toFixed(2)).toBe('70.00');
          expect(await state.base.cashMovement.count({ where: { shiftId, type: 'EXPENSE', status: 'POSTED' } })).toBe(1);
        } else {
          expect(lostCode(expense)).toBe('CASH_SHIFT_NOT_OPEN');
          expect(shift.expectedAmount?.toFixed(2)).toBe('100.00');
          expect(await state.base.cashMovement.count({ where: { shiftId, type: 'EXPENSE' } })).toBe(0);
        }
      }
    });

    it('lets only one of two closings win', async () => {
      for (let round = 0; round < 4; round += 1) {
        const { caller, shiftId } = await cashier(`race-close-${round}`);
        const results = await Promise.allSettled([svc(caller).cashClosing.close(shiftId, closing()), svc(caller).cashClosing.close(shiftId, closing())]);

        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(lostCode(results.find((r) => r.status === 'rejected') as PromiseSettledResult<unknown>)).toBe('CASH_SHIFT_NOT_OPEN');
        expect(await state.base.cashCount.count({ where: { shiftId } })).toBe(1);
        expect(await state.base.auditLog.count({ where: { companyId: state.companyId, entityId: shiftId, action: 'sales.cash-shift.close' } })).toBe(1);
        expect(await state.base.outboxEvent.count({ where: { idempotencyKey: `cash-shift-closed:${shiftId}` } })).toBe(1);
      }
    });

    it('lets an approval race the closing without closing over a pending expense', async () => {
      await setSetting('sales.cashExpenseApprovalLimit', '50.00');
      const approver = await fx.newMember('close-approver', state.companyId);
      fx.grant(approver, APPROVE);
      for (let round = 0; round < 4; round += 1) {
        const { caller, shiftId } = await cashier(`race-approve-${round}`, { sales: false });
        const pending = await svc(caller).cashMovements.create(shiftId, { type: 'EXPENSE', amount: '80.00', concept: 'FREIGHT', detail: 'Flete' }, undefined, key());
        const input = { counts: [count('20', 1)], declared: declared(), closingFloat: '0.00', comment: 'Con egreso pendiente' };

        const [closed, approved] = await Promise.allSettled([svc(caller).cashClosing.close(shiftId, input), svc(approver).cashMovements.approve(pending.id, {})]);

        // the closing is refused while the expense is pending, and the approval then wins; or the closing sees it posted
        const shift = await shiftRow(shiftId);
        const movement = await state.base.cashMovement.findUniqueOrThrow({ where: { id: pending.id } });
        expect(approved.status).toBe('fulfilled');
        expect(movement.status).toBe('POSTED');
        if (closed.status === 'fulfilled') {
          expect(shift.expectedAmount?.toFixed(2)).toBe('20.00');
        } else {
          expect(lostCode(closed)).toBe('CASH_SHIFT_HAS_PENDING_EXPENSES');
          expect(shift.status).toBe('OPEN');
        }
      }
    });
  });
});
