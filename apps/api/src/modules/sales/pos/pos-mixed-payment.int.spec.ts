/**
 * Integration test of the mixed payment (HU-VEN-09) against the real Postgres: a QR for part of the total plus the cash that
 * pays the rest. The sale is written atomically (stock, one payment per method, cash only for the cash line, invoice, audit,
 * outbox), the QR part is bounded by the total and the setting, and a confirmed QR keeps the cart from going back.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, type Caller } from './pos.int-fixture';

const fx = createPosFixture('posmix');
const { state } = fx;

const key = () => randomUUID();

describe('POS mixed payment (integration, real Postgres)', () => {
  beforeAll(() => fx.setup(), 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
    await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
    await state.base.companySetting.deleteMany({
      where: { companyId: state.companyId, key: { in: ['sales.allowMixedPayment', 'sales.roundingMode'] } },
    });
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);

  const product = (stock: number, price = '250.00') => fx.newProduct({ price, stock: { [state.centralId]: stock } });

  async function pay(lines: [string, number][], caller: Caller = state.cashier) {
    for (const [productId, quantity] of lines) await svc(caller).checkout.addItem({ productId, quantity });
    return svc(caller).payment.pay();
  }

  /** A cart of 4 × 250.00 = 1.000,00 in payment. */
  async function payingThousand() {
    const p = await product(10);
    const { total } = await pay([[p.id, 4]]);
    expect(total).toBe('1000.00');
    return { p, total };
  }

  const startQr = (expectedTotal: string, amount?: string, caller: Caller = state.cashier, idempotencyKey: string = key()) =>
    svc(caller).qr.start({ idempotencyKey, expectedTotal, ...(amount ? { amount } : {}) });

  const approve = (paymentId: string, caller: Caller = state.cashier) => svc(caller).qr.confirm(paymentId, { outcome: 'APPROVED' });

  /** A partial QR, opened and approved. */
  async function paidQr(total: string, amount: string) {
    const { payment } = await startQr(total, amount);
    await approve(payment.paymentId);
    return payment;
  }

  const completeMix = (
    payment: { paymentId: string; idempotencyKey: string },
    received: string,
    expectedTotal: string,
    caller: Caller = state.cashier,
  ) =>
    svc(caller).payment.complete({
      payments: [
        { method: 'CASH', received },
        { method: 'QR', paymentId: payment.paymentId },
      ],
      expectedTotal,
      idempotencyKey: payment.idempotencyKey,
    });

  const stockOf = async (productId: string) =>
    (
      await state.base.stockLevel.findUniqueOrThrow({
        where: { productId_warehouseId: { productId, warehouseId: state.centralId } },
      })
    ).quantity;

  const setMixed = (value: boolean) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key: 'sales.allowMixedPayment' } },
      create: { companyId: state.companyId, key: 'sales.allowMixedPayment', value },
      update: { value },
    });

  describe('a QR for part of the total', () => {
    it('opens for the amount the cashier gives and stores it', async () => {
      const { total } = await payingThousand();
      const { payment } = await startQr(total, '700');
      expect(payment).toMatchObject({ amount: '700.00', status: 'PENDING' });
      expect(payment.qrPayload).toMatch(/\|700\.00$/);
      const audit = await state.base.auditLog.findFirstOrThrow({
        where: { companyId: state.companyId, action: 'sales.payment.qr-start' },
      });
      expect(audit.after).toMatchObject({ amount: '700.00', total: '1000.00' });
    });

    it('refuses an amount of zero or above the total', async () => {
      const { total } = await payingThousand();
      expect(await codeOf(startQr(total, '0'))).toBe('QR_AMOUNT_INVALID');
      expect(await codeOf(startQr(total, '1000.01'))).toBe('QR_AMOUNT_INVALID');
    });

    it('refuses a part when the company turned mixed payment off, but still charges the whole total', async () => {
      await setMixed(false);
      const { total } = await payingThousand();
      expect(await codeOf(startQr(total, '700'))).toBe('MIXED_PAYMENT_DISABLED');
      expect((await startQr(total, '1000')).payment.amount).toBe('1000.00');
    });
  });

  describe('complete with cash and QR', () => {
    it('writes the whole sale atomically: stock, one payment per method, cash movement for the cash only', async () => {
      const { p, total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const { sale } = await completeMix(qr, '300', total);

      expect(sale).toMatchObject({ total: '1000.00', received: '1000.00', change: '0.00' });
      expect(await stockOf(p.id)).toBe(6);

      const payments = await state.base.salePayment.findMany({
        where: { saleId: sale.saleId },
        orderBy: { method: 'asc' },
      });
      expect(payments.map((x) => [x.method, x.amount.toFixed(2), x.change.toFixed(2)])).toEqual([
        ['CASH', '300.00', '0.00'],
        ['QR', '700.00', '0.00'],
      ]);
      expect(payments.find((x) => x.method === 'QR')).toMatchObject({ providerStatus: 'CONFIRMED' });

      const cash = await state.base.cashMovement.findMany({ where: { companyId: state.companyId } });
      expect(cash).toHaveLength(1);
      expect(cash[0]).toMatchObject({ type: 'SALE_PAYMENT', refId: sale.saleId });
      expect(cash[0].amount.toFixed(2)).toBe('300.00');

      expect(await state.base.invoice.count({ where: { saleId: sale.saleId, status: 'PENDING' } })).toBe(1);
      const audit = await state.base.auditLog.findFirstOrThrow({
        where: { companyId: state.companyId, action: 'sales.sale.complete' },
      });
      expect(audit.after).toMatchObject({
        method: 'MIXED',
        payments: [
          { method: 'CASH', amount: '300.00' },
          { method: 'QR', amount: '700.00' },
        ],
      });
      expect(await state.base.outboxEvent.count({ where: { companyId: state.companyId, type: 'sale.completed' } })).toBe(1);
      expect((await svc().checkout.current()).checkout).toBeNull();
    });

    it('gives the change on the cash line only, and the register keeps the cash net of it', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const { sale } = await completeMix(qr, '500', total);
      expect(sale).toMatchObject({ received: '1200.00', change: '200.00' });

      const cash = await state.base.salePayment.findFirstOrThrow({ where: { saleId: sale.saleId, method: 'CASH' } });
      expect(cash.amount.toFixed(2)).toBe('300.00');
      expect(cash.change.toFixed(2)).toBe('200.00');
      const movement = await state.base.cashMovement.findFirstOrThrow({ where: { companyId: state.companyId } });
      expect(movement.amount.toFixed(2)).toBe('300.00');
    });

    it('refuses cash that does not cover what the QR leaves', async () => {
      const { p, total } = await payingThousand();
      const qr = await paidQr(total, '700');
      expect(await codeOf(completeMix(qr, '299.99', total))).toBe('PAYMENT_NOT_COVERED');
      expect(await stockOf(p.id)).toBe(10);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('refuses an invalid cash amount', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      expect(await codeOf(completeMix(qr, 'abc', total))).toBe('INVALID_AMOUNT');
    });

    it('does not complete with a QR that was not confirmed', async () => {
      const { total } = await payingThousand();
      const { payment } = await startQr(total, '700');
      expect(await codeOf(completeMix(payment, '300', total))).toBe('PAYMENT_NOT_CONFIRMED');
    });

    it('does not complete with a declined or cancelled QR', async () => {
      const { total } = await payingThousand();
      const { payment } = await startQr(total, '700');
      await svc().qr.confirm(payment.paymentId, { outcome: 'DECLINED' });
      expect(await codeOf(completeMix(payment, '300', total))).toBe('PAYMENT_NOT_CONFIRMED');
    });

    it('does not complete a partial QR on its own: the rest is not covered', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const code = await codeOf(
        svc().payment.complete({
          payments: [{ method: 'QR', paymentId: qr.paymentId }],
          expectedTotal: total,
          idempotencyKey: qr.idempotencyKey,
        }),
      );
      expect(code).toBe('PAYMENT_NOT_COVERED');
    });

    it('refuses the same method twice', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const code = await codeOf(
        svc().payment.complete({
          payments: [
            { method: 'CASH', received: '300' },
            { method: 'CASH', received: '300' },
          ],
          expectedTotal: total,
          idempotencyKey: qr.idempotencyKey,
        }),
      );
      expect(code).toBe('PAYMENT_DUPLICATE_METHOD');
    });

    it('refuses methods that cannot be mixed yet', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const code = await codeOf(
        svc().payment.complete({
          payments: [
            { method: 'CASH', received: '300' },
            { method: 'CARD', paymentId: qr.paymentId },
          ],
          expectedTotal: total,
          idempotencyKey: qr.idempotencyKey,
        }),
      );
      expect(code).toBe('PAYMENT_METHOD_NOT_AVAILABLE');
    });

    it('refuses the mix when the setting is off, even if the QR was opened before', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      await setMixed(false);
      expect(await codeOf(completeMix(qr, '300', total))).toBe('MIXED_PAYMENT_DISABLED');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('answers a repeat with the same key by the same sale, once', async () => {
      const { p, total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const first = await completeMix(qr, '500', total);
      const second = await completeMix(qr, '500', total);
      expect(second.sale).toEqual(first.sale);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await stockOf(p.id)).toBe(6);
      expect(await state.base.salePayment.count({ where: { companyId: state.companyId } })).toBe(2);
    });

    it('two concurrent completes make one sale', async () => {
      const { p, total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const results = await Promise.allSettled([completeMix(qr, '300', total), completeMix(qr, '300', total)]);
      expect(results.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await state.base.cashMovement.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await stockOf(p.id)).toBe(6);
    });

    it('a failure after the stock step rolls everything back, and the QR stays confirmed', async () => {
      const x = await product(10);
      const y = await product(10);
      const [early, late] = [x, y].sort((l, r) => (l.id < r.id ? -1 : 1));
      const { total } = await pay([
        [early.id, 2],
        [late.id, 2],
      ]);
      const qr = await paidQr(total, '300');
      // the sale takes `early` first (ids in order); `late` runs out after `pay`
      await state.base.stockLevel.update({
        where: { productId_warehouseId: { productId: late.id, warehouseId: state.centralId } },
        data: { quantity: 1 },
      });
      expect(await codeOf(completeMix(qr, '700', total))).toBe('INSUFFICIENT_STOCK');

      expect(await stockOf(early.id)).toBe(10);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await state.base.salePayment.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await state.base.cashMovement.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await state.base.posCheckoutPayment.count({ where: { companyId: state.companyId, method: 'CASH' } })).toBe(0);
      const row = await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: qr.paymentId } });
      expect(row.status).toBe('CONFIRMED');
    });

    it('is refused when the shift is not open', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const shift = await state.base.cashShift.findFirstOrThrow({
        where: { openedById: state.cashier.userId, status: 'OPEN' },
      });
      await state.base.cashShift.update({ where: { id: shift.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      try {
        expect(await codeOf(completeMix(qr, '300', total))).toBe('CASH_SHIFT_NOT_OPEN');
        expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      } finally {
        await state.base.cashShift.update({ where: { id: shift.id }, data: { status: 'OPEN', closedAt: null } });
      }
    });

    it('does not let another cashier use my confirmed QR', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const p = await product(10);
      const other = await pay([[p.id, 1]], state.second);
      // with my key the sale is not theirs; with their own key my payment is not in their cart
      expect(await codeOf(completeMix(qr, other.total, other.total, state.second))).toBe('CHECKOUT_NOT_FOUND');
      const theirs = { paymentId: qr.paymentId, idempotencyKey: key() };
      expect(await codeOf(completeMix(theirs, other.total, other.total, state.second))).toBe('PAYMENT_NOT_FOUND');
    });

    it('refuses to complete the QR under another key than the one it was opened with', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const code = await codeOf(completeMix({ paymentId: qr.paymentId, idempotencyKey: key() }, '300', total));
      expect(code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('accepts a cash amount with a trailing comma, as the cash-only payment does', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const { sale } = await completeMix(qr, '300,', total);
      expect(sale).toMatchObject({ received: '1000.00', change: '0.00' });
    });

    it('writes one kardex movement per product that points at the sale', async () => {
      const { p, total } = await payingThousand();
      const qr = await paidQr(total, '700');
      const { sale } = await completeMix(qr, '300', total);
      const movements = await state.base.stockMovement.findMany({ where: { productId: p.id, type: 'SALE' } });
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ refType: 'SALE', refId: sale.saleId, refNumber: sale.number, quantity: -4 });
      expect(movements[0].balanceAfter).toBe(await stockOf(p.id));
    });

    it('does not see another company’s payment', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(state.other).qr.get(qr.paymentId))).toBe('PAYMENT_NOT_FOUND');
    });
  });

  describe('going back with a confirmed QR', () => {
    it('is refused: the customer already paid that part', async () => {
      const { total } = await payingThousand();
      const qr = await paidQr(total, '700');
      expect(await codeOf(svc().payment.back())).toBe('PAYMENT_ALREADY_CONFIRMED');
      expect((await svc().checkout.current()).checkout?.status).toBe('PAYING');
      const row = await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: qr.paymentId } });
      expect(row.status).toBe('CONFIRMED');
    });

    it('is allowed while the QR still waits: the QR is dropped', async () => {
      const { total } = await payingThousand();
      const { payment } = await startQr(total, '700');
      await svc().payment.back();
      const row = await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } });
      expect(row.status).toBe('CANCELLED');
    });
  });
});
