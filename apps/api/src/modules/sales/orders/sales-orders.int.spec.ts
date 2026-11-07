/**
 * Integration test of the orders (HU-VEN-19) against the real Postgres: converting a quote reserves the stock of the chosen
 * warehouse (all or nothing), a reservation blocks the POS and other orders, conversion and sale race for the last unit,
 * cancelling gives the units back once, and the list, the detail, audit, outbox and tenant isolation.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, detailsOf } from '../pos/pos.int-fixture';

const fx = createPosFixture('orders');
const { state } = fx;

describe('Sales orders (integration, real Postgres)', () => {
  beforeAll(() => fx.setup(), 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));
  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.salesOrder.deleteMany({ where: { companyId: state.companyId } });
    await state.base.quote.deleteMany({ where: { companyId: state.companyId } });
    await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
    await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.customer.deleteMany({ where: { companyId: state.companyId } });
    await state.base.documentSequence.deleteMany({ where: { companyId: state.companyId } });
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
  });

  const quotes = () => fx.as(state.cashier).quotes;
  const orders = () => fx.as(state.cashier).orders;
  let docSeq = 0;
  const newCustomer = () => {
    docSeq += 1;
    return state.base.customer.create({
      data: { companyId: state.companyId, name: 'Cliente Pedido', documentType: 1, documentNumber: `${2000000 + docSeq}` },
    });
  };
  /** A quote for the given products, created through the service. */
  async function quoteFor(lines: { productId: string; quantity: number }[]) {
    const customer = await newCustomer();
    return quotes().create({ customerId: customer.id, lines });
  }
  const level = (productId: string, warehouseId = state.centralId) =>
    state.base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } });

  describe('convert', () => {
    it('creates PED-000001 from the quote with its lines and totals, accepts the quote and reserves the stock', async () => {
      const a = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 10 } });
      const b = await fx.newProduct({ price: '40.00', stock: { [state.centralId]: 5 } });
      const quote = await quoteFor([
        { productId: a.id, quantity: 4 },
        { productId: b.id, quantity: 5 },
      ]);
      const order = await orders().convert(quote.id, { warehouseId: state.centralId });

      expect(order.number).toBe('PED-000001');
      expect(order.status).toBe('OPEN');
      expect(order.quote).toEqual({ id: quote.id, number: quote.number });
      expect(order.warehouseName).toBe('Central');
      expect(order.total).toBe(quote.total);
      expect(order.lines.map((l) => [l.quantity, l.unitPrice, l.lineTotal, l.reservedQuantity, l.dispatchedQuantity])).toEqual([
        [4, '100.00', '400.00', 4, 0],
        [5, '40.00', '200.00', 5, 0],
      ]);
      expect((await quotes().detail(quote.id)).status).toBe('ACCEPTED');
      expect((await quotes().detail(quote.id)).order).toEqual({ id: order.id, number: 'PED-000001' });

      // reserved grows, the physical quantity does not, and no movement is written
      expect(await level(a.id)).toMatchObject({ quantity: 10, reserved: 4 });
      expect(await level(b.id)).toMatchObject({ quantity: 5, reserved: 5 });
      expect(await state.base.stockMovement.count({ where: { productId: a.id, type: { not: 'INITIAL' } } })).toBe(0);
    });

    it('converts a sent quote too, audits both documents and publishes the event', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 3 } });
      const quote = await quoteFor([{ productId: p.id, quantity: 1 }]);
      await state.base.quote.update({ where: { id: quote.id }, data: { status: 'SENT' } });
      const order = await orders().convert(quote.id, { warehouseId: state.centralId });
      expect(await state.base.auditLog.count({ where: { entity: 'Quote', entityId: quote.id, action: 'sales.quote.accept' } })).toBe(1);
      expect(await state.base.auditLog.count({ where: { entity: 'SalesOrder', entityId: order.id, action: 'sales.order.create' } })).toBe(1);
      expect(await state.base.outboxEvent.count({ where: { companyId: state.companyId, type: 'sales.order.created' } })).toBe(1);
    });

    it('refuses a quote that is accepted, expired, rejected or past its day', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 50 } });
      const refused = async (data: Record<string, unknown>) => {
        const quote = await quoteFor([{ productId: p.id, quantity: 1 }]);
        await state.base.quote.update({ where: { id: quote.id }, data });
        return codeOf(orders().convert(quote.id, { warehouseId: state.centralId }));
      };
      expect(await refused({ status: 'ACCEPTED' })).toBe('QUOTE_NOT_CONVERTIBLE');
      expect(await refused({ status: 'EXPIRED' })).toBe('QUOTE_NOT_CONVERTIBLE');
      expect(await refused({ status: 'REJECTED' })).toBe('QUOTE_NOT_CONVERTIBLE');
      expect(await refused({ status: 'SENT', validUntil: new Date('2020-01-01T00:00:00Z') })).toBe('QUOTE_NOT_CONVERTIBLE');
      expect(await level(p.id)).toMatchObject({ reserved: 0 });
      expect(await state.base.salesOrder.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('converting the same quote twice, even at once, creates one order and reserves once', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const quote = await quoteFor([{ productId: p.id, quantity: 3 }]);
      const results = await Promise.allSettled([
        orders().convert(quote.id, { warehouseId: state.centralId }),
        orders().convert(quote.id, { warehouseId: state.centralId }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await state.base.salesOrder.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await level(p.id)).toMatchObject({ quantity: 10, reserved: 3 });
    });

    it('refuses the whole conversion when one product is short, naming every short product, and reserves nothing', async () => {
      const ok = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const shortA = await fx.newProduct({ stock: { [state.centralId]: 2 } });
      const shortB = await fx.newProduct({ stock: { [state.centralId]: 4 }, reserved: { [state.centralId]: 3 } });
      const quote = await quoteFor([
        { productId: ok.id, quantity: 5 },
        { productId: shortA.id, quantity: 3 },
        { productId: shortB.id, quantity: 2 },
      ]);
      const attempt = orders().convert(quote.id, { warehouseId: state.centralId });
      const details = (await detailsOf(attempt)) as { items: { productId: string; requested: number; available: number }[] };
      expect(details.items).toEqual(
        expect.arrayContaining([
          { productId: shortA.id, requested: 3, available: 2 },
          { productId: shortB.id, requested: 2, available: 1 },
        ]),
      );
      expect(details.items).toHaveLength(2);
      expect(await codeOf(orders().convert(quote.id, { warehouseId: state.centralId }))).toBe('INSUFFICIENT_STOCK');
      expect(await level(ok.id)).toMatchObject({ reserved: 0 });
      expect(await level(shortB.id)).toMatchObject({ reserved: 3 });
      expect(await state.base.salesOrder.count({ where: { companyId: state.companyId } })).toBe(0);
      expect((await quotes().detail(quote.id)).status).toBe('DRAFT');
      // the failed attempts left no gap in the numbering
      const retry = await fx.newProduct({ stock: { [state.centralId]: 5 } });
      const next = await quoteFor([{ productId: retry.id, quantity: 1 }]);
      expect((await orders().convert(next.id, { warehouseId: state.centralId })).number).toBe('PED-000001');
    });

    it('a product without stock in that warehouse is short; a warehouse of another company or an unknown one is not found', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 5 } });
      const quote = await quoteFor([{ productId: p.id, quantity: 1 }]);
      expect(await codeOf(orders().convert(quote.id, { warehouseId: state.annexId }))).toBe('INSUFFICIENT_STOCK');
      expect(await codeOf(orders().convert(quote.id, { warehouseId: state.otherCentralId }))).toBe('SALES_WAREHOUSE_NOT_FOUND');
      expect(await codeOf(orders().convert(quote.id, { warehouseId: randomUUID() }))).toBe('SALES_WAREHOUSE_NOT_FOUND');
      await state.base.warehouse.update({ where: { id: state.annexId }, data: { status: 'INACTIVE' } });
      expect(await codeOf(orders().convert(quote.id, { warehouseId: state.annexId }))).toBe('SALES_WAREHOUSE_INACTIVE');
      await state.base.warehouse.update({ where: { id: state.annexId }, data: { status: 'ACTIVE' } });
    });

    it('skips the availability check with negative stock allowed, as the POS does', async () => {
      await fx.setAllowNegativeStock(true);
      const p = await fx.newProduct({ stock: { [state.centralId]: 1 } });
      const quote = await quoteFor([{ productId: p.id, quantity: 4 }]);
      await orders().convert(quote.id, { warehouseId: state.centralId });
      expect(await level(p.id)).toMatchObject({ quantity: 1, reserved: 4 });
    });
  });

  describe('reserved stock is no longer available to others', () => {
    it('blocks a POS sale of the reserved units and shows the lower availability in the POS search', async () => {
      const p = await fx.newProduct({ code: 'ORDRES-1', price: '10.00', stock: { [state.centralId]: 5 } });
      const quote = await quoteFor([{ productId: p.id, quantity: 4 }]);
      await orders().convert(quote.id, { warehouseId: state.centralId });

      const pos = fx.as(state.cashier);
      expect((await pos.catalog.search({ q: 'ORDRES-1' })).items[0].available).toBe(1);
      expect(await codeOf(pos.checkout.addItem({ productId: p.id, quantity: 2 }))).toBe('INSUFFICIENT_STOCK');
      await pos.checkout.addItem({ productId: p.id, quantity: 1 });
    });

    it('refuses a second order for the same units', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 5 } });
      const first = await quoteFor([{ productId: p.id, quantity: 3 }]);
      const second = await quoteFor([{ productId: p.id, quantity: 3 }]);
      await orders().convert(first.id, { warehouseId: state.centralId });
      expect(await codeOf(orders().convert(second.id, { warehouseId: state.centralId }))).toBe('INSUFFICIENT_STOCK');
      expect(await level(p.id)).toMatchObject({ reserved: 3 });
    });

    it('two conversions racing for the last units: one wins and reserved never exceeds the stock', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 5 } });
      const quoteList = await Promise.all(Array.from({ length: 4 }, () => quoteFor([{ productId: p.id, quantity: 2 }])));
      const results = await Promise.allSettled(quoteList.map((q) => orders().convert(q.id, { warehouseId: state.centralId })));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
      const row = await level(p.id);
      expect(row.reserved).toBe(4);
      expect(row.reserved).toBeLessThanOrEqual(row.quantity);
    });

    it('opposite line orders do not deadlock', async () => {
      const a = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const b = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const q1 = await quoteFor([
        { productId: a.id, quantity: 1 },
        { productId: b.id, quantity: 1 },
      ]);
      const q2 = await quoteFor([
        { productId: b.id, quantity: 1 },
        { productId: a.id, quantity: 1 },
      ]);
      const results = await Promise.all([
        orders().convert(q1.id, { warehouseId: state.centralId }),
        orders().convert(q2.id, { warehouseId: state.centralId }),
      ]);
      expect(results).toHaveLength(2);
      expect(await level(a.id)).toMatchObject({ reserved: 2 });
    });

    it('a sale and a conversion racing for the last unit: only one gets it', async () => {
      const p = await fx.newProduct({ price: '10.00', stock: { [state.centralId]: 1 } });
      const quote = await quoteFor([{ productId: p.id, quantity: 1 }]);
      const pos = fx.as(state.cashier);
      await pos.checkout.addItem({ productId: p.id, quantity: 1 });
      const { total } = await pos.payment.pay();
      const results = await Promise.allSettled([
        orders().convert(quote.id, { warehouseId: state.centralId }),
        pos.payment.complete({ payments: [{ method: 'CASH', received: total }], expectedTotal: total, idempotencyKey: randomUUID() }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const row = await level(p.id);
      expect(row.quantity - row.reserved).toBeGreaterThanOrEqual(0);
    });
  });

  describe('other stock removals respect the reservation', () => {
    it('an adjustment or transfer cannot take the stock below the reserved units, and can once the order is cancelled', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const order = await orders().convert((await quoteFor([{ productId: p.id, quantity: 8 }])).id, { warehouseId: state.centralId });
      const remove = (quantity: number) =>
        state.base.$transaction((tx) =>
          fx.stockService().apply(tx as never, { productId: p.id, warehouseId: state.centralId, type: 'ADJUSTMENT_OUT', quantity: -quantity, reason: 'Merma' }),
        );
      // 10 on hand, 8 reserved: only 2 are free
      expect(await codeOf(remove(5))).toBe('INSUFFICIENT_STOCK');
      await remove(2);
      expect(await level(p.id)).toMatchObject({ quantity: 8, reserved: 8 });
      await orders().cancel(order.id, 'Prueba');
      await remove(5);
      expect(await level(p.id)).toMatchObject({ quantity: 3, reserved: 0 });
    });
  });

  describe('cancel', () => {
    it('cancels the order and gives the reserved units back, once', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 6 } });
      const quote = await quoteFor([{ productId: p.id, quantity: 4 }]);
      const order = await orders().convert(quote.id, { warehouseId: state.centralId });
      const cancelled = await orders().cancel(order.id, 'El cliente ya no lo necesita');
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.cancellable).toBe(false);
      expect(cancelled.cancelledAt).not.toBeNull();
      expect(await level(p.id)).toMatchObject({ quantity: 6, reserved: 0 });
      expect(await codeOf(orders().cancel(order.id, 'otra vez'))).toBe('ORDER_NOT_CANCELLABLE');
      expect(await level(p.id)).toMatchObject({ reserved: 0 });
      expect(await state.base.auditLog.count({ where: { entity: 'SalesOrder', entityId: order.id, action: 'sales.order.cancel' } })).toBe(1);
      expect(await state.base.outboxEvent.count({ where: { companyId: state.companyId, type: 'sales.order.cancelled' } })).toBe(1);
      // the units can be sold or reserved again
      const again = await quoteFor([{ productId: p.id, quantity: 6 }]);
      await orders().convert(again.id, { warehouseId: state.centralId });
    });

    it('releases only what was not dispatched and never takes another order’s units', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const mine = await orders().convert((await quoteFor([{ productId: p.id, quantity: 5 }])).id, { warehouseId: state.centralId });
      await orders().convert((await quoteFor([{ productId: p.id, quantity: 3 }])).id, { warehouseId: state.centralId });
      await state.base.salesOrderItem.updateMany({ where: { orderId: mine.id }, data: { dispatchedQuantity: 2 } });
      await orders().cancel(mine.id, 'Cambio de planes');
      // 8 reserved − (5 − 2) released
      expect(await level(p.id)).toMatchObject({ reserved: 5 });
    });

    it('an unknown order is not found', async () => {
      expect(await codeOf(orders().cancel(randomUUID(), 'x'))).toBe('SALES_ORDER_NOT_FOUND');
    });
  });

  describe('branch scope', () => {
    it('an order of a branch the user does not operate is not found, listed or cancelled', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 2 } });
      const order = await orders().convert((await quoteFor([{ productId: p.id, quantity: 1 }])).id, { warehouseId: state.centralId });
      // a caller who only operates another branch
      const scoped = fx.as(state.cashier, { operableBranchIds: [state.otherBranchId] });
      expect(await codeOf(scoped.orders.detail(order.id))).toBe('SALES_ORDER_NOT_FOUND');
      expect(await codeOf(scoped.orders.cancel(order.id, 'x'))).toBe('SALES_ORDER_NOT_FOUND');
      expect((await scoped.orders.list({})).total).toBe(0);
      expect(await level(p.id)).toMatchObject({ reserved: 1 });
    });
  });

  describe('list, detail and tenant isolation', () => {
    it('lists newest first with the quote number and filters by status and text', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 20 } });
      const q1 = await quoteFor([{ productId: p.id, quantity: 1 }]);
      const q2 = await quoteFor([{ productId: p.id, quantity: 1 }]);
      const o1 = await orders().convert(q1.id, { warehouseId: state.centralId });
      const o2 = await orders().convert(q2.id, { warehouseId: state.centralId });
      await orders().cancel(o1.id, 'Prueba');

      const all = await orders().list({});
      expect(all.items.map((o) => o.number)).toEqual([o2.number, o1.number]);
      expect(all.items[0]).toMatchObject({ quoteNumber: q2.number, warehouseName: 'Central', customerName: 'Cliente Pedido', status: 'OPEN' });
      expect((await orders().list({ status: 'CANCELLED' })).items.map((o) => o.number)).toEqual([o1.number]);
      expect((await orders().list({ q: q2.number })).items.map((o) => o.number)).toEqual([o2.number]);
      expect((await orders().list({ q: 'PED-000001' })).items.map((o) => o.number)).toEqual([o1.number]);
      expect((await orders().list({ page: 2, pageSize: 1 })).items.map((o) => o.number)).toEqual([o1.number]);
    });

    it('does not show an order to another company', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 2 } });
      const order = await orders().convert((await quoteFor([{ productId: p.id, quantity: 1 }])).id, { warehouseId: state.centralId });
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(orders().detail(order.id))).toBe('SALES_ORDER_NOT_FOUND');
      expect(await codeOf(orders().cancel(order.id, 'x'))).toBe('SALES_ORDER_NOT_FOUND');
      expect((await orders().list({})).total).toBe(0);
    });
  });
});
