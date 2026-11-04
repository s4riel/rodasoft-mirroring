/**
 * Integration test of the POS cart (HU-VEN-02) against the real Postgres: the first add creates the cart (once, also
 * under concurrency), adding again raises the line, PATCH and DELETE, the stock check and `allowNegativeStock`, another
 * cashier's line, and server totals that equal `cartTotals()`. The cart never writes stock.
 */
import { cartTotals } from '@rodasoft/domain';
import { codeOf, createPosFixture, detailsOf } from './pos.int-fixture';

const fx = createPosFixture('poschk');
const { state } = fx;

describe('POS checkout (integration, real Postgres)', () => {
  let bearing: string;
  let cheap: string;
  let inactive: string;
  let draft: string;

  beforeAll(async () => {
    await fx.setup();
    bearing = (await fx.newProduct({ price: '245.00', stock: { [state.centralId]: 10 } })).id;
    cheap = (await fx.newProduct({ price: '0.10', stock: { [state.centralId]: 50 } })).id;
    inactive = (await fx.newProduct({ status: 'INACTIVE', stock: { [state.centralId]: 5 } })).id;
    draft = (await fx.newProduct({ status: 'DRAFT' })).id;
  });

  afterAll(() => fx.teardown());

  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await fx.setAllowNegativeStock(false);
  });

  const cashier = () => fx.as(state.cashier).checkout;

  it('has no cart before the first add', async () => {
    expect(await cashier().current()).toEqual({ checkout: null });
  });

  it('the first add creates the OPEN cart and copies the sale price', async () => {
    const { checkout } = await cashier().addItem({ productId: bearing, quantity: 2 });
    expect(checkout).toMatchObject({ status: 'OPEN', subtotal: '490.00', discount: '0.00', total: '490.00' });
    expect(checkout?.lines).toEqual([
      expect.objectContaining({ productId: bearing, quantity: 2, unitPrice: '245.00', lineTotal: '490.00', maxQuantity: 10, sortOrder: 0 }),
    ]);
    const stored = await state.base.posCheckout.findFirstOrThrow({ where: { companyId: state.companyId }, include: { items: true } });
    expect(stored).toMatchObject({ cashierId: state.cashier.userId, status: 'OPEN' });
    expect(stored.items).toHaveLength(1);
    expect(stored.items[0].unitPrice.toFixed(2)).toBe('245.00');
    // the cart survives a refresh
    expect((await cashier().current()).checkout?.id).toBe(stored.id);
  });

  it('an open cart left from another shift moves to the current one', async () => {
    const { checkout } = await cashier().addItem({ productId: bearing, quantity: 1 });
    const shift = await state.base.cashShift.findFirstOrThrow({ where: { openedById: state.cashier.userId, status: 'OPEN' } });
    const older = await state.base.cashShift.create({
      data: { companyId: state.companyId, registerId: shift.registerId, openingFloat: '1.00', openedById: state.second.userId, status: 'CLOSED', closedAt: new Date() },
    });
    await state.base.posCheckout.update({ where: { id: checkout!.id }, data: { shiftId: older.id } });
    await cashier().addItem({ productId: cheap, quantity: 1 });
    expect((await state.base.posCheckout.findUniqueOrThrow({ where: { id: checkout!.id } })).shiftId).toBe(shift.id);
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashShift.delete({ where: { id: older.id } });
  });

  it('5 concurrent adds give exactly one cart and the summed quantity', async () => {
    await Promise.all(Array.from({ length: 5 }, () => cashier().addItem({ productId: bearing, quantity: 1 })));
    const carts = await state.base.posCheckout.findMany({ where: { companyId: state.companyId }, include: { items: true } });
    expect(carts).toHaveLength(1);
    expect(carts[0].items).toHaveLength(1);
    expect(carts[0].items[0].quantity).toBe(5);
  });

  it('concurrent adds of different products give distinct sort orders', async () => {
    await Promise.all([cashier().addItem({ productId: bearing, quantity: 1 }), cashier().addItem({ productId: cheap, quantity: 1 })]);
    const { checkout } = await cashier().current();
    expect(checkout?.lines).toHaveLength(2);
    expect(new Set(checkout?.lines.map((l) => l.sortOrder)).size).toBe(2);
  });

  it('adding the same product raises the quantity of its line; another product gets the next sort order', async () => {
    await cashier().addItem({ productId: bearing, quantity: 1 });
    await cashier().addItem({ productId: cheap, quantity: 1 });
    const { checkout } = await cashier().addItem({ productId: bearing, quantity: 2 });
    expect(checkout?.lines.map((l) => [l.productId, l.quantity, l.sortOrder])).toEqual([
      [bearing, 3, 0],
      [cheap, 1, 1],
    ]);
  });

  it('PATCH changes a quantity and DELETE removes a line; an empty cart stays OPEN', async () => {
    const added = await cashier().addItem({ productId: cheap, quantity: 1 });
    const lineId = added.checkout!.lines[0].id;

    const patched = await cashier().updateItem(lineId, { quantity: 3 });
    expect(patched.checkout).toMatchObject({ subtotal: '0.30', total: '0.30' });
    expect((await state.base.posCheckoutItem.findUniqueOrThrow({ where: { id: lineId } })).quantity).toBe(3);

    const removed = await cashier().removeItem(lineId);
    expect(removed.checkout).toMatchObject({ status: 'OPEN', lines: [], total: '0.00' });
    expect(await state.base.posCheckoutItem.count({ where: { id: lineId } })).toBe(0);
  });

  it('refuses more than the available stock, and allows it with allowNegativeStock', async () => {
    expect(await codeOf(cashier().addItem({ productId: bearing, quantity: 11 }))).toBe('INSUFFICIENT_STOCK');
    expect(await detailsOf(cashier().addItem({ productId: bearing, quantity: 11 }))).toEqual({ available: 10 });

    const { checkout } = await cashier().addItem({ productId: bearing, quantity: 10 });
    expect(await codeOf(cashier().addItem({ productId: bearing, quantity: 1 }))).toBe('INSUFFICIENT_STOCK');
    expect(await codeOf(cashier().updateItem(checkout!.lines[0].id, { quantity: 11 }))).toBe('INSUFFICIENT_STOCK');

    await fx.setAllowNegativeStock(true);
    const allowed = await cashier().updateItem(checkout!.lines[0].id, { quantity: 12 });
    expect(allowed.checkout?.lines[0]).toMatchObject({ quantity: 12, maxQuantity: null });
  });

  it('never writes stock', async () => {
    const before = await state.base.stockLevel.findMany({ where: { companyId: state.companyId }, orderBy: { id: 'asc' } });
    const movements = await state.base.stockMovement.count({ where: { companyId: state.companyId } });
    const { checkout } = await cashier().addItem({ productId: bearing, quantity: 4 });
    await cashier().updateItem(checkout!.lines[0].id, { quantity: 6 });
    await cashier().removeItem(checkout!.lines[0].id);
    expect(await state.base.stockLevel.findMany({ where: { companyId: state.companyId }, orderBy: { id: 'asc' } })).toEqual(before);
    expect(await state.base.stockMovement.count({ where: { companyId: state.companyId } })).toBe(movements);
  });

  it('refuses invalid quantities and unknown, draft or inactive products', async () => {
    expect(await codeOf(cashier().addItem({ productId: bearing, quantity: 0 }))).toBe('INVALID_QUANTITY');
    expect(await codeOf(cashier().addItem({ productId: bearing, quantity: 1.5 }))).toBe('INVALID_QUANTITY');
    expect(await codeOf(cashier().addItem({ productId: bearing, quantity: '2' as unknown as number }))).toBe('INVALID_QUANTITY');
    expect(await codeOf(cashier().addItem({ productId: '00000000-0000-7000-8000-000000000000', quantity: 1 }))).toBe('PRODUCT_NOT_FOUND');
    expect(await codeOf(cashier().addItem({ productId: draft, quantity: 1 }))).toBe('PRODUCT_NOT_FOUND');
    expect(await codeOf(cashier().addItem({ productId: inactive, quantity: 1 }))).toBe('PRODUCT_INACTIVE');
  });

  it("another cashier's line does not exist for me", async () => {
    const { checkout } = await cashier().addItem({ productId: bearing, quantity: 1 });
    const lineId = checkout!.lines[0].id;
    const second = fx.as(state.second).checkout;
    expect(await codeOf(second.updateItem(lineId, { quantity: 2 }))).toBe('CHECKOUT_ITEM_NOT_FOUND');
    expect(await codeOf(second.removeItem(lineId))).toBe('CHECKOUT_ITEM_NOT_FOUND');
    expect((await second.current()).checkout).toBeNull();

    fx.useCompany(state.otherCompanyId);
    expect(await codeOf(fx.as(state.other).checkout.removeItem(lineId))).toBe('CHECKOUT_ITEM_NOT_FOUND');
  });

  it('refuses edits once the cart is no longer OPEN', async () => {
    const { checkout } = await cashier().addItem({ productId: bearing, quantity: 1 });
    await state.base.posCheckout.update({ where: { id: checkout!.id }, data: { status: 'PAYING' } });
    expect(await codeOf(cashier().updateItem(checkout!.lines[0].id, { quantity: 2 }))).toBe('CHECKOUT_NOT_EDITABLE');
    expect(await codeOf(cashier().removeItem(checkout!.lines[0].id))).toBe('CHECKOUT_NOT_EDITABLE');
  });

  it('server totals equal cartTotals() with the company rounding', async () => {
    await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'sales.roundingMode', value: 'INTEGER' } });
    try {
      await cashier().addItem({ productId: bearing, quantity: 1 });
      const { checkout } = await cashier().addItem({ productId: cheap, quantity: 3 });
      const expected = cartTotals(checkout!.lines, { roundingMode: 'INTEGER' });
      expect(checkout).toMatchObject({
        pricing: { roundingMode: 'INTEGER', discount: null },
        subtotal: expected.subtotal.toString(),
        total: expected.total.toString(),
      });
      expect(checkout?.subtotal).toBe('245.30');
      expect(checkout?.total).toBe('245.00');
    } finally {
      await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'sales.roundingMode' } });
    }
  });

  it('refuses without an open cash shift', async () => {
    const noShift = fx.as(state.noShift).checkout;
    expect(await codeOf(noShift.current())).toBe('CASH_SHIFT_NOT_OPEN');
    expect(await codeOf(noShift.addItem({ productId: bearing, quantity: 1 }))).toBe('CASH_SHIFT_NOT_OPEN');
  });
});
