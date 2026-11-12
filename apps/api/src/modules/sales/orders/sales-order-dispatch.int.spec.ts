/**
 * Integration test of dispatching an order in parts (HU-VEN-20) against the real Postgres: every dispatch makes a sale and its
 * PENDING invoice for exactly the dispatched units, with no payment and no shift; the reserved units leave through the stock
 * service (`reserved` and `quantity` drop together); the balance stays on the order; the sales of all the dispatches add up to
 * the order total; and the guards, the idempotency key and the races (two dispatches, a dispatch and a cancellation, opposite
 * line orders) hold.
 */
import { randomUUID } from 'node:crypto';
import type { CreateDispatchInput, SalesOrderDetail } from '@rodasoft/domain';
import { codeOf, createPosFixture, detailsOf } from '../pos/pos.int-fixture';

// several dispatches and checks per test against a real database: slower than the 5 s default when the machine is busy
jest.setTimeout(30_000);

const fx = createPosFixture('dispatch');
const { state } = fx;

describe('Order dispatch (integration, real Postgres)', () => {
  beforeAll(() => fx.setup(), 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));
  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.dispatch.deleteMany({ where: { companyId: state.companyId } });
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

  const orders = () => fx.as(state.cashier).orders;
  const dispatches = () => fx.as(state.cashier).dispatches;
  let docSeq = 0;
  const newCustomer = (discount?: { type: 'PERCENT' | 'AMOUNT'; value: string }) => {
    docSeq += 1;
    return state.base.customer.create({
      data: {
        companyId: state.companyId,
        name: 'Cliente Despacho',
        documentType: 1,
        documentNumber: `${3000000 + docSeq}`,
        ...(discount ? { discountType: discount.type, discountValue: discount.value } : {}),
      },
    });
  };
  const setSetting = (key: string, value: unknown) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key } },
      create: { companyId: state.companyId, key, value: value as never },
      update: { value: value as never },
    });
  /** An order of the given products converted from a real quote, so the reservation is the one the app makes. */
  async function orderFor(lines: { productId: string; quantity: number }[], discount?: { type: 'PERCENT' | 'AMOUNT'; value: string }) {
    const customer = await newCustomer(discount);
    const quote = await fx.as(state.cashier).quotes.create({ customerId: customer.id, lines });
    return orders().convert(quote.id, { warehouseId: state.centralId });
  }
  const level = (productId: string, warehouseId = state.centralId) =>
    state.base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } });
  const give = (order: SalesOrderDetail, quantities: number[]): CreateDispatchInput => ({
    items: order.lines.map((line, index) => ({ orderItemId: line.id, quantity: quantities[index] ?? 0 })),
  });

  describe('a part of the order', () => {
    it('invoices exactly what is dispatched, with no payment and no shift, and keeps the balance on the order', async () => {
      const a = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 10 } });
      const b = await fx.newProduct({ price: '40.00', stock: { [state.centralId]: 10 } });
      const c = await fx.newProduct({ price: '25.00', stock: { [state.centralId]: 10 } });
      const order = await orderFor([
        { productId: a.id, quantity: 6 },
        { productId: b.id, quantity: 3 },
        { productId: c.id, quantity: 2 },
      ]);
      expect(await level(a.id)).toMatchObject({ quantity: 10, reserved: 6 });

      const after = await dispatches().dispatch(order.id, give(order, [6, 2, 0]), randomUUID());

      expect(after.status).toBe('PARTIALLY_DISPATCHED');
      expect(after.lines.map((l) => [l.reservedQuantity, l.dispatchedQuantity, l.invoicedQuantity, l.pendingQuantity])).toEqual([
        [6, 6, 6, 0],
        [3, 2, 2, 1],
        [2, 0, 0, 2],
      ]);
      expect(after.dispatches).toHaveLength(1);
      expect(after.dispatches[0]).toMatchObject({ number: 'DSP-000001', pieces: 8, total: '680.00', saleNumber: 'V-000001' });
      expect(after.invoicedTotal).toBe('680.00');
      expect(after.dispatchable).toBe(true);
      expect(after.timeline.map((s) => s.state)).toEqual(['done', 'done', 'current', 'pending', 'pending']);

      // the sale: born from the order, no shift, no checkout, no payment, an invoice waiting for the SIAT
      const sale = await state.base.sale.findFirstOrThrow({
        where: { companyId: state.companyId },
        include: { items: true, payments: true, invoice: true, dispatch: true },
      });
      expect(sale).toMatchObject({ origin: 'ORDER', shiftId: null, checkoutId: null, status: 'COMPLETED', number: 'V-000001' });
      expect(sale.total.toFixed(2)).toBe('680.00');
      expect(sale.payments).toHaveLength(0);
      expect(sale.items.map((i) => [i.quantity, i.unitPrice.toFixed(2), i.lineTotal.toFixed(2)]).sort()).toEqual(
        [
          [2, '40.00', '80.00'],
          [6, '100.00', '600.00'],
        ].sort(),
      );
      expect(sale.invoice).toMatchObject({ status: 'PENDING', customerTaxName: 'Cliente Despacho' });
      expect(sale.invoice?.total.toFixed(2)).toBe('680.00');
      expect(sale.dispatch?.orderId).toBe(order.id);

      // the units left: quantity and reserved dropped together, what is not dispatched stays reserved
      expect(await level(a.id)).toMatchObject({ quantity: 4, reserved: 0 });
      expect(await level(b.id)).toMatchObject({ quantity: 8, reserved: 1 });
      expect(await level(c.id)).toMatchObject({ quantity: 10, reserved: 2 });
      const movements = await state.base.stockMovement.findMany({
        where: { companyId: state.companyId, refType: 'SALE', productId: { in: [a.id, b.id, c.id] } },
        orderBy: { quantity: 'asc' },
      });
      expect(movements.map((m) => [m.type, m.quantity, m.refNumber, m.refId])).toEqual([
        ['SALE', -6, 'V-000001', sale.id],
        ['SALE', -2, 'V-000001', sale.id],
      ]);
    });

    it('audits the dispatch and the sale and publishes both events in the same transaction', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 5 } });
      const order = await orderFor([{ productId: p.id, quantity: 4 }]);
      await dispatches().dispatch(order.id, give(order, [1]), randomUUID());

      const audit = await state.base.auditLog.findMany({ where: { companyId: state.companyId, action: { in: ['sales.order.dispatch', 'sales.sale.complete'] } } });
      expect(audit.map((a) => a.action).sort()).toEqual(['sales.order.dispatch', 'sales.sale.complete']);
      const completed = await state.base.outboxEvent.findMany({ where: { companyId: state.companyId, type: 'sale.completed' } });
      expect(completed).toHaveLength(1);
      expect(completed[0].payload).toMatchObject({ origin: 'ORDER', shiftId: null, orderId: order.id });
      expect(await state.base.outboxEvent.count({ where: { companyId: state.companyId, type: 'sales.order.dispatched' } })).toBe(1);
    });

    it('the rest can go later, the order is complete and the reservation is all used', async () => {
      const a = await fx.newProduct({ price: '50.00', stock: { [state.centralId]: 10 } });
      const b = await fx.newProduct({ price: '30.00', stock: { [state.centralId]: 10 } });
      const order = await orderFor([
        { productId: a.id, quantity: 5 },
        { productId: b.id, quantity: 3 },
      ]);
      await dispatches().dispatch(order.id, give(order, [5, 1]), randomUUID());
      const done = await dispatches().dispatch(order.id, give(order, [0, 2]), randomUUID());

      expect(done.status).toBe('DISPATCHED');
      expect(done.dispatchable).toBe(false);
      expect(done.cancellable).toBe(false);
      expect(done.dispatches.map((d) => d.number)).toEqual(['DSP-000001', 'DSP-000002']);
      expect(done.timeline.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done']);
      expect(done.invoicedTotal).toBe(done.total);
      expect(await level(a.id)).toMatchObject({ quantity: 5, reserved: 0 });
      expect(await level(b.id)).toMatchObject({ quantity: 7, reserved: 0 });
      expect(await codeOf(dispatches().dispatch(order.id, give(order, [1, 0]), randomUUID()))).toBe('SALES_ORDER_NOT_DISPATCHABLE');
    });

    it('a dispatch that completes the order invoices exactly what is left, so the sales add up to the order total', async () => {
      await setSetting('sales.roundingMode', 'INTEGER');
      const a = await fx.newProduct({ price: '33.33', stock: { [state.centralId]: 20 } });
      const b = await fx.newProduct({ price: '120.10', stock: { [state.centralId]: 20 } });
      const c = await fx.newProduct({ price: '9.99', stock: { [state.centralId]: 20 } });
      const order = await orderFor(
        [
          { productId: a.id, quantity: 7 },
          { productId: b.id, quantity: 3 },
          { productId: c.id, quantity: 11 },
        ],
        { type: 'PERCENT', value: '7.50' },
      );
      await dispatches().dispatch(order.id, give(order, [7, 0, 0]), randomUUID());
      await dispatches().dispatch(order.id, give(order, [0, 3, 5]), randomUUID());
      const done = await dispatches().dispatch(order.id, give(order, [0, 0, 6]), randomUUID());

      expect(done.status).toBe('DISPATCHED');
      const sales = await state.base.sale.findMany({ where: { companyId: state.companyId, origin: 'ORDER' } });
      expect(sales).toHaveLength(3);
      const sum = (pick: (s: (typeof sales)[number]) => { toFixed(n: number): string }) =>
        (sales.reduce((acc, s) => acc + Math.round(Number(pick(s).toFixed(2)) * 100), 0) / 100).toFixed(2);
      expect(sum((s) => s.subtotal)).toBe(Number(done.subtotal).toFixed(2));
      expect(sum((s) => s.discountAmount)).toBe(Number(done.discountAmount).toFixed(2));
      expect(sum((s) => s.total)).toBe(done.total);
      expect(done.invoicedTotal).toBe(done.total);
      expect(sales.every((s) => s.discountType === 'PERCENT')).toBe(true);
      const invoices = await state.base.invoice.findMany({ where: { companyId: state.companyId } });
      expect(invoices.map((i) => i.total.toFixed(2)).sort()).toEqual(sales.map((s) => s.total.toFixed(2)).sort());
    });

    it('what is invoiced follows the live invoices: a cancelled invoice leaves its pieces dispatched but not invoiced', async () => {
      const p = await fx.newProduct({ price: '50.00', stock: { [state.centralId]: 10 } });
      const order = await orderFor([{ productId: p.id, quantity: 4 }]);
      const first = await dispatches().dispatch(order.id, give(order, [1]), randomUUID());
      const second = await dispatches().dispatch(order.id, give(order, [2]), randomUUID());
      expect(second.lines[0]).toMatchObject({ dispatchedQuantity: 3, invoicedQuantity: 3, pendingQuantity: 1 });
      expect(second.invoicedTotal).toBe('150.00');
      await state.base.invoice.updateMany({ where: { saleId: first.dispatches[0].saleId as string }, data: { status: 'CANCELLED' } });
      const detail = await orders().detail(order.id);
      expect(detail.lines[0]).toMatchObject({ dispatchedQuantity: 3, invoicedQuantity: 2 });
      expect(detail.invoicedTotal).toBe('100.00');
    });

    it('the sale of a dispatch shows in the history with the order it came from', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 5 } });
      const order = await orderFor([{ productId: p.id, quantity: 2 }]);
      const after = await dispatches().dispatch(order.id, give(order, [2]), randomUUID());
      const detail = await fx.as(state.cashier).history.detail(after.dispatches[0].saleId as string);
      expect(detail.order).toEqual({ id: order.id, number: order.number });
      expect(detail.payments).toEqual([]);
      expect(detail.invoice.status).toBe('PENDING');
    });
  });

  describe('cancelling after a partial dispatch', () => {
    it('releases only the reserved units that were not dispatched', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const other = await orderFor([{ productId: p.id, quantity: 3 }]);
      const mine = await orderFor([{ productId: p.id, quantity: 5 }]);
      await dispatches().dispatch(mine.id, give(mine, [2]), randomUUID());
      // 3 + 5 reserved, 2 of them left
      expect(await level(p.id)).toMatchObject({ quantity: 8, reserved: 6 });
      await orders().cancel(mine.id, 'Cambio de planes');
      expect(await level(p.id)).toMatchObject({ quantity: 8, reserved: 3 });
      expect((await orders().detail(other.id)).status).toBe('OPEN');
    });
  });

  describe('the sale of a dispatch', () => {
    it('cannot be cancelled from the sales history: the order would not follow', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 5 } });
      const order = await orderFor([{ productId: p.id, quantity: 2 }]);
      const after = await dispatches().dispatch(order.id, give(order, [2]), randomUUID());
      const saleId = after.dispatches[0].saleId as string;
      expect(await codeOf(fx.as(state.cashier).cancellations.request(saleId, { reason: 'OTHER', comment: 'Prueba' }))).toBe('SALE_FROM_ORDER_NOT_CANCELLABLE');
      expect((await fx.as(state.cashier).history.detail(saleId)).cancellation.canRequest).toBe(false);
      expect(await level(p.id)).toMatchObject({ quantity: 3, reserved: 0 });
    });
  });

  describe('guards', () => {
    it('refuses more than what is reserved and not dispatched, naming every short line', async () => {
      const a = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const b = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const order = await orderFor([
        { productId: a.id, quantity: 4 },
        { productId: b.id, quantity: 2 },
      ]);
      await dispatches().dispatch(order.id, give(order, [3, 0]), randomUUID());
      const request = give(order, [2, 5]);
      const attempt = dispatches().dispatch(order.id, request, randomUUID());
      expect(await detailsOf(attempt)).toEqual({
        items: [
          { orderItemId: order.lines[0].id, requested: 2, dispatchable: 1 },
          { orderItemId: order.lines[1].id, requested: 5, dispatchable: 2 },
        ],
      });
      // nothing moved
      expect(await level(a.id)).toMatchObject({ quantity: 7, reserved: 1 });
      expect(await state.base.dispatch.count({ where: { companyId: state.companyId } })).toBe(1);
    });

    it('refuses an empty dispatch, a line of another order and fractions', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const order = await orderFor([{ productId: p.id, quantity: 4 }]);
      const stranger = await orderFor([{ productId: p.id, quantity: 1 }]);
      expect(await codeOf(dispatches().dispatch(order.id, give(order, [0]), randomUUID()))).toBe('DISPATCH_EMPTY');
      expect(await codeOf(dispatches().dispatch(order.id, { items: [] }, randomUUID()))).toBe('DISPATCH_EMPTY');
      expect(await codeOf(dispatches().dispatch(order.id, { items: [{ orderItemId: stranger.lines[0].id, quantity: 1 }] }, randomUUID()))).toBe(
        'ORDER_ITEM_NOT_FOUND',
      );
      expect(await codeOf(dispatches().dispatch(order.id, { items: [{ orderItemId: order.lines[0].id, quantity: 1.5 }] }, randomUUID()))).toBe('INVALID_QUANTITY');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('a cancelled order cannot be dispatched and an unknown one is not found', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 3 } });
      const order = await orderFor([{ productId: p.id, quantity: 2 }]);
      await orders().cancel(order.id, 'Prueba');
      expect(await codeOf(dispatches().dispatch(order.id, give(order, [1]), randomUUID()))).toBe('SALES_ORDER_NOT_DISPATCHABLE');
      expect(await codeOf(dispatches().dispatch(randomUUID(), give(order, [1]), randomUUID()))).toBe('SALES_ORDER_NOT_FOUND');
    });

    it('with partial dispatch off, it must give everything that is pending', async () => {
      await setSetting('sales.allowPartialDispatch', false);
      const a = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const b = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const order = await orderFor([
        { productId: a.id, quantity: 4 },
        { productId: b.id, quantity: 2 },
      ]);
      expect((await orders().detail(order.id)).partialDispatchAllowed).toBe(false);
      expect(await codeOf(dispatches().dispatch(order.id, give(order, [4, 1]), randomUUID()))).toBe('PARTIAL_DISPATCH_NOT_ALLOWED');
      expect(await level(a.id)).toMatchObject({ quantity: 10, reserved: 4 });
      const done = await dispatches().dispatch(order.id, give(order, [4, 2]), randomUUID());
      expect(done.status).toBe('DISPATCHED');
    });

    it('a customer with an invalid document stops the dispatch before anything moves', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 3 } });
      const order = await orderFor([{ productId: p.id, quantity: 2 }]);
      await state.base.customer.updateMany({ where: { companyId: state.companyId }, data: { status: 'INACTIVE' } });
      expect(await codeOf(dispatches().dispatch(order.id, give(order, [2]), randomUUID()))).not.toBeNull();
      expect(await level(p.id)).toMatchObject({ quantity: 3, reserved: 2 });
      expect(await state.base.dispatch.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('rolls back everything when a unit is no longer in the warehouse, leaving no number gap', async () => {
      const a = await fx.newProduct({ stock: { [state.centralId]: 5 } });
      const b = await fx.newProduct({ stock: { [state.centralId]: 5 } });
      const order = await orderFor([
        { productId: a.id, quantity: 2 },
        { productId: b.id, quantity: 2 },
      ]);
      // the physical stock of b was lost after the reservation (an adjustment written by hand)
      await state.base.stockLevel.updateMany({ where: { productId: b.id, warehouseId: state.centralId }, data: { quantity: 1 } });
      expect(await codeOf(dispatches().dispatch(order.id, give(order, [2, 2]), randomUUID()))).toBe('INSUFFICIENT_STOCK');
      expect(await level(a.id)).toMatchObject({ quantity: 5, reserved: 2 });
      expect(await level(b.id)).toMatchObject({ quantity: 1, reserved: 2 });
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await state.base.dispatch.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await state.base.stockMovement.count({ where: { productId: { in: [a.id, b.id] }, type: 'SALE' } })).toBe(0);
      const items = await state.base.salesOrderItem.findMany({ where: { orderId: order.id } });
      expect(items.every((i) => i.dispatchedQuantity === 0)).toBe(true);
      // the next dispatch gets the first numbers: the rolled-back one left no gap
      await state.base.stockLevel.updateMany({ where: { productId: b.id, warehouseId: state.centralId }, data: { quantity: 5 } });
      const ok = await dispatches().dispatch(order.id, give(order, [2, 2]), randomUUID());
      expect(ok.dispatches[0]).toMatchObject({ number: 'DSP-000001', saleNumber: 'V-000001' });
    });
  });

  describe('idempotency', () => {
    it('a repeated key returns the order as it was left and dispatches once', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const order = await orderFor([{ productId: p.id, quantity: 6 }]);
      const key = randomUUID();
      const first = await dispatches().dispatch(order.id, give(order, [2]), key);
      const again = await dispatches().dispatch(order.id, give(order, [2]), key);
      expect(again.dispatches).toHaveLength(1);
      expect(again.lines[0].dispatchedQuantity).toBe(2);
      expect(again.dispatches[0].id).toBe(first.dispatches[0].id);
      expect(await level(p.id)).toMatchObject({ quantity: 8, reserved: 4 });
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
    });

    it('the same key sent at the same time dispatches once', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const order = await orderFor([{ productId: p.id, quantity: 6 }]);
      const key = randomUUID();
      const results = await Promise.allSettled([
        dispatches().dispatch(order.id, give(order, [2]), key),
        dispatches().dispatch(order.id, give(order, [2]), key),
        dispatches().dispatch(order.id, give(order, [2]), key),
      ]);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(await state.base.dispatch.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await level(p.id)).toMatchObject({ quantity: 8, reserved: 4 });
    });

    it('the same key with other quantities is not a replay: it is refused and nothing more moves', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const order = await orderFor([{ productId: p.id, quantity: 6 }]);
      const key = randomUUID();
      await dispatches().dispatch(order.id, give(order, [2]), key);
      expect(await codeOf(dispatches().dispatch(order.id, give(order, [3]), key))).toBe('DISPATCH_KEY_REUSED');
      expect(await level(p.id)).toMatchObject({ quantity: 8, reserved: 4 });
    });

    it('a key used for another order is refused', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const one = await orderFor([{ productId: p.id, quantity: 2 }]);
      const two = await orderFor([{ productId: p.id, quantity: 2 }]);
      const key = randomUUID();
      await dispatches().dispatch(one.id, give(one, [1]), key);
      expect(await codeOf(dispatches().dispatch(two.id, give(two, [1]), key))).toBe('DISPATCH_KEY_REUSED');
    });
  });

  describe('races', () => {
    it('two dispatches of the same reserved units: the sum never exceeds the reserve', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const order = await orderFor([{ productId: p.id, quantity: 5 }]);
      const results = await Promise.allSettled([
        dispatches().dispatch(order.id, give(order, [3]), randomUUID()),
        dispatches().dispatch(order.id, give(order, [3]), randomUUID()),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((rejected.reason as { getResponse: () => { code: string } }).getResponse().code).toBe('DISPATCH_EXCEEDS_RESERVED');
      expect(await level(p.id)).toMatchObject({ quantity: 7, reserved: 2 });
      const item = await state.base.salesOrderItem.findFirstOrThrow({ where: { orderId: order.id } });
      expect(item.dispatchedQuantity).toBe(3);
    });

    it('a dispatch racing a cancellation: one wins and reserved never goes below zero', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const order = await orderFor([{ productId: p.id, quantity: 4 }]);
      const results = await Promise.allSettled([
        dispatches().dispatch(order.id, give(order, [4]), randomUUID()),
        orders().cancel(order.id, 'Carrera'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const row = await level(p.id);
      expect(row.reserved).toBe(0);
      const dispatched = results[0].status === 'fulfilled';
      expect(row.quantity).toBe(dispatched ? 6 : 10);
      expect(await state.base.stockMovement.count({ where: { productId: p.id, type: 'SALE' } })).toBe(dispatched ? 1 : 0);
      expect((await orders().detail(order.id)).status).toBe(dispatched ? 'DISPATCHED' : 'CANCELLED');
    });

    it('orders whose lines come in opposite order do not deadlock', async () => {
      const a = await fx.newProduct({ stock: { [state.centralId]: 20 } });
      const b = await fx.newProduct({ stock: { [state.centralId]: 20 } });
      const one = await orderFor([
        { productId: a.id, quantity: 4 },
        { productId: b.id, quantity: 4 },
      ]);
      const two = await orderFor([
        { productId: b.id, quantity: 4 },
        { productId: a.id, quantity: 4 },
      ]);
      const results = await Promise.all([
        dispatches().dispatch(one.id, give(one, [4, 4]), randomUUID()),
        dispatches().dispatch(two.id, give(two, [4, 4]), randomUUID()),
      ]);
      expect(results.every((r) => r.status === 'DISPATCHED')).toBe(true);
      expect(await level(a.id)).toMatchObject({ quantity: 12, reserved: 0 });
      expect(await level(b.id)).toMatchObject({ quantity: 12, reserved: 0 });
      const numbers = (await state.base.dispatch.findMany({ where: { companyId: state.companyId } })).map((d) => d.number).sort();
      expect(numbers).toEqual(['DSP-000001', 'DSP-000002']);
    });
  });

  describe('scope', () => {
    it('an order of another company or of a branch the user does not operate is not found', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 3 } });
      const order = await orderFor([{ productId: p.id, quantity: 2 }]);
      const scoped = fx.as(state.cashier, { operableBranchIds: [state.otherBranchId] });
      expect(await codeOf(scoped.dispatches.dispatch(order.id, give(order, [1]), randomUUID()))).toBe('SALES_ORDER_NOT_FOUND');
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(dispatches().dispatch(order.id, give(order, [1]), randomUUID()))).toBe('SALES_ORDER_NOT_FOUND');
      fx.useCompany(state.companyId);
      expect(await state.base.dispatch.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await level(p.id)).toMatchObject({ quantity: 3, reserved: 2 });
    });
  });
  describe('line order and measures (HU-VEN-33, HU-VEN-36)', () => {
    it('keeps the order of the quote lines in the order, the dispatch and its sale, and shows the measures of each line', async () => {
      const a = await fx.newProduct({ code: 'LO-A', price: '10.00', stock: { [state.centralId]: 10 }, dimensions: { innerDiameter: '10.000', outerDiameter: '30.000', width: '9.000' } });
      const b = await fx.newProduct({ code: 'LO-B', price: '20.00', stock: { [state.centralId]: 10 } });
      const c = await fx.newProduct({ code: 'LO-C', price: '30.00', stock: { [state.centralId]: 10 } });
      const customer = await newCustomer();
      const quote = await fx.as(state.cashier).quotes.create({
        customerId: customer.id,
        lines: [
          { productId: c.id, quantity: 1 },
          { productId: a.id, quantity: 1 },
          { productId: b.id, quantity: 1 },
        ],
      });
      const codes = ['LO-C', 'LO-A', 'LO-B'];
      expect((await fx.as(state.cashier).quotes.detail(quote.id)).lines.map((l) => l.code)).toEqual(codes);

      const order = await orders().convert(quote.id, { warehouseId: state.centralId });
      expect(order.lines.map((l) => l.code)).toEqual(codes);
      expect(order.lines[1].spec).toMatchObject({ measures: { innerDiameter: '10', outerDiameter: '30', width: '9' }, category: 'Rodamientos' });
      expect(order.lines[0].spec.measures).toBeNull();

      const after = await dispatches().dispatch(order.id, give(order, [1, 1, 1]), randomUUID());
      const detail = await fx.as(state.cashier).history.detail(after.dispatches[0].saleId as string);
      expect(detail.lines.map((l) => l.code)).toEqual(codes);
      expect(detail.lines[1].spec.measures).toMatchObject({ innerDiameter: '10', outerDiameter: '30', width: '9' });
    });
  });
});
