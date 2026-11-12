/**
 * Integration test of the price list and the price edit (HU-VEN-26) against the real Postgres: one price per product and company
 * (the POS reads the edited value), the `price_changes` row with its audit entry and outbox event in one transaction, every
 * guard, tenant isolation, and two people editing the same product at once.
 */
import { randomUUID } from 'node:crypto';
import type { Caller } from '../pos/pos.int-fixture';
import { codeOf, createPosFixture, detailsOf } from '../pos/pos.int-fixture';

jest.setTimeout(30_000);

const fx = createPosFixture('prices');
const { state } = fx;

const EDIT = 'sales.prices.edit';
const COSTS = 'inventory.costs.view';

describe('Prices (integration, real Postgres)', () => {
  let manager: Caller;
  let secondManager: Caller;

  beforeAll(async () => {
    await fx.setup();
    manager = await fx.newMember('manager', state.companyId);
    secondManager = await fx.newMember('manager2', state.companyId);
    fx.grant(manager, EDIT);
    fx.grant(secondManager, EDIT);
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => {
    fx.useCompany(state.companyId);
    fx.grant(manager, EDIT);
  });

  const svc = (caller: Caller = manager) => fx.as(caller).prices;
  const stored = (id: string) => state.base.product.findUniqueOrThrow({ where: { id } });
  const changes = (productId: string) => state.base.priceChange.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } });
  const edit = (productId: string, newPrice: string, expectedPrice = '245.00', reason?: string, caller: Caller = manager) =>
    svc(caller).edit(productId, { newPrice, expectedPrice, ...(reason === undefined ? {} : { reason }) });

  describe('the edit', () => {
    it('updates the single price column and returns the product with its history', async () => {
      const product = await fx.newProduct();
      const detail = await edit(product.id, '255.00', '245.00', '  Nueva lista del proveedor  ');

      expect(detail).toMatchObject({ productId: product.id, salePrice: '255.00', sku: product.sku, manufacturerCode: product.manufacturerCode });
      expect(detail.changes).toHaveLength(1);
      expect(detail.changes[0]).toMatchObject({
        oldPrice: '245.00',
        newPrice: '255.00',
        percent: '4.1',
        source: 'MANUAL',
        reason: 'Nueva lista del proveedor',
        by: { id: manager.userId },
      });
      const row = await stored(product.id);
      expect(row.salePrice.toFixed(2)).toBe('255.00');
      expect(row.updatedById).toBe(manager.userId);
      expect(row.updatedAt.getTime()).toBeGreaterThan(product.updatedAt.getTime());
    });

    it('records the change, the audit entry and the outbox event', async () => {
      const product = await fx.newProduct();
      await edit(product.id, '260.50', '245.00', 'Ajuste');

      const rows = await changes(product.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ companyId: state.companyId, userId: manager.userId, source: 'MANUAL', reason: 'Ajuste', batchId: null });
      expect([rows[0].oldPrice.toFixed(2), rows[0].newPrice.toFixed(2)]).toEqual(['245.00', '260.50']);

      const audits = await state.base.auditLog.findMany({ where: { companyId: state.companyId, action: 'sales.price.update', entityId: product.id } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ entity: 'Product', userId: manager.userId });
      expect(audits[0].before).toEqual({ salePrice: '245.00' });
      expect(audits[0].after).toMatchObject({ salePrice: '260.50', reason: 'Ajuste', source: 'MANUAL', priceChangeId: rows[0].id });

      const events = await state.base.outboxEvent.findMany({ where: { idempotencyKey: `price-changed:${rows[0].id}` } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'sales.price.changed', companyId: state.companyId });
      expect(events[0].payload).toMatchObject({ productId: product.id, oldPrice: '245.00', newPrice: '260.50', userId: manager.userId });
    });

    it('accepts a price typed with a comma and keeps no reason when none is given', async () => {
      const product = await fx.newProduct();
      const detail = await edit(product.id, '1.250,50');
      expect(detail.salePrice).toBe('1250.50');
      expect((await changes(product.id))[0].reason).toBeNull();
    });

    it('reaches the POS at once: the search shows the new price and an open cart is told at payment', async () => {
      const product = await fx.newProduct({ stock: { [state.centralId]: 5 } });
      await fx.as(state.cashier).checkout.addItem({ productId: product.id, quantity: 1 });
      await edit(product.id, '255.00');

      const found = await fx.as(state.cashier).catalog.search({ q: product.manufacturerCode } as never);
      expect(found.items.find((i) => i.id === product.id)).toMatchObject({ salePrice: '255.00' });
      expect(await codeOf(fx.as(state.cashier).payment.pay())).toBe('CHECKOUT_PRICES_CHANGED');
    });
  });

  describe('guards', () => {
    it.each(['0', '0.00', '-1', '10.123', 'abc', '', '99999999999999'])('refuses the price %j with INVALID_PRICE and writes nothing', async (newPrice) => {
      const product = await fx.newProduct();
      expect(await codeOf(edit(product.id, newPrice))).toBe('INVALID_PRICE');
      expect((await stored(product.id)).salePrice.toFixed(2)).toBe('245.00');
      expect(await changes(product.id)).toHaveLength(0);
    });

    it('refuses the same price with PRICE_UNCHANGED', async () => {
      const product = await fx.newProduct();
      expect(await codeOf(edit(product.id, '245.00'))).toBe('PRICE_UNCHANGED');
      expect(await codeOf(edit(product.id, '245'))).toBe('PRICE_UNCHANGED');
      expect(await changes(product.id)).toHaveLength(0);
    });

    it('refuses an edit made over a price that already changed, and says the current one', async () => {
      const product = await fx.newProduct();
      await edit(product.id, '250.00');
      const stale = edit(product.id, '260.00', '245.00', undefined, secondManager);
      expect(await codeOf(stale)).toBe('PRICE_CHANGED');
      expect(await detailsOf(edit(product.id, '260.00', '245.00', undefined, secondManager))).toEqual({ currentPrice: '250.00' });
      expect((await stored(product.id)).salePrice.toFixed(2)).toBe('250.00');
      expect(await changes(product.id)).toHaveLength(1);
    });

    it('answers PRODUCT_NOT_FOUND for an unknown product and for a draft', async () => {
      expect(await codeOf(edit(randomUUID(), '10.00'))).toBe('PRODUCT_NOT_FOUND');
      expect(await codeOf(svc().detail(randomUUID()))).toBe('PRODUCT_NOT_FOUND');
      const draft = await fx.newProduct({ status: 'DRAFT' });
      expect(await codeOf(edit(draft.id, '10.00'))).toBe('PRODUCT_NOT_FOUND');
      expect(await codeOf(svc().detail(draft.id))).toBe('PRODUCT_NOT_FOUND');
    });

    it('refuses an expected price that is not an amount', async () => {
      const product = await fx.newProduct();
      expect(await codeOf(edit(product.id, '250.00', 'abc'))).toBe('VALIDATION_FAILED');
    });

    it('keeps companies apart: one price per product and company', async () => {
      const ours = await fx.newProduct();
      const theirs = await fx.newProduct({ companyId: state.otherCompanyId, brandId: state.otherBrandId, categoryId: state.otherCategoryId });
      // company A cannot read or edit the product of company B
      expect(await codeOf(svc().detail(theirs.id))).toBe('PRODUCT_NOT_FOUND');
      expect(await codeOf(edit(theirs.id, '1.00'))).toBe('PRODUCT_NOT_FOUND');
      expect((await svc().list({ q: theirs.manufacturerCode })).items).toEqual([]);

      const foreign = await fx.newMember('foreign-manager', state.otherCompanyId);
      fx.grant(foreign, EDIT);
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(edit(ours.id, '1.00', '245.00', undefined, foreign))).toBe('PRODUCT_NOT_FOUND');
      await edit(theirs.id, '300.00', '245.00', undefined, foreign);
      fx.useCompany(state.companyId);

      expect((await stored(ours.id)).salePrice.toFixed(2)).toBe('245.00');
      expect((await stored(theirs.id)).salePrice.toFixed(2)).toBe('300.00');
      expect(await changes(ours.id)).toHaveLength(0);
    });
  });

  describe('concurrency', () => {
    it('two edits over the same price: one wins, the other gets PRICE_CHANGED, one row is written', async () => {
      const product = await fx.newProduct();
      const results = await Promise.all([codeOf(edit(product.id, '250.00')), codeOf(edit(product.id, '260.00', '245.00', undefined, secondManager))]);

      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.filter((r) => r === 'PRICE_CHANGED')).toHaveLength(1);
      const winner = results[0] === null ? '250.00' : '260.00';
      expect((await stored(product.id)).salePrice.toFixed(2)).toBe(winner);
      const rows = await changes(product.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].newPrice.toFixed(2)).toBe(winner);
      expect(await state.base.auditLog.count({ where: { action: 'sales.price.update', entityId: product.id } })).toBe(1);
    });

    it('ten edits over the same price: exactly one wins', async () => {
      const product = await fx.newProduct();
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => codeOf(edit(product.id, `${300 + i}.00`))));
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.filter((r) => r === 'PRICE_CHANGED')).toHaveLength(9);
      expect(await changes(product.id)).toHaveLength(1);
    });
  });

  describe('the list', () => {
    it('shows the product with its price, the stock of the branch and the last change', async () => {
      const product = await fx.newProduct({ stock: { [state.centralId]: 7, [state.annexId]: 3 } });
      const before = (await svc().list({ q: product.manufacturerCode })).items[0];
      expect(before).toMatchObject({
        productId: product.id,
        sku: product.sku,
        manufacturerCode: product.manufacturerCode,
        brand: { id: state.brandId },
        status: 'ACTIVE',
        salePrice: '245.00',
        hasPrice: true,
        // both warehouses of the branch
        branchStock: 10,
        lastChange: null,
      });

      await edit(product.id, '250.00');
      await edit(product.id, '240.00', '250.00', 'Promoción');
      const list = await svc().list({ q: product.manufacturerCode });
      expect(list.branch).toEqual({ id: state.branchId, name: 'Sucursal central' });
      expect(list.items[0]).toMatchObject({ salePrice: '240.00', lastChange: { oldPrice: '250.00', newPrice: '240.00', percent: '-4.0', reason: 'Promoción', by: { id: manager.userId } } });
    });

    it('filters by brand, category, with and without price, and pages', async () => {
      const unpriced = await fx.newProduct({ price: '0.00', categoryId: state.sealsId });
      const nested = await fx.newProduct({ categoryId: state.subcategoryId });

      const without = await svc().list({ priced: 'without', pageSize: 100 });
      expect(without.items.map((i) => i.productId)).toContain(unpriced.id);
      expect(without.items.every((i) => !i.hasPrice && i.salePrice === '0.00')).toBe(true);
      const withPrice = await svc().list({ priced: 'with', pageSize: 100 });
      expect(withPrice.items.map((i) => i.productId)).not.toContain(unpriced.id);

      expect((await svc().list({ categoryId: state.sealsId, pageSize: 100 })).items.map((i) => i.productId)).toContain(unpriced.id);
      // a parent category also lists the products of its subcategories
      expect((await svc().list({ categoryId: state.bearingsId, pageSize: 100 })).items.map((i) => i.productId)).toContain(nested.id);
      expect((await svc().list({ brandId: randomUUID() })).items).toEqual([]);

      const paged = await svc().list({ pageSize: 1 });
      expect(paged.items).toHaveLength(1);
      expect(paged.total).toBeGreaterThan(1);
      expect(paged.brands.map((b) => b.id)).toContain(state.brandId);
      expect(paged.categories.map((c) => c.id)).toEqual(expect.arrayContaining([state.bearingsId, state.sealsId]));
    });

    it('counts the KPIs: with price, without price and the changes of the month', async () => {
      const before = (await svc().list({})).kpis;
      const priced = await fx.newProduct();
      await fx.newProduct({ price: '0.00' });
      await fx.newProduct({ status: 'DRAFT' });
      await edit(priced.id, '250.00');
      const after = (await svc().list({})).kpis;

      // the draft is not a product yet
      expect(after.products).toBe(before.products + 2);
      expect(after.withPrice).toBe(before.withPrice + 1);
      expect(after.withoutPrice).toBe(before.withoutPrice + 1);
      expect(after.changesThisMonth).toBe(before.changesThisMonth + 1);
    });

    it('refuses a branch the caller cannot see', async () => {
      expect(await codeOf(svc().list({ branchId: randomUUID() }))).toBe('INVALID_FILTER');
      expect(await codeOf(fx.as(manager, { operableBranchIds: [randomUUID()] }).prices.list({ branchId: state.branchId }))).toBe('BRANCH_FORBIDDEN');
    });
  });

  describe('costs', () => {
    it('never sends the cost or the margin without inventory.costs.view', async () => {
      const product = await fx.newProduct();
      const detail = await svc().detail(product.id);
      expect(detail).not.toHaveProperty('cost');
      expect(detail).not.toHaveProperty('marginPercent');
      expect((await svc().list({})).kpis).not.toHaveProperty('averageMarginPercent');
    });

    it('sends them with the permission', async () => {
      const product = await fx.newProduct({ price: '200.00' });
      fx.grant(manager, EDIT, COSTS);
      // cost 100 of a price of 200
      expect(await svc().detail(product.id)).toMatchObject({ cost: '100.0000', marginPercent: '50.0' });
      expect((await svc().list({})).kpis.averageMarginPercent).toMatch(/^-?\d+\.\d$/);
    });
  });
});
