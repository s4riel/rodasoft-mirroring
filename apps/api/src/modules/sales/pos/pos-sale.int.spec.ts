/**
 * Integration test of paying and completing a sale (HU-VEN-07 and HU-VEN-11) against the real Postgres: the whole sale is
 * written atomically (sale, lines, payment, stock, cash movement, invoice record, audit, outbox), the last unit sells once
 * under concurrency, a retry with the same key returns the same sale, a failure rolls everything back, and the receipt
 * never carries costs.
 */
import { IdentityDocumentType, parseSalesDocumentNumber } from '@rodasoft/domain';
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, detailsOf, type Caller } from './pos.int-fixture';

const fx = createPosFixture('possale');
const { state } = fx;

const key = () => randomUUID();

describe('POS payment and sale completion (integration, real Postgres)', () => {
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
    await state.base.customer.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
    await state.base.companySetting.deleteMany({
      where: { companyId: state.companyId, key: 'sales.roundingMode' },
    });
    await fx.setAllowNegativeStock(false);
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);

  /** A product with its own stock, so a test never depends on another test's sales. */
  const product = (stock: number, price = '245.00') =>
    fx.newProduct({ price, stock: { [state.centralId]: stock } });

  /** Fills the cart and sends it to payment. */
  async function pay(lines: [string, number][], caller: Caller = state.cashier) {
    for (const [productId, quantity] of lines) await svc(caller).checkout.addItem({ productId, quantity });
    return svc(caller).payment.pay();
  }

  const complete = (
    received: string,
    expectedTotal: string,
    caller: Caller = state.cashier,
    idempotencyKey = key(),
  ) =>
    svc(caller).payment.complete({ payments: [{ method: 'CASH', received }], expectedTotal, idempotencyKey });

  const stockOf = async (productId: string) =>
    (
      await state.base.stockLevel.findUniqueOrThrow({
        where: { productId_warehouseId: { productId, warehouseId: state.centralId } },
      })
    ).quantity;

  const setRounding = (value: string) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key: 'sales.roundingMode' } },
      create: { companyId: state.companyId, key: 'sales.roundingMode', value },
      update: { value },
    });

  describe('pay (VP-04)', () => {
    it('moves the cart to PAYING and answers the total with the quick amounts', async () => {
      const p = await product(10);
      const response = await pay([[p.id, 2]]);
      expect(response).toEqual({ total: '490.00', suggestedAmounts: ['500.00'] });
      const stored = await state.base.posCheckout.findFirstOrThrow({ where: { companyId: state.companyId } });
      expect(stored.status).toBe('PAYING');
      const audit = await state.base.auditLog.findFirstOrThrow({
        where: { companyId: state.companyId, action: 'sales.checkout.pay' },
      });
      expect(audit.entity).toBe('PosCheckout');
    });

    it('the cart is still the cashier’s while it is PAYING, and it cannot be edited', async () => {
      const p = await product(10);
      await pay([[p.id, 1]]);
      const { checkout } = await svc().checkout.current();
      expect(checkout?.status).toBe('PAYING');
      expect(await codeOf(svc().checkout.addItem({ productId: p.id, quantity: 1 }))).toBe(
        'CHECKOUT_NOT_EDITABLE',
      );
      expect(await codeOf(svc().checkout.updateItem(checkout!.lines[0].id, { quantity: 3 }))).toBe(
        'CHECKOUT_NOT_EDITABLE',
      );
    });

    it('refuses a cart without products', async () => {
      await svc().checkout.setCustomer(null); // creates an empty cart
      expect(await codeOf(svc().payment.pay())).toBe('CHECKOUT_EMPTY');
    });

    it('has no cart to pay before the first add', async () => {
      expect(await codeOf(svc().payment.pay())).toBe('CHECKOUT_NOT_FOUND');
    });

    it('detects a changed price: updates the line, stays OPEN and names the lines', async () => {
      const p = await product(10, '245.00');
      await svc().checkout.addItem({ productId: p.id, quantity: 2 });
      await state.base.product.update({ where: { id: p.id }, data: { salePrice: '250.00' } });

      expect(await codeOf(svc().payment.pay())).toBe('CHECKOUT_PRICES_CHANGED');
      const { checkout } = await svc().checkout.current();
      expect(checkout?.status).toBe('OPEN');
      expect(checkout?.lines[0].unitPrice).toBe('250.00');
      // the cashier has now seen the new price: the second try passes the check
      expect((await svc().payment.pay()).total).toBe('500.00');
    });

    it('lists what changed in the error details', async () => {
      const p = await product(10, '245.00');
      await svc().checkout.addItem({ productId: p.id, quantity: 1 });
      await state.base.product.update({ where: { id: p.id }, data: { salePrice: '260.00' } });
      expect(await detailsOf(svc().payment.pay())).toEqual({
        lines: [expect.objectContaining({ oldPrice: '245.00', newPrice: '260.00' })],
      });
      expect((await svc().checkout.current()).checkout?.status).toBe('OPEN');
    });

    it('two concurrent pay calls give one transition and one INVALID_TRANSITION', async () => {
      const p = await product(10);
      await svc().checkout.addItem({ productId: p.id, quantity: 1 });
      const results = await Promise.all([codeOf(svc().payment.pay()), codeOf(svc().payment.pay())]);
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.filter((r) => r === 'INVALID_TRANSITION')).toHaveLength(1);
    });

    it('the discount of the customer and the rounding are in the total', async () => {
      await setRounding('INTEGER');
      const customer = await state.base.customer.create({
        data: {
          companyId: state.companyId,
          name: 'Taller Pérez',
          documentType: IdentityDocumentType.NIT,
          documentNumber: '1020304050',
          discountType: 'PERCENT',
          discountValue: '10',
        },
      });
      const p = await product(10, '245.50');
      await svc().checkout.setCustomer(customer.id);
      // 245.50 × 3 = 736.50, 10 % off = 662.85, rounded to the integer = 663.00
      const response = await pay([[p.id, 3]]);
      expect(response.total).toBe('663.00');
    });
  });

  describe('back', () => {
    it('returns the cart to OPEN so it can be edited again', async () => {
      const p = await product(10);
      await pay([[p.id, 1]]);
      const { checkout } = await svc().payment.back();
      expect(checkout?.status).toBe('OPEN');
      await expect(svc().checkout.addItem({ productId: p.id, quantity: 1 })).resolves.toBeDefined();
      expect(
        await state.base.auditLog.count({
          where: { companyId: state.companyId, action: 'sales.checkout.back' },
        }),
      ).toBe(1);
    });

    it('refuses a cart that is not waiting for payment', async () => {
      const p = await product(10);
      await svc().checkout.addItem({ productId: p.id, quantity: 1 });
      expect(await codeOf(svc().payment.back())).toBe('CHECKOUT_NOT_PAYING');
    });

    it('can pay again after going back', async () => {
      const p = await product(10);
      await pay([[p.id, 1]]);
      await svc().payment.back();
      await expect(svc().payment.pay()).resolves.toMatchObject({ total: '245.00' });
    });
  });

  describe('complete (VP-16a)', () => {
    it('writes the whole sale atomically: sale, lines, payment, stock, cash, invoice, audit and outbox', async () => {
      const a = await product(10, '245.00');
      const b = await product(5, '361.00');
      const { total } = await pay([
        [a.id, 2],
        [b.id, 1],
      ]);
      expect(total).toBe('851.00');

      const { sale } = await complete('1.000,00', total);
      expect(sale).toMatchObject({
        total: '851.00',
        received: '1000.00',
        change: '149.00',
        customerName: 'S/N',
        invoiceStatus: 'PENDING',
      });
      expect(sale.number).toMatch(/^V-\d{6}$/);

      const stored = await state.base.sale.findUniqueOrThrow({
        where: { id: sale.saleId },
        include: { items: { orderBy: { sortOrder: 'asc' } }, payments: true, invoice: true, checkout: true },
      });
      expect(stored).toMatchObject({
        status: 'COMPLETED',
        number: sale.number,
        createdById: state.cashier.userId,
        branchId: state.branchId,
        warehouseId: state.centralId,
      });
      expect(stored.total.toFixed(2)).toBe('851.00');
      expect(stored.subtotal.toFixed(2)).toBe('851.00');
      expect(
        stored.items.map((i) => [i.productId, i.quantity, i.unitPrice.toFixed(2), i.lineTotal.toFixed(2)]),
      ).toEqual([
        [a.id, 2, '245.00', '490.00'],
        [b.id, 1, '361.00', '361.00'],
      ]);
      expect(stored.payments).toHaveLength(1);
      expect(stored.payments[0]).toMatchObject({ method: 'CASH' });
      expect(stored.payments[0].amount.toFixed(2)).toBe('851.00');
      expect(stored.payments[0].change.toFixed(2)).toBe('149.00');
      expect(stored.checkout.status).toBe('COMPLETED');
      expect(stored.invoice).toMatchObject({
        status: 'PENDING',
        customerTaxName: 'S/N',
        customerDocumentNumber: '0',
        customerDocumentType: IdentityDocumentType.NIT,
      });
      expect(stored.invoice?.total.toFixed(2)).toBe('851.00');

      // stock: a negative SALE movement per product, with the sale as its origin
      expect(await stockOf(a.id)).toBe(8);
      expect(await stockOf(b.id)).toBe(4);
      const movement = await state.base.stockMovement.findFirstOrThrow({
        where: { productId: a.id, type: 'SALE' },
      });
      expect(movement).toMatchObject({
        quantity: -2,
        balanceAfter: 8,
        refType: 'SALE',
        refId: sale.saleId,
        refNumber: sale.number,
        warehouseId: state.centralId,
      });

      // the register keeps the cash net of the change
      const cash = await state.base.cashMovement.findFirstOrThrow({
        where: { companyId: state.companyId, refId: sale.saleId },
      });
      expect(cash).toMatchObject({ type: 'SALE_PAYMENT', refType: 'SALE', userId: state.cashier.userId });
      expect(cash.amount.toFixed(2)).toBe('851.00');

      const checkoutPayment = await state.base.posCheckoutPayment.findFirstOrThrow({
        where: { checkoutId: stored.checkoutId },
      });
      expect(checkoutPayment).toMatchObject({ method: 'CASH', status: 'CONFIRMED' });
      expect(checkoutPayment.change.toFixed(2)).toBe('149.00');

      const audit = await state.base.auditLog.findFirstOrThrow({
        where: { companyId: state.companyId, action: 'sales.sale.complete' },
      });
      expect(audit).toMatchObject({ entity: 'Sale', entityId: sale.saleId, userId: state.cashier.userId });
      const event = await state.base.outboxEvent.findFirstOrThrow({
        where: { companyId: state.companyId, type: 'sale.completed' },
      });
      expect(event.payload).toMatchObject({ saleId: sale.saleId, number: sale.number, total: '851.00' });
    });

    it('copies the customer’s discount and tax data into the sale and the invoice record', async () => {
      const customer = await state.base.customer.create({
        data: {
          companyId: state.companyId,
          name: 'Taller Pérez',
          email: 'perez@example.com',
          documentType: IdentityDocumentType.NIT,
          documentNumber: '1020304050',
          discountType: 'AMOUNT',
          discountValue: '15.00',
        },
      });
      const p = await product(10, '100.00');
      await svc().checkout.setCustomer(customer.id);
      const { total } = await pay([[p.id, 2]]);
      expect(total).toBe('185.00');
      const { sale } = await complete('200', total);
      expect(sale).toMatchObject({
        customerName: 'Taller Pérez',
        customerEmail: 'perez@example.com',
        change: '15.00',
      });
      const stored = await state.base.sale.findUniqueOrThrow({
        where: { id: sale.saleId },
        include: { invoice: true },
      });
      expect(stored).toMatchObject({ customerId: customer.id, discountType: 'AMOUNT' });
      expect(stored.discountValue.toFixed(2)).toBe('15.00');
      expect(stored.discountAmount.toFixed(2)).toBe('15.00');
      expect(stored.invoice).toMatchObject({
        customerTaxName: 'Taller Pérez',
        customerDocumentNumber: '1020304050',
      });
      // a later change of the customer does not alter the sale
      await state.base.customer.update({
        where: { id: customer.id },
        data: { discountType: 'NONE', discountValue: '0' },
      });
      expect(
        (await state.base.sale.findUniqueOrThrow({ where: { id: sale.saleId } })).discountAmount.toFixed(2),
      ).toBe('15.00');
    });

    it('stores the rounding and takes the change from the rounded total', async () => {
      await setRounding('HALF_BOLIVIANO');
      const p = await product(10, '10.20');
      const { total } = await pay([[p.id, 1]]);
      expect(total).toBe('10.00');
      const { sale } = await complete('20', total);
      expect(sale.change).toBe('10.00');
      const stored = await state.base.sale.findUniqueOrThrow({ where: { id: sale.saleId } });
      expect(stored.roundingAmount.toFixed(2)).toBe('-0.20');
      expect(stored.total.toFixed(2)).toBe('10.00');
    });

    it('accepts the exact total with no change', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const { sale } = await complete('245,00', total);
      expect(sale.change).toBe('0.00');
    });

    it('refuses less than the total and leaves the cart waiting for payment', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      expect(await codeOf(complete('244,99', total))).toBe('INSUFFICIENT_CASH');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await stockOf(p.id)).toBe(10);
      expect((await svc().checkout.current()).checkout?.status).toBe('PAYING');
    });

    it.each(['', 'abc', '-5', '12,3,4', '245,123'])('refuses %j as an invalid amount', async (received) => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      expect(await codeOf(complete(received, total))).toBe('INVALID_AMOUNT');
    });

    it('refuses an amount the column cannot hold', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      expect(await codeOf(complete('99999999999999', total))).toBe('AMOUNT_TOO_LARGE');
    });

    it('only cash is available for now', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      expect(
        await codeOf(
          svc().payment.complete({
            payments: [{ method: 'QR', received: total }],
            expectedTotal: total,
            idempotencyKey: key(),
          }),
        ),
      ).toBe('PAYMENT_METHOD_NOT_AVAILABLE');
      expect(
        await codeOf(
          svc().payment.complete({
            payments: [
              { method: 'CASH', received: total },
              { method: 'CASH', received: total },
            ],
            expectedTotal: total,
            idempotencyKey: key(),
          }),
        ),
      ).toBe('PAYMENT_METHOD_NOT_AVAILABLE');
    });

    it('refuses a total that is not the one shown', async () => {
      const p = await product(10);
      await pay([[p.id, 1]]);
      expect(await codeOf(complete('500', '100.00'))).toBe('CHECKOUT_TOTAL_CHANGED');
    });

    it('refuses the sale when a price changed after pay, and pay shows the new total', async () => {
      const p = await product(10, '245.00');
      const { total } = await pay([[p.id, 1]]);
      await state.base.product.update({ where: { id: p.id }, data: { salePrice: '250.00' } });
      expect(await codeOf(complete('500', total))).toBe('CHECKOUT_TOTAL_CHANGED');
      expect(await stockOf(p.id)).toBe(10);
      await svc().payment.back();
      expect(await codeOf(svc().payment.pay())).toBe('CHECKOUT_PRICES_CHANGED');
      expect((await svc().payment.pay()).total).toBe('250.00');
    });

    it('refuses a cart that was never sent to pay, and a cashier without a cart', async () => {
      const p = await product(10);
      await svc().checkout.addItem({ productId: p.id, quantity: 1 });
      expect(await codeOf(complete('500', '245.00'))).toBe('CHECKOUT_NOT_PAYING');
      expect(await codeOf(complete('500', '245.00', state.second))).toBe('CHECKOUT_NOT_FOUND');
    });

    it('refuses an inactive product', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      await state.base.product.update({ where: { id: p.id }, data: { status: 'INACTIVE' } });
      expect(await codeOf(complete('500', total))).toBe('PRODUCT_INACTIVE');
      await state.base.product.update({ where: { id: p.id }, data: { status: 'ACTIVE' } });
    });

    it('refuses an invalid customer document before the sale', async () => {
      const customer = await state.base.customer.create({
        data: {
          companyId: state.companyId,
          name: 'Mal NIT',
          documentType: IdentityDocumentType.NIT,
          documentNumber: '12',
        },
      });
      const p = await product(10);
      await svc().checkout.setCustomer(customer.id);
      await svc().checkout.addItem({ productId: p.id, quantity: 1 });
      expect(await codeOf(svc().payment.pay())).toBe('INVALID_NIT');
    });

    it('needs an open cash shift', async () => {
      expect(await codeOf(complete('500', '245.00', state.noShift))).toBe('CASH_SHIFT_NOT_OPEN');
      expect(await codeOf(svc(state.noShift).payment.pay())).toBe('CASH_SHIFT_NOT_OPEN');
    });

    it('allows selling below zero only with allowNegativeStock', async () => {
      const p = await product(1);
      await svc().checkout.addItem({ productId: p.id, quantity: 1 });
      await fx.setAllowNegativeStock(true);
      await svc().checkout.updateItem((await svc().checkout.current()).checkout!.lines[0].id, {
        quantity: 3,
      });
      const { total } = await svc().payment.pay();
      await complete('1000', total);
      expect(await stockOf(p.id)).toBe(-2);
    });
  });

  describe('idempotency and concurrency', () => {
    it('the same key twice gives one sale, and the retry returns the stored sale', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 2]]);
      const idempotencyKey = key();
      const first = await complete('500', total, state.cashier, idempotencyKey);
      const again = await complete('500', total, state.cashier, idempotencyKey);
      expect(again).toEqual(first);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await stockOf(p.id)).toBe(8);
      expect(await state.base.posCheckoutPayment.count({ where: { companyId: state.companyId } })).toBe(1);
    });

    it('two concurrent completes of the same cart and key give one sale', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 2]]);
      const idempotencyKey = key();
      const [one, two] = await Promise.all([
        complete('500', total, state.cashier, idempotencyKey),
        complete('500', total, state.cashier, idempotencyKey),
      ]);
      expect(one.sale.saleId).toBe(two.sale.saleId);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await stockOf(p.id)).toBe(8);
    });

    it('two concurrent completes of the same cart with different keys give one sale', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 2]]);
      const results = await Promise.all([codeOf(complete('500', total)), codeOf(complete('500', total))]);
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await stockOf(p.id)).toBe(8);
    });

    it('another cashier cannot reuse my key to read my sale', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const idempotencyKey = key();
      await complete('500', total, state.cashier, idempotencyKey);
      expect(await codeOf(complete('500', total, state.second, idempotencyKey))).toBe('CHECKOUT_NOT_FOUND');
    });

    it('two cashiers selling the last unit at the same time: only one succeeds', async () => {
      const last = await product(1);
      const a = await pay([[last.id, 1]], state.cashier);
      const b = await pay([[last.id, 1]], state.second);
      const results = await Promise.all([
        codeOf(complete('500', a.total, state.cashier)),
        codeOf(complete('500', b.total, state.second)),
      ]);
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.filter((r) => r === 'INSUFFICIENT_STOCK')).toHaveLength(1);
      expect(await stockOf(last.id)).toBe(0);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await state.base.stockMovement.count({ where: { productId: last.id, type: 'SALE' } })).toBe(1);
      await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId, status: 'PAYING' } });
    });

    it('the loser of the race learns which product ran out', async () => {
      const last = await product(1);
      const a = await pay([[last.id, 1]], state.cashier);
      await pay([[last.id, 1]], state.second);
      await complete('500', a.total, state.cashier);
      expect(await detailsOf(complete('500', a.total, state.second))).toEqual({
        productId: last.id,
        available: 0,
      });
    });

    it('a failure after the stock step rolls everything back, and the number is not lost', async () => {
      const first = await product(10);
      const { total: firstTotal } = await pay([[first.id, 1]]);
      const { sale: sold } = await complete('500', firstTotal);
      const soldNumber = parseSalesDocumentNumber('sale', sold.number)!;

      const x = await product(10);
      const y = await product(10);
      const [early, late] = [x, y].sort((l, r) => (l.id < r.id ? -1 : 1));
      const { total } = await pay([
        [early.id, 2],
        [late.id, 2],
      ]);
      // the sale takes `early` first (ids in order); `late` runs out after `pay`
      await state.base.stockLevel.update({
        where: { productId_warehouseId: { productId: late.id, warehouseId: state.centralId } },
        data: { quantity: 1 },
      });
      expect(await codeOf(complete('1000', total))).toBe('INSUFFICIENT_STOCK');

      expect(await stockOf(early.id)).toBe(10);
      expect(await state.base.stockMovement.count({ where: { productId: early.id, type: 'SALE' } })).toBe(0);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await state.base.cashMovement.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await state.base.invoice.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await state.base.posCheckoutPayment.count({ where: { companyId: state.companyId } })).toBe(1);
      expect((await svc().checkout.current()).checkout?.status).toBe('PAYING');

      await state.base.stockLevel.update({
        where: { productId_warehouseId: { productId: late.id, warehouseId: state.centralId } },
        data: { quantity: 10 },
      });
      const { sale: next } = await complete('1000', total);
      expect(parseSalesDocumentNumber('sale', next.number)).toBe(soldNumber + 1);
    });

    it('sale numbers are consecutive with no gaps under concurrency', async () => {
      const p = await product(20);
      const a = await pay([[p.id, 1]], state.cashier);
      const b = await pay([[p.id, 1]], state.second);
      const [one, two] = await Promise.all([
        complete('500', a.total, state.cashier),
        complete('500', b.total, state.second),
      ]);
      const numbers = [one.sale.number, two.sale.number]
        .map((n) => parseSalesDocumentNumber('sale', n)!)
        .sort((l, r) => l - r);
      expect(numbers[1] - numbers[0]).toBe(1);
    });
  });

  describe('audit hardening (stock-auditor)', () => {
    it('units reserved for an order are not the sale’s to take', async () => {
      const p = await fx.newProduct({
        price: '245.00',
        stock: { [state.centralId]: 5 },
        reserved: { [state.centralId]: 4 },
      });
      await pay([[p.id, 1]]);
      // a reservation grows after `pay`: only 1 − 1 left, then 0
      await state.base.stockLevel.update({
        where: { productId_warehouseId: { productId: p.id, warehouseId: state.centralId } },
        data: { reserved: 5 },
      });
      expect(await codeOf(complete('500', '245.00'))).toBe('INSUFFICIENT_STOCK');
      expect(await detailsOf(complete('500', '245.00'))).toEqual({ productId: p.id, available: 0 });
      expect(await stockOf(p.id)).toBe(5);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('the same key on a sale of another total is a client mistake, not a retry', async () => {
      const p = await product(10, '245.00');
      const { total } = await pay([[p.id, 1]]);
      const idempotencyKey = key();
      await complete('500', total, state.cashier, idempotencyKey);
      // a new cart, a different total, the same key
      const next = await pay([[p.id, 2]]);
      expect(next.total).toBe('490.00');
      expect(await codeOf(complete('500', next.total, state.cashier, idempotencyKey))).toBe(
        'IDEMPOTENCY_KEY_REUSED',
      );
      expect(await stockOf(p.id)).toBe(9);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
    });

    it('two carts sending the same key: the second gets a coded error and nothing is left behind', async () => {
      const p = await product(10, '245.00');
      const a = await pay([[p.id, 1]], state.cashier);
      const b = await pay([[p.id, 1]], state.second);
      const idempotencyKey = key();
      const results = await Promise.all([
        codeOf(complete('500', a.total, state.cashier, idempotencyKey)),
        codeOf(complete('500', b.total, state.second, idempotencyKey)),
      ]);
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(
        results.filter((r) => r === 'IDEMPOTENCY_KEY_REUSED' || r === 'CHECKOUT_NOT_FOUND'),
      ).toHaveLength(1);
      expect(await stockOf(p.id)).toBe(9);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
    });

    it('a retry of a committed sale returns it even after the shift closed', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const idempotencyKey = key();
      const first = await complete('500', total, state.cashier, idempotencyKey);
      const shift = await state.base.cashShift.findFirstOrThrow({ where: { openedById: state.cashier.userId, status: 'OPEN' } });
      await state.base.cashShift.update({ where: { id: shift.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      try {
        expect(await complete('500', total, state.cashier, idempotencyKey)).toEqual(first);
      } finally {
        await state.base.cashShift.update({ where: { id: shift.id }, data: { status: 'OPEN', closedAt: null } });
      }
    });

    it('a shift closed after the cart went to payment cannot take the sale’s cash', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]]);
      const shift = await state.base.cashShift.findFirstOrThrow({
        where: { openedById: state.cashier.userId, status: 'OPEN' },
      });
      await state.base.cashShift.update({
        where: { id: shift.id },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      try {
        expect(await codeOf(complete('500', total))).toBe('CASH_SHIFT_NOT_OPEN');
        expect(await stockOf(p.id)).toBe(10);
      } finally {
        await state.base.cashShift.update({
          where: { id: shift.id },
          data: { status: 'OPEN', closedAt: null },
        });
      }
    });

    it('two sales with the same products in opposite order finish without a deadlock', async () => {
      const x = await product(10);
      const y = await product(10);
      const a = await pay(
        [
          [x.id, 1],
          [y.id, 1],
        ],
        state.cashier,
      );
      const b = await pay(
        [
          [y.id, 1],
          [x.id, 1],
        ],
        state.second,
      );
      const results = await Promise.all([
        codeOf(complete('1000', a.total, state.cashier)),
        codeOf(complete('1000', b.total, state.second)),
      ]);
      expect(results).toEqual([null, null]);
      expect(await stockOf(x.id)).toBe(8);
      expect(await stockOf(y.id)).toBe(8);
      // the movements add up to the level
      const moved = await state.base.stockMovement.aggregate({
        where: { productId: x.id, type: 'SALE' },
        _sum: { quantity: true },
      });
      expect(moved._sum.quantity).toBe(-2);
    });
  });

  describe('receipt (VP-16a)', () => {
    async function soldSale() {
      const p = await product(10, '245.00');
      const { total } = await pay([[p.id, 2]]);
      return (await complete('1000', total)).sale;
    }

    it('answers the ticket data with the invoice record’s tax data and no costs', async () => {
      const sale = await soldSale();
      const receipt = await svc().receipts.receipt(sale.saleId);
      expect(receipt).toMatchObject({
        saleId: sale.saleId,
        number: sale.number,
        branch: { name: 'Sucursal central' },
        customer: { name: 'S/N', documentNumber: '0' },
        subtotal: '490.00',
        total: '490.00',
        payments: [{ method: 'CASH', amount: '490.00', change: '510.00' }],
        invoiceStatus: 'PENDING',
        format: 'TICKET_80MM',
      });
      expect(receipt.company.tradeName).toBe('possale');
      expect(receipt.cashier.name).toBe('User cashier');
      expect(receipt.lines).toHaveLength(1);
      expect(JSON.stringify(receipt).toLowerCase()).not.toContain('cost');
    });

    it('follows the receipt format setting', async () => {
      const sale = await soldSale();
      await state.base.companySetting.upsert({
        where: { companyId_key: { companyId: state.companyId, key: 'sales.receiptFormat' } },
        create: { companyId: state.companyId, key: 'sales.receiptFormat', value: 'LETTER' },
        update: { value: 'LETTER' },
      });
      expect((await svc().receipts.receipt(sale.saleId)).format).toBe('LETTER');
      await state.base.companySetting.deleteMany({
        where: { companyId: state.companyId, key: 'sales.receiptFormat' },
      });
    });

    it('does not exist for another company or an unknown id', async () => {
      const sale = await soldSale();
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(state.other).receipts.receipt(sale.saleId))).toBe('SALE_NOT_FOUND');
      fx.useCompany(state.companyId);
      expect(await codeOf(svc().receipts.receipt(randomUUID()))).toBe('SALE_NOT_FOUND');
    });

    it('queues the e-mail through the outbox, without the NIT', async () => {
      const sale = await soldSale();
      await expect(svc().receipts.sendEmail(sale.saleId, ' cliente@example.com ')).resolves.toEqual({
        queued: true,
      });
      const event = await state.base.outboxEvent.findFirstOrThrow({
        where: { companyId: state.companyId, type: 'sale.receipt-email' },
      });
      const payload = event.payload as { email: string; number: string; text: string };
      expect(payload).toMatchObject({ email: 'cliente@example.com', number: sale.number });
      expect(payload.text).toContain(sale.number);
      expect(payload.text).not.toContain('1020304050');
    });

    it('is the cashier’s own: another cashier of the company cannot read or e-mail it', async () => {
      const sale = await soldSale();
      expect(await codeOf(svc(state.second).receipts.receipt(sale.saleId))).toBe('SALE_NOT_FOUND');
      expect(await codeOf(svc(state.second).receipts.sendEmail(sale.saleId, 'a@example.com'))).toBe('SALE_NOT_FOUND');
    });

    it('audits who sent the receipt and where', async () => {
      const sale = await soldSale();
      await svc().receipts.sendEmail(sale.saleId, 'cliente@example.com');
      const audit = await state.base.auditLog.findFirstOrThrow({ where: { companyId: state.companyId, action: 'sales.receipt.email' } });
      expect(audit).toMatchObject({ entity: 'Sale', entityId: sale.saleId, userId: state.cashier.userId });
    });

    it('refuses an invalid address', async () => {
      const sale = await soldSale();
      expect(await codeOf(svc().receipts.sendEmail(sale.saleId, 'not-an-email'))).toBe('INVALID_EMAIL');
      expect(
        await state.base.outboxEvent.count({
          where: { companyId: state.companyId, type: 'sale.receipt-email' },
        }),
      ).toBe(0);
    });
  });
});
