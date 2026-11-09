/**
 * Integration test of paying by card (HU-VEN-10) against the real Postgres: a card attempt opens for the frozen total, the
 * cashier reports the terminal's outcome (approved with the voucher's code, or declined with a reason), a decline is final and
 * the cashier retries with a new attempt, and only a CONFIRMED card completes the sale, which writes everything atomically but
 * no cash movement. A card is the only payment of its sale and never lives next to a QR.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, type Caller } from './pos.int-fixture';

const fx = createPosFixture('poscard');
const { state } = fx;

const key = () => randomUUID();

describe('POS card payment (integration, real Postgres)', () => {
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
      where: { companyId: state.companyId, key: { in: ['sales.roundingMode', 'sales.cardPaymentEnabled'] } },
    });
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);
  const product = (stock: number, price = '245.00') => fx.newProduct({ price, stock: { [state.centralId]: stock } });

  async function pay(lines: [string, number][], caller: Caller = state.cashier) {
    for (const [productId, quantity] of lines) await svc(caller).checkout.addItem({ productId, quantity });
    return svc(caller).payment.pay();
  }

  const startCard = (expectedTotal: string, caller: Caller = state.cashier, idempotencyKey: string = key()) =>
    svc(caller).card.start({ idempotencyKey, expectedTotal });

  /** A cart with one product, paying, and its card attempt opened. */
  async function payingWithCard(price = '245.00', quantity = 2) {
    const p = await product(10, price);
    const { total } = await pay([[p.id, quantity]]);
    const { payment } = await startCard(total);
    return { p, total, payment };
  }

  const approve = (id: string, authorizationCode = 'A1B2C3', caller: Caller = state.cashier) =>
    svc(caller).card.confirm(id, { outcome: 'APPROVED', authorizationCode });
  const decline = (id: string, reason: 'INSUFFICIENT_FUNDS' | 'CARD_DECLINED' | 'TERMINAL_ERROR' | 'OTHER' = 'INSUFFICIENT_FUNDS') =>
    svc().card.confirm(id, { outcome: 'DECLINED', reason });

  const completeWithCard = (paymentId: string, idempotencyKey: string, expectedTotal: string) =>
    svc().payment.complete({ payments: [{ method: 'CARD', paymentId }], expectedTotal, idempotencyKey });

  const stockOf = async (productId: string) =>
    (
      await state.base.stockLevel.findUniqueOrThrow({
        where: { productId_warehouseId: { productId, warehouseId: state.centralId } },
      })
    ).quantity;

  const cartStatus = async () =>
    (await state.base.posCheckout.findFirstOrThrow({ where: { companyId: state.companyId } })).status;

  describe('pay', () => {
    it('tells the screen whether card is on', async () => {
      const p = await product(10);
      expect((await pay([[p.id, 1]])).cardEnabled).toBe(true);
      await svc().payment.back();
      await state.base.companySetting.create({
        data: { companyId: state.companyId, key: 'sales.cardPaymentEnabled', value: false },
      });
      expect((await svc().payment.pay()).cardEnabled).toBe(false);
    });
  });

  describe('start', () => {
    it('opens a pending card attempt for the frozen total, audited', async () => {
      const { total, payment } = await payingWithCard();
      expect(total).toBe('490.00');
      expect(payment).toMatchObject({ amount: '490.00', status: 'PENDING', attempt: 1, authorizationCode: null, declineReason: null });

      const row = await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } });
      expect(row).toMatchObject({ method: 'CARD', status: 'PENDING', idempotencyKey: payment.idempotencyKey, qrPayload: null, expiresAt: null });
      expect(row.providerRef).toBeTruthy();
      const audit = await state.base.auditLog.findFirstOrThrow({ where: { companyId: state.companyId, action: 'sales.payment.card-start' } });
      expect(audit).toMatchObject({ entity: 'PosCheckoutPayment', entityId: payment.paymentId, userId: state.cashier.userId });
    });

    it('uses the rounded total of the sale', async () => {
      await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'sales.roundingMode', value: 'INTEGER' } });
      const p = await product(10, '245.50');
      const { total } = await pay([[p.id, 3]]);
      expect(total).toBe('737.00');
      expect((await startCard(total)).payment.amount).toBe('737.00');
    });

    it('answers a repeat with the same key by the same payment, once', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const k = key();
      const first = await startCard(total, state.cashier, k);
      const second = await startCard(total, state.cashier, k);
      expect(second.payment).toEqual(first.payment);
      expect(await state.base.posCheckoutPayment.count({ where: { companyId: state.companyId, method: 'CARD' } })).toBe(1);
    });

    it('lets one of two concurrent starts win; the other gets PAYMENT_ALREADY_PENDING', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const results = await Promise.allSettled([startCard(total), startCard(total)]);
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect((failed[0].reason as { getResponse: () => { code: string } }).getResponse().code).toBe('PAYMENT_ALREADY_PENDING');
      expect(await state.base.posCheckoutPayment.count({ where: { companyId: state.companyId, method: 'CARD', status: 'PENDING' } })).toBe(1);
    });

    it('refuses a second card while one waits or is approved', async () => {
      const { total, payment } = await payingWithCard();
      expect(await codeOf(startCard(total))).toBe('PAYMENT_ALREADY_PENDING');
      await approve(payment.paymentId);
      expect(await codeOf(startCard(total))).toBe('PAYMENT_ALREADY_CONFIRMED');
    });

    it('refuses a QR while a card waits, and a card while a QR waits', async () => {
      const { total, payment } = await payingWithCard();
      expect(await codeOf(svc().qr.start({ idempotencyKey: key(), expectedTotal: total }))).toBe('PAYMENT_ALREADY_PENDING');

      const p = await product(10);
      // a waiting card is dropped on purpose, never by going back
      await svc().card.cancel(payment.paymentId);
      await svc().payment.back();
      await svc().checkout.addItem({ productId: p.id, quantity: 1 });
      const second = await svc().payment.pay();
      await svc().qr.start({ idempotencyKey: key(), expectedTotal: second.total });
      expect(await codeOf(startCard(second.total))).toBe('PAYMENT_ALREADY_PENDING');
    });

    it('is not blocked by a QR that is already past its deadline', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const { payment } = await svc().qr.start({ idempotencyKey: key(), expectedTotal: total });
      await state.base.posCheckoutPayment.update({ where: { id: payment.paymentId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect((await startCard(total)).payment.status).toBe('PENDING');
    });

    it('refuses a total that is not the one the cashier saw', async () => {
      const p = await product(10);
      await pay([[p.id, 1]]);
      expect(await codeOf(startCard('999.00'))).toBe('CHECKOUT_TOTAL_CHANGED');
      expect(await state.base.posCheckoutPayment.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('needs a cart waiting for payment and an open shift', async () => {
      const p = await product(10);
      expect(await codeOf(startCard('245.00'))).toBe('CHECKOUT_NOT_FOUND');
      await svc().checkout.addItem({ productId: p.id, quantity: 1 });
      expect(await codeOf(startCard('245.00'))).toBe('CHECKOUT_NOT_PAYING');
      expect(await codeOf(startCard('245.00', state.noShift))).toBe('CASH_SHIFT_NOT_OPEN');
    });

    it('is refused when the company turned card off', async () => {
      await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'sales.cardPaymentEnabled', value: false } });
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      expect(await codeOf(startCard(total))).toBe('PAYMENT_METHOD_NOT_AVAILABLE');
    });

    it('refuses a key that already belongs to another cashier’s payment', async () => {
      const first = await payingWithCard();
      const p = await product(10);
      const { total } = await pay([[p.id, 1]], state.second);
      expect(await codeOf(startCard(total, state.second, first.payment.idempotencyKey))).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('outcome', () => {
    it('approves with the authorization code, normalized and audited, and a repeat changes nothing', async () => {
      const { payment } = await payingWithCard();
      const done = await approve(payment.paymentId, ' a1b2c3 ');
      expect(done.payment).toMatchObject({ status: 'CONFIRMED', authorizationCode: 'A1B2C3', declineReason: null });
      expect((await approve(payment.paymentId, 'A1B2C3')).payment.status).toBe('CONFIRMED');
      expect(await state.base.auditLog.count({ where: { companyId: state.companyId, action: 'sales.payment.card-confirm' } })).toBe(1);
      expect((await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } })).reference).toBe('A1B2C3');
    });

    it('treats a repeat with another code or reason as a conflict, not a repeat', async () => {
      const { payment } = await payingWithCard();
      await approve(payment.paymentId, 'A1B2C3');
      expect(await codeOf(approve(payment.paymentId, 'ZZZZ99'))).toBe('PAYMENT_INVALID_STATE');
      expect((await svc().card.get(payment.paymentId)).payment.authorizationCode).toBe('A1B2C3');
    });

    it('does not resume an old decline once a QR waits or was paid on the same cart', async () => {
      const { total, payment } = await payingWithCard();
      await decline(payment.paymentId);
      expect((await svc().card.current()).payment).toMatchObject({ status: 'DECLINED' });
      await svc().qr.start({ idempotencyKey: key(), expectedTotal: total });
      expect((await svc().card.current()).payment).toBeNull();
    });

    it('refuses an approval without a valid authorization code', async () => {
      const { payment } = await payingWithCard();
      expect(await codeOf(approve(payment.paymentId, 'AB'))).toBe('INVALID_AUTHORIZATION_CODE');
      expect(await codeOf(approve(payment.paymentId, 'AB-12!'))).toBe('INVALID_AUTHORIZATION_CODE');
      expect((await svc().card.get(payment.paymentId)).payment.status).toBe('PENDING');
    });

    it('records a decline with its reason, final, and shows it', async () => {
      const { payment } = await payingWithCard();
      const done = await decline(payment.paymentId, 'CARD_DECLINED');
      expect(done.payment).toMatchObject({ status: 'DECLINED', declineReason: 'CARD_DECLINED', authorizationCode: null, attempt: 1 });
      expect((await svc().card.get(payment.paymentId)).payment).toEqual(done.payment);
      expect(await codeOf(approve(payment.paymentId))).toBe('PAYMENT_INVALID_STATE');
      expect(await codeOf(svc().card.cancel(payment.paymentId))).toBe('PAYMENT_INVALID_STATE');
      const audit = await state.base.auditLog.findFirstOrThrow({ where: { companyId: state.companyId, action: 'sales.payment.card-confirm' } });
      expect(audit.after).toMatchObject({ status: 'DECLINED', outcome: 'DECLINED', reason: 'CARD_DECLINED' });
    });

    it('lets the cashier retry after a decline with a new attempt, counted', async () => {
      const { total, payment } = await payingWithCard();
      await decline(payment.paymentId);
      const retry = await startCard(total);
      expect(retry.payment).toMatchObject({ status: 'PENDING', attempt: 2 });
      expect(retry.payment.paymentId).not.toBe(payment.paymentId);
      // the first attempt stays declined, as history
      expect((await svc().card.get(payment.paymentId)).payment.status).toBe('DECLINED');
    });

    it('does not show my payment to another cashier or another company, nor let them settle it', async () => {
      const { payment } = await payingWithCard();
      expect(await codeOf(svc(state.second).card.get(payment.paymentId))).toBe('PAYMENT_NOT_FOUND');
      expect(await codeOf(approve(payment.paymentId, 'A1B2C3', state.second))).toBe('PAYMENT_NOT_FOUND');
      expect(await codeOf(svc(state.second).card.cancel(payment.paymentId))).toBe('PAYMENT_NOT_FOUND');
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(state.other).card.get(payment.paymentId))).toBe('PAYMENT_NOT_FOUND');
    });

    it('still settles a payment the provider forgot (restart): the database row is the truth', async () => {
      const { payment } = await payingWithCard();
      (fx.mock as unknown as { payments: Map<string, unknown> }).payments.clear();
      expect((await approve(payment.paymentId)).payment.status).toBe('CONFIRMED');
    });

    it('resumes the attempt the cart waits for, and nothing once it was dropped', async () => {
      expect((await svc().card.current()).payment).toBeNull();
      const { total, payment } = await payingWithCard();
      expect((await svc().card.current()).payment).toEqual(payment);
      const declined = await decline(payment.paymentId);
      expect((await svc().card.current()).payment).toEqual(declined.payment);
      const retry = await startCard(total);
      expect((await svc().card.current()).payment).toEqual(retry.payment);
      await svc().card.cancel(retry.payment.paymentId);
      expect((await svc().card.current()).payment).toEqual(declined.payment);
    });
  });

  describe('back to the cart and changing method', () => {
    it('goes back after a decline: the cart is OPEN again and stock is untouched', async () => {
      const { p, payment } = await payingWithCard();
      await decline(payment.paymentId);
      await svc().payment.back();
      expect(await cartStatus()).toBe('OPEN');
      expect(await stockOf(p.id)).toBe(10);
    });

    it('never drops a card that waits for the terminal on its own: going back is refused', async () => {
      const { payment } = await payingWithCard();
      expect(await codeOf(svc().payment.back())).toBe('CARD_AWAITING_OUTCOME');
      expect((await svc().card.get(payment.paymentId)).payment.status).toBe('PENDING');
      expect(await cartStatus()).toBe('PAYING');
    });

    it('goes back once the cashier cancelled the waiting card on purpose', async () => {
      const { payment } = await payingWithCard();
      await svc().card.cancel(payment.paymentId);
      await svc().payment.back();
      expect((await state.base.posCheckoutPayment.findUniqueOrThrow({ where: { id: payment.paymentId } })).status).toBe('CANCELLED');
      expect(await cartStatus()).toBe('OPEN');
    });

    it('refuses to take cash while the terminal still waits: it may have charged the customer', async () => {
      const { total, payment } = await payingWithCard();
      expect(
        await codeOf(svc().payment.complete({ payments: [{ method: 'CASH', received: '500,00' }], expectedTotal: total, idempotencyKey: key() })),
      ).toBe('CARD_AWAITING_OUTCOME');
      expect((await svc().card.get(payment.paymentId)).payment.status).toBe('PENDING');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await stockOf((await state.base.posCheckoutItem.findFirstOrThrow({ where: { companyId: state.companyId } })).productId)).toBe(10);
    });

    it('refuses to go back while the card is approved', async () => {
      const { payment } = await payingWithCard();
      await approve(payment.paymentId);
      expect(await codeOf(svc().payment.back())).toBe('PAYMENT_ALREADY_CONFIRMED');
      expect(await cartStatus()).toBe('PAYING');
    });

    it('drops a pending card so cash can finish the sale', async () => {
      const { total, payment } = await payingWithCard();
      expect((await svc().card.cancel(payment.paymentId)).payment.status).toBe('CANCELLED');
      const { sale } = await svc().payment.complete({ payments: [{ method: 'CASH', received: '500,00' }], expectedTotal: total, idempotencyKey: key() });
      expect(sale).toMatchObject({ total: '490.00', received: '500.00', change: '10.00' });
    });

    it('cannot cancel an approved card: the customer already paid', async () => {
      const { payment } = await payingWithCard();
      await approve(payment.paymentId);
      expect(await codeOf(svc().card.cancel(payment.paymentId))).toBe('PAYMENT_INVALID_STATE');
    });
  });

  describe('complete with a card', () => {
    it('writes the whole sale atomically, with the authorization code and nothing to the cash register', async () => {
      const { p, total, payment } = await payingWithCard();
      await approve(payment.paymentId);

      const { sale } = await completeWithCard(payment.paymentId, payment.idempotencyKey, total);
      expect(sale).toMatchObject({ total: '490.00', received: '490.00', change: '0.00', invoiceStatus: 'PENDING' });

      const stored = await state.base.sale.findUniqueOrThrow({
        where: { id: sale.saleId },
        include: { payments: true, invoice: true, checkout: { include: { payments: true } } },
      });
      expect(stored.status).toBe('COMPLETED');
      expect(stored.payments).toHaveLength(1);
      expect(stored.payments[0]).toMatchObject({ method: 'CARD', providerStatus: 'CONFIRMED', reference: 'A1B2C3' });
      expect(stored.payments[0].amount.toFixed(2)).toBe('490.00');
      expect(stored.checkout?.status).toBe('COMPLETED');
      expect(stored.checkout?.payments).toHaveLength(1);

      expect(await stockOf(p.id)).toBe(8);
      expect(await state.base.stockMovement.count({ where: { productId: p.id, type: 'SALE', refId: sale.saleId } })).toBe(1);
      expect(await state.base.cashMovement.count({ where: { companyId: state.companyId } })).toBe(0);

      const audit = await state.base.auditLog.findFirstOrThrow({ where: { companyId: state.companyId, action: 'sales.sale.complete' } });
      expect(audit.after).toMatchObject({ method: 'CARD', total: '490.00', payments: [{ method: 'CARD', amount: '490.00' }] });
      expect(await state.base.outboxEvent.count({ where: { companyId: state.companyId, type: 'sale.completed' } })).toBe(1);
    });

    it('completes with the approved retry after a decline: one sale, one card payment', async () => {
      const { p, total, payment } = await payingWithCard();
      await decline(payment.paymentId, 'INSUFFICIENT_FUNDS');
      const retry = await startCard(total);
      await approve(retry.payment.paymentId, 'Z9Y8X7');
      const { sale } = await completeWithCard(retry.payment.paymentId, retry.payment.idempotencyKey, total);

      const stored = await state.base.sale.findUniqueOrThrow({ where: { id: sale.saleId }, include: { payments: true } });
      expect(stored.payments).toHaveLength(1);
      expect(stored.payments[0].reference).toBe('Z9Y8X7');
      expect(await stockOf(p.id)).toBe(8);
    });

    it('returns the same sale on a retry with the same key, selling once', async () => {
      const { p, total, payment } = await payingWithCard();
      await approve(payment.paymentId);
      const first = await completeWithCard(payment.paymentId, payment.idempotencyKey, total);
      const again = await completeWithCard(payment.paymentId, payment.idempotencyKey, total);
      expect(again.sale.saleId).toBe(first.sale.saleId);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await stockOf(p.id)).toBe(8);
    });

    it('lets one of two concurrent completes win', async () => {
      const { p, total, payment } = await payingWithCard();
      await approve(payment.paymentId);
      const results = await Promise.allSettled([
        completeWithCard(payment.paymentId, payment.idempotencyKey, total),
        completeWithCard(payment.paymentId, payment.idempotencyKey, total),
      ]);
      const ids = results.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<{ sale: { saleId: string } }>).value.sale.saleId);
      expect(new Set(ids).size).toBe(1);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await stockOf(p.id)).toBe(8);
    });

    it('refuses a card that is pending or declined', async () => {
      const { total, payment } = await payingWithCard();
      expect(await codeOf(completeWithCard(payment.paymentId, payment.idempotencyKey, total))).toBe('PAYMENT_NOT_CONFIRMED');
      await decline(payment.paymentId);
      expect(await codeOf(completeWithCard(payment.paymentId, payment.idempotencyKey, total))).toBe('PAYMENT_NOT_CONFIRMED');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('refuses a card mixed with another line', async () => {
      const { total, payment } = await payingWithCard();
      await approve(payment.paymentId);
      expect(
        await codeOf(
          svc().payment.complete({
            payments: [{ method: 'CARD', paymentId: payment.paymentId }, { method: 'CASH', received: '100,00' }],
            expectedTotal: total,
            idempotencyKey: payment.idempotencyKey,
          }),
        ),
      ).toBe('PAYMENT_METHOD_NOT_AVAILABLE');
    });

    it('refuses cash or QR while the card is approved: the customer already paid', async () => {
      const { total, payment } = await payingWithCard();
      await approve(payment.paymentId);
      expect(
        await codeOf(svc().payment.complete({ payments: [{ method: 'CASH', received: '500,00' }], expectedTotal: total, idempotencyKey: key() })),
      ).toBe('PAYMENT_ALREADY_CONFIRMED');
      expect(
        await codeOf(svc().payment.complete({ payments: [{ method: 'QR', paymentId: payment.paymentId }], expectedTotal: total, idempotencyKey: payment.idempotencyKey })),
      ).toBe('PAYMENT_ALREADY_CONFIRMED');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('refuses a payment of another checkout and a key that is not the sale’s', async () => {
      const first = await payingWithCard();
      await approve(first.payment.paymentId);
      const p = await product(10);
      const { total } = await pay([[p.id, 1]], state.second);
      expect(await codeOf(svc(state.second).payment.complete({ payments: [{ method: 'CARD', paymentId: first.payment.paymentId }], expectedTotal: total, idempotencyKey: key() }))).toBe('PAYMENT_NOT_FOUND');
      expect(await codeOf(completeWithCard(first.payment.paymentId, key(), first.total))).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('still completes an approved card when the company turned card off meanwhile: the customer already paid', async () => {
      const { total, payment } = await payingWithCard();
      await approve(payment.paymentId);
      await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'sales.cardPaymentEnabled', value: false } });
      const { sale } = await completeWithCard(payment.paymentId, payment.idempotencyKey, total);
      expect(sale.total).toBe('490.00');
    });

    it('leaves stock and payments untouched when the sale cannot be written', async () => {
      const { p, total, payment } = await payingWithCard();
      await approve(payment.paymentId);
      // someone else took the stock after the payment: the sale rolls back as a whole
      await state.base.stockLevel.update({
        where: { productId_warehouseId: { productId: p.id, warehouseId: state.centralId } },
        data: { quantity: 1 },
      });
      expect(await codeOf(completeWithCard(payment.paymentId, payment.idempotencyKey, total))).toBe('INSUFFICIENT_STOCK');
      expect(await stockOf(p.id)).toBe(1);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await cartStatus()).toBe('PAYING');
      expect((await svc().card.get(payment.paymentId)).payment.status).toBe('CONFIRMED');
    });
  });

  describe('database guards', () => {
    it('rejects a confirmed card without an authorization code', async () => {
      const { payment } = await payingWithCard();
      await expect(
        state.base.posCheckoutPayment.update({ where: { id: payment.paymentId }, data: { status: 'CONFIRMED' } }),
      ).rejects.toThrow();
    });

    it('rejects a decline reason on a payment that is not a declined card', async () => {
      const { payment } = await payingWithCard();
      await expect(
        state.base.posCheckoutPayment.update({ where: { id: payment.paymentId }, data: { declineReason: 'OTHER' } }),
      ).rejects.toThrow();
    });
  });
});
