/**
 * Integration test of paying by QR (HU-VEN-08) against the real Postgres: the QR opens for the frozen total, waits for the
 * cashier's outcome, can be dropped to pay another way, expires on the server, and only a CONFIRMED QR completes the sale,
 * which writes everything atomically but no cash movement. The mock provider keeps its state in memory; one test wipes it to
 * prove the database row is the source of truth.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, type Caller } from './pos.int-fixture';

const fx = createPosFixture('posqr');
const { state } = fx;

const key = () => randomUUID();

describe('POS QR payment (integration, real Postgres)', () => {
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
      where: { companyId: state.companyId, key: { in: ['sales.roundingMode', 'sales.qrConfirmTimeoutSeconds'] } },
    });
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);

  const product = (stock: number, price = '245.00') => fx.newProduct({ price, stock: { [state.centralId]: stock } });

  /** Fills the cart and sends it to payment. */
  async function pay(lines: [string, number][], caller: Caller = state.cashier) {
    for (const [productId, quantity] of lines) await svc(caller).checkout.addItem({ productId, quantity });
    return svc(caller).payment.pay();
  }

  const startQr = (expectedTotal: string, caller: Caller = state.cashier, idempotencyKey: string = key()) =>
    svc(caller).qr.start({ idempotencyKey, expectedTotal });

  /** A cart with one product, paying, and its QR opened. */
  async function payingWithQr(price = '245.00', quantity = 2) {
    const p = await product(10, price);
    const { total } = await pay([[p.id, quantity]]);
    const { payment } = await startQr(total);
    return { p, total, payment };
  }

  const completeWithQr = (paymentId: string, idempotencyKey: string, expectedTotal: string, caller: Caller = state.cashier) =>
    svc(caller).payment.complete({ payments: [{ method: 'QR', paymentId }], expectedTotal, idempotencyKey });

  const stockOf = async (productId: string) =>
    (
      await state.base.stockLevel.findUniqueOrThrow({
        where: { productId_warehouseId: { productId, warehouseId: state.centralId } },
      })
    ).quantity;

  const expireNow = (paymentId: string) =>
    state.base.posCheckoutPayment.update({ where: { id: paymentId }, data: { expiresAt: new Date(Date.now() - 1000) } });

  describe('start', () => {
    it('opens a pending QR for the frozen total and stores it', async () => {
      const { total, payment } = await payingWithQr();
      expect(total).toBe('490.00');
      expect(payment).toMatchObject({ amount: '490.00', status: 'PENDING' });
      expect(payment.qrPayload).toMatch(/^RODASOFT-MOCK\|.+\|490\.00$/);

      const row = await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } });
      expect(row).toMatchObject({ method: 'QR', status: 'PENDING', idempotencyKey: payment.idempotencyKey });
      expect(row.amount.toFixed(2)).toBe('490.00');
      expect(row.providerRef).toBeTruthy();
      expect(row.qrPayload).toBe(payment.qrPayload);
      expect(new Date(payment.expiresAt).getTime()).toBeGreaterThan(Date.now() + 290_000);
      expect(new Date(payment.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 300_000);

      const audit = await state.base.auditLog.findFirstOrThrow({
        where: { companyId: state.companyId, action: 'sales.payment.qr-start' },
      });
      expect(audit).toMatchObject({ entity: 'PosCheckoutPayment', entityId: payment.paymentId, userId: state.cashier.userId });
    });

    it('uses the rounded total of the sale', async () => {
      await state.base.companySetting.create({
        data: { companyId: state.companyId, key: 'sales.roundingMode', value: 'INTEGER' },
      });
      const p = await product(10, '245.50');
      const { total } = await pay([[p.id, 3]]);
      expect(total).toBe('737.00');
      expect((await startQr(total)).payment.amount).toBe('737.00');
    });

    it('takes the deadline from the company setting', async () => {
      await state.base.companySetting.create({
        data: { companyId: state.companyId, key: 'sales.qrConfirmTimeoutSeconds', value: 60 },
      });
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const { payment } = await startQr(total);
      const left = new Date(payment.expiresAt).getTime() - Date.now();
      expect(left).toBeGreaterThan(50_000);
      expect(left).toBeLessThanOrEqual(60_000);
    });

    it('answers a repeat with the same key by the same payment, once', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const k = key();
      const first = await startQr(total, state.cashier, k);
      const second = await startQr(total, state.cashier, k);
      expect(second.payment).toEqual(first.payment);
      expect(await state.base.posCheckoutPayment.count({ where: { companyId: state.companyId, method: 'QR' } })).toBe(1);
    });

    it('lets one of two concurrent starts win; the other gets QR_ALREADY_PENDING', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const results = await Promise.allSettled([startQr(total), startQr(total)]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect((failed[0].reason as { getResponse: () => { code: string } }).getResponse().code).toBe('QR_ALREADY_PENDING');
      expect(
        await state.base.posCheckoutPayment.count({ where: { companyId: state.companyId, method: 'QR', status: 'PENDING' } }),
      ).toBe(1);
    });

    it('refuses a second QR while one waits', async () => {
      const { total } = await payingWithQr();
      expect(await codeOf(startQr(total))).toBe('QR_ALREADY_PENDING');
    });

    it('refuses a total that is not the one the cashier saw', async () => {
      const p = await product(10);
      await pay([[p.id, 1]]);
      expect(await codeOf(startQr('999.00'))).toBe('CHECKOUT_TOTAL_CHANGED');
      expect(await state.base.posCheckoutPayment.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('needs a cart waiting for payment', async () => {
      const p = await product(10);
      expect(await codeOf(startQr('245.00'))).toBe('CHECKOUT_NOT_FOUND');
      await svc().checkout.addItem({ productId: p.id, quantity: 1 });
      expect(await codeOf(startQr('245.00'))).toBe('CHECKOUT_NOT_PAYING');
    });

    it('needs an open shift', async () => {
      expect(await codeOf(startQr('245.00', state.noShift))).toBe('CASH_SHIFT_NOT_OPEN');
    });

    it('refuses a key that already belongs to another cashier’s payment', async () => {
      const first = await payingWithQr();
      const p = await product(10);
      const { total } = await pay([[p.id, 1]], state.second);
      expect(await codeOf(startQr(total, state.second, first.payment.idempotencyKey))).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await state.base.posCheckoutPayment.count({ where: { companyId: state.companyId, method: 'QR' } })).toBe(1);
    });
  });

  describe('status and confirmation', () => {
    it('reports the state of my QR payment', async () => {
      const { payment } = await payingWithQr();
      expect((await svc().qr.get(payment.paymentId)).payment).toEqual(payment);
    });

    it('does not show my payment to another cashier or another company', async () => {
      const { payment } = await payingWithQr();
      expect(await codeOf(svc(state.second).qr.get(payment.paymentId))).toBe('PAYMENT_NOT_FOUND');
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(state.other).qr.get(payment.paymentId))).toBe('PAYMENT_NOT_FOUND');
    });

    it('does not let another cashier settle my payment', async () => {
      const { payment } = await payingWithQr();
      expect(await codeOf(svc(state.second).qr.confirm(payment.paymentId, { outcome: 'APPROVED' }))).toBe('PAYMENT_NOT_FOUND');
      expect(await codeOf(svc(state.second).qr.cancel(payment.paymentId))).toBe('PAYMENT_NOT_FOUND');
    });

    it('confirms the payment, audited, and a repeat changes nothing', async () => {
      const { payment } = await payingWithQr();
      const done = await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' });
      expect(done.payment.status).toBe('CONFIRMED');
      expect((await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' })).payment.status).toBe('CONFIRMED');
      expect(
        await state.base.auditLog.count({ where: { companyId: state.companyId, action: 'sales.payment.qr-confirm' } }),
      ).toBe(1);
    });

    it('records a payment that did not arrive as DECLINED, final', async () => {
      const { payment } = await payingWithQr();
      expect((await svc().qr.confirm(payment.paymentId, { outcome: 'DECLINED' })).payment.status).toBe('DECLINED');
      expect(await codeOf(svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' }))).toBe('PAYMENT_INVALID_STATE');
      expect(await codeOf(svc().qr.cancel(payment.paymentId))).toBe('PAYMENT_INVALID_STATE');
    });

    it('lets a new QR open after a declined one', async () => {
      const { total, payment } = await payingWithQr();
      await svc().qr.confirm(payment.paymentId, { outcome: 'DECLINED' });
      const next = await startQr(total);
      expect(next.payment.status).toBe('PENDING');
      expect(next.payment.paymentId).not.toBe(payment.paymentId);
    });

    it('still settles a payment the provider forgot (restart): the database row is the truth', async () => {
      const { payment } = await payingWithQr();
      (fx.mock as unknown as { payments: Map<string, unknown> }).payments.clear();
      expect((await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' })).payment.status).toBe('CONFIRMED');
    });

    it('lists the QR the cart waits for, and nothing once there is none', async () => {
      expect((await svc().qr.current()).payment).toBeNull();
      const { payment } = await payingWithQr();
      expect((await svc().qr.current()).payment).toEqual(payment);
      await svc().qr.cancel(payment.paymentId);
      expect((await svc().qr.current()).payment).toBeNull();
    });
  });

  describe('cancel and expiry', () => {
    it('drops a pending QR and keeps the cart waiting, so cash can finish the sale', async () => {
      const { total, payment } = await payingWithQr();
      expect((await svc().qr.cancel(payment.paymentId)).payment.status).toBe('CANCELLED');
      expect((await svc().qr.cancel(payment.paymentId)).payment.status).toBe('CANCELLED');
      expect((await state.base.posCheckout.findFirstOrThrow({ where: { companyId: state.companyId } })).status).toBe('PAYING');

      const { sale } = await svc().payment.complete({
        payments: [{ method: 'CASH', received: '500,00' }],
        expectedTotal: total,
        idempotencyKey: key(),
      });
      expect(sale).toMatchObject({ total: '490.00', received: '500.00', change: '10.00' });
    });

    it('cannot cancel a confirmed QR: the customer already paid', async () => {
      const { payment } = await payingWithQr();
      await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' });
      expect(await codeOf(svc().qr.cancel(payment.paymentId))).toBe('PAYMENT_INVALID_STATE');
    });

    it('cancels the pending QR when the cashier goes back to the cart', async () => {
      const { payment } = await payingWithQr();
      await svc().payment.back();
      const row = await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } });
      expect(row.status).toBe('CANCELLED');
      expect((await state.base.posCheckout.findFirstOrThrow({ where: { companyId: state.companyId } })).status).toBe('OPEN');
    });

    it('refuses to go back to the cart while a QR is confirmed', async () => {
      const { payment } = await payingWithQr();
      await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' });
      expect(await codeOf(svc().payment.back())).toBe('PAYMENT_ALREADY_CONFIRMED');
      expect((await state.base.posCheckout.findFirstOrThrow({ where: { companyId: state.companyId } })).status).toBe('PAYING');
    });

    it('cancels a QR past its deadline when asked, so a late payment is never taken by surprise', async () => {
      const { payment } = await payingWithQr();
      await expireNow(payment.paymentId);
      expect((await svc().qr.get(payment.paymentId)).payment.status).toBe('CANCELLED');
      expect(
        await state.base.auditLog.count({ where: { companyId: state.companyId, action: 'sales.payment.qr-expire' } }),
      ).toBe(1);
    });

    it('refuses to confirm an expired QR and leaves it cancelled', async () => {
      const { payment } = await payingWithQr();
      await expireNow(payment.paymentId);
      expect(await codeOf(svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' }))).toBe('QR_EXPIRED');
      const row = await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } });
      expect(row.status).toBe('CANCELLED');
    });

    it('opens a new QR over an expired one', async () => {
      const { total, payment } = await payingWithQr();
      await expireNow(payment.paymentId);
      const next = await startQr(total);
      expect(next.payment.status).toBe('PENDING');
      expect((await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } })).status).toBe('CANCELLED');
    });
  });

  describe('complete with a QR', () => {
    it('writes the whole sale atomically and nothing to the cash register', async () => {
      const { p, total, payment } = await payingWithQr();
      await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' });

      const { sale } = await completeWithQr(payment.paymentId, payment.idempotencyKey, total);
      expect(sale).toMatchObject({ total: '490.00', received: '490.00', change: '0.00', customerName: 'S/N', invoiceStatus: 'PENDING' });

      const stored = await state.base.sale.findUniqueOrThrow({
        where: { id: sale.saleId },
        include: { payments: true, invoice: true, checkout: { include: { payments: true } } },
      });
      expect(stored.status).toBe('COMPLETED');
      expect(stored.payments).toHaveLength(1);
      expect(stored.payments[0]).toMatchObject({ method: 'QR', providerStatus: 'CONFIRMED' });
      expect(stored.payments[0].amount.toFixed(2)).toBe('490.00');
      expect(stored.payments[0].change.toFixed(2)).toBe('0.00');
      expect(stored.payments[0].reference).toBe(
        (await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } })).providerRef,
      );
      expect(stored.invoice).toMatchObject({ status: 'PENDING', customerTaxName: 'S/N' });
      expect(stored.checkout.status).toBe('COMPLETED');
      // the QR row is the only payment of the checkout: completing does not add a second one
      expect(stored.checkout.payments).toHaveLength(1);

      expect(await stockOf(p.id)).toBe(8);
      expect(await state.base.stockMovement.count({ where: { productId: p.id, type: 'SALE', refId: sale.saleId } })).toBe(1);
      // the money went to the provider: the register has nothing to count
      expect(await state.base.cashMovement.count({ where: { companyId: state.companyId } })).toBe(0);

      const audit = await state.base.auditLog.findFirstOrThrow({
        where: { companyId: state.companyId, action: 'sales.sale.complete' },
      });
      expect(audit.after).toMatchObject({ method: 'QR', total: '490.00', change: '0.00' });
      const event = await state.base.outboxEvent.findFirstOrThrow({ where: { companyId: state.companyId, type: 'sale.completed' } });
      expect(event.payload).toMatchObject({ saleId: sale.saleId, total: '490.00' });
    });

    it('returns the same sale on a retry with the same key, selling once', async () => {
      const { p, total, payment } = await payingWithQr();
      await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' });
      const first = await completeWithQr(payment.paymentId, payment.idempotencyKey, total);
      const again = await completeWithQr(payment.paymentId, payment.idempotencyKey, total);
      expect(again.sale.saleId).toBe(first.sale.saleId);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await stockOf(p.id)).toBe(8);
    });

    it('refuses a QR that is not confirmed, whatever the state', async () => {
      const { total, payment } = await payingWithQr();
      expect(await codeOf(completeWithQr(payment.paymentId, payment.idempotencyKey, total))).toBe('PAYMENT_NOT_CONFIRMED');
      await svc().qr.confirm(payment.paymentId, { outcome: 'DECLINED' });
      expect(await codeOf(completeWithQr(payment.paymentId, payment.idempotencyKey, total))).toBe('PAYMENT_NOT_CONFIRMED');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('refuses a cancelled QR', async () => {
      const { total, payment } = await payingWithQr();
      await svc().qr.cancel(payment.paymentId);
      expect(await codeOf(completeWithQr(payment.paymentId, payment.idempotencyKey, total))).toBe('PAYMENT_NOT_CONFIRMED');
    });

    it('refuses a payment that is not this cart’s, or does not exist', async () => {
      const { total, payment } = await payingWithQr();
      await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' });
      expect(await codeOf(completeWithQr(randomUUID(), payment.idempotencyKey, total))).toBe('PAYMENT_NOT_FOUND');
      // another cashier's cart cannot use my confirmed payment
      const p = await product(10);
      await pay([[p.id, 2]], state.second);
      // my key does not exist for them; with their own key my payment is not on their cart
      expect(await codeOf(completeWithQr(payment.paymentId, payment.idempotencyKey, total, state.second))).toBe('CHECKOUT_NOT_FOUND');
      expect(await codeOf(completeWithQr(payment.paymentId, key(), '490.00', state.second))).toBe('PAYMENT_NOT_FOUND');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('needs the key of the payment', async () => {
      const { total, payment } = await payingWithQr();
      await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' });
      expect(await codeOf(completeWithQr(payment.paymentId, key(), total))).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('refuses when the total moved after the QR was charged', async () => {
      const { p, payment } = await payingWithQr();
      await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' });
      await state.base.product.update({ where: { id: p.id }, data: { salePrice: '300.00' } });
      expect(await codeOf(completeWithQr(payment.paymentId, payment.idempotencyKey, '490.00'))).toBe('CHECKOUT_TOTAL_CHANGED');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('rolls everything back when the stock is gone, leaving the QR confirmed to try again', async () => {
      const { p, total, payment } = await payingWithQr();
      await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' });
      await state.base.stockLevel.update({
        where: { productId_warehouseId: { productId: p.id, warehouseId: state.centralId } },
        data: { quantity: 1 },
      });
      expect(await codeOf(completeWithQr(payment.paymentId, payment.idempotencyKey, total))).toBe('INSUFFICIENT_STOCK');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await stockOf(p.id)).toBe(1);
      expect((await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } })).status).toBe('CONFIRMED');
      expect((await state.base.posCheckout.findFirstOrThrow({ where: { companyId: state.companyId } })).status).toBe('PAYING');
    });

    it('still sells the last unit once when two carts pay it by QR', async () => {
      const p = await product(1);
      const settleCart = async (caller: Caller) => {
        const { total } = await pay([[p.id, 1]], caller);
        const { payment } = await startQr(total, caller);
        await svc(caller).qr.confirm(payment.paymentId, { outcome: 'APPROVED' });
        return () => completeWithQr(payment.paymentId, payment.idempotencyKey, total, caller);
      };
      const [first, second] = [await settleCart(state.cashier), await settleCart(state.second)];
      const results = await Promise.allSettled([first(), second()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect((failed?.reason as { getResponse: () => { code: string } }).getResponse().code).toBe('INSUFFICIENT_STOCK');
      expect(await stockOf(p.id)).toBe(0);
    });
  });

  describe('cash over a QR', () => {
    const cash = (total: string, idempotencyKey = key()) =>
      svc().payment.complete({ payments: [{ method: 'CASH', received: total }], expectedTotal: total, idempotencyKey });

    it('refuses to complete in cash a cart the customer already paid by QR', async () => {
      const { total, payment } = await payingWithQr();
      await svc().qr.confirm(payment.paymentId, { outcome: 'APPROVED' });
      expect(await codeOf(cash(total))).toBe('PAYMENT_ALREADY_CONFIRMED');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await state.base.cashMovement.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('drops a QR that still waits when the sale completes in cash, with audit', async () => {
      const { total, payment } = await payingWithQr();
      await cash(total);
      expect((await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } })).status).toBe('CANCELLED');
      expect(await state.base.auditLog.count({ where: { companyId: state.companyId, action: 'sales.payment.qr-cancel' } })).toBe(1);
    });

    it('lets cash complete with a new key after the QR was cancelled', async () => {
      const { total, payment } = await payingWithQr();
      await svc().qr.cancel(payment.paymentId);
      await expect(cash(total)).resolves.toMatchObject({ sale: { total } });
    });

    it('answers a late cancel of a QR that going back already dropped with that QR, not an error', async () => {
      const { payment } = await payingWithQr();
      await svc().payment.back();
      expect((await svc().qr.cancel(payment.paymentId)).payment.status).toBe('CANCELLED');
    });
  });

  describe('database guards', () => {
    it('refuses a QR row without its reference, payload and deadline, and a cash row with a payload', async () => {
      const p = await product(10);
      await pay([[p.id, 1]]);
      const cart = await state.base.posCheckout.findFirstOrThrow({ where: { companyId: state.companyId } });
      const base = { companyId: state.companyId, checkoutId: cart.id, amount: '245.00' };
      await expect(
        state.base.posCheckoutPayment.create({ data: { ...base, method: 'QR', idempotencyKey: key() } }),
      ).rejects.toThrow();
      await expect(
        state.base.posCheckoutPayment.create({ data: { ...base, method: 'CASH', idempotencyKey: key(), qrPayload: 'x' } }),
      ).rejects.toThrow();
    });
  });

  describe('complete validation', () => {
    it('asks for the amount received in cash and the payment id for a QR', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const bare = (method: 'CASH' | 'QR') =>
        svc().payment.complete({ payments: [{ method }], expectedTotal: total, idempotencyKey: key() });
      expect(await codeOf(bare('CASH'))).toBe('VALIDATION_FAILED');
      expect(await codeOf(bare('QR'))).toBe('VALIDATION_FAILED');
    });

    it('still refuses the methods that have no story yet', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const card = svc().payment.complete({ payments: [{ method: 'CARD' }], expectedTotal: total, idempotencyKey: key() });
      expect(await codeOf(card)).toBe('PAYMENT_METHOD_NOT_AVAILABLE');
    });
  });
});
