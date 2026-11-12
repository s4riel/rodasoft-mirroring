/**
 * Integration test of the bulk price update (HU-VEN-27, VP-11c) against the real Postgres: the filter by brand and category, the
 * preview that writes nothing, the atomic apply with one batch, one audit entry and one event, the stale-preview guard, the
 * approval setting of decision #19, tenant isolation, a 1 000-product batch in one transaction and the two concurrency cases (two
 * applies with the same hash, and an apply against a single edit).
 */
import { randomUUID } from 'node:crypto';
import type { BulkPriceApplyInput, BulkPriceInput } from '@rodasoft/domain';
import type { Caller } from '../pos/pos.int-fixture';
import { codeOf, createPosFixture, detailsOf } from '../pos/pos.int-fixture';

jest.setTimeout(60_000);

const fx = createPosFixture('bulk');
const { state } = fx;

const EDIT = 'sales.prices.edit';

describe('Bulk prices (integration, real Postgres)', () => {
  let manager: Caller;

  beforeAll(async () => {
    await fx.setup();
    manager = await fx.newMember('manager', state.companyId);
    fx.grant(manager, EDIT);
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(async () => {
    fx.useCompany(state.companyId);
    fx.grant(manager, EDIT);
    await setApproval(false);
  });

  const bulk = (caller: Caller = manager) => fx.as(caller).bulkPrices;
  const prices = (caller: Caller = manager) => fx.as(caller).prices;
  const priceOf = async (id: string) => (await state.base.product.findUniqueOrThrow({ where: { id } })).salePrice.toFixed(2);
  const input = (brandId: string, extra: Partial<BulkPriceInput> = {}): BulkPriceInput => ({ brandId, direction: 'INCREASE', percent: '5', rounding: 'NONE', ...extra });
  const applyOf = async (body: BulkPriceInput, reason?: string): Promise<BulkPriceApplyInput> => ({
    ...body,
    previewHash: (await bulk().preview(body)).previewHash,
    ...(reason === undefined ? {} : { reason }),
  });
  const newBrand = async (label = 'B', companyId = state.companyId) =>
    (await state.base.brand.create({ data: { companyId, name: `${label}-${randomUUID().slice(0, 8)}` } })).id;
  const setApproval = (value: boolean) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key: 'sales.bulkPriceRequiresApproval' } },
      create: { companyId: state.companyId, key: 'sales.bulkPriceRequiresApproval', value },
      update: { value },
    });
  const setRounding = (value: string) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key: 'sales.roundingMode' } },
      create: { companyId: state.companyId, key: 'sales.roundingMode', value },
      update: { value },
    });
  const countWritten = async () => ({
    changes: await state.base.priceChange.count({ where: { companyId: state.companyId, source: 'BULK' } }),
    audits: await state.base.auditLog.count({ where: { companyId: state.companyId, action: 'sales.price.bulk-update' } }),
    events: await state.base.outboxEvent.count({ where: { companyId: state.companyId, type: 'sales.prices.bulk-changed' } }),
  });

  describe('the preview', () => {
    it('lists the matching products with their new price and writes nothing', async () => {
      const brandId = await newBrand();
      const a = await fx.newProduct({ brandId, price: '245.00', code: 'BUL-A' });
      const b = await fx.newProduct({ brandId, price: '100.00', code: 'BUL-B' });
      const before = await countWritten();

      const preview = await bulk().preview(input(brandId));

      expect(preview.counts).toEqual({ matched: 2, toChange: 2, unchanged: 0, invalid: 0 });
      expect(preview.items.map((row) => [row.manufacturerCode, row.currentPrice, row.newPrice, row.percent, row.status])).toEqual([
        ['BUL-A', '245.00', '257.25', '5.0', 'CHANGE'],
        ['BUL-B', '100.00', '105.00', '5.0', 'CHANGE'],
      ]);
      expect(preview.items[0]).toMatchObject({ productId: a.id, sku: a.sku, name: a.name });
      expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);
      expect(preview.defaultRounding).toBe('NONE');
      expect(preview.requiresApproval).toBe(false);
      expect(await priceOf(a.id)).toBe('245.00');
      expect(await priceOf(b.id)).toBe('100.00');
      expect(await countWritten()).toEqual(before);
    });

    it('gives the same hash for the same prices and another one when a price moves', async () => {
      const brandId = await newBrand();
      const product = await fx.newProduct({ brandId });
      const first = await bulk().preview(input(brandId));
      expect((await bulk().preview(input(brandId))).previewHash).toBe(first.previewHash);
      expect((await bulk().preview(input(brandId, { percent: '6' }))).previewHash).not.toBe(first.previewHash);
      await prices().edit(product.id, { newPrice: '250.00', expectedPrice: '245.00' });
      expect((await bulk().preview(input(brandId))).previewHash).not.toBe(first.previewHash);
    });

    it('pages the rows and counts all of them', async () => {
      const brandId = await newBrand();
      for (const code of ['P-1', 'P-2', 'P-3']) await fx.newProduct({ brandId, code });
      const second = await bulk().preview(input(brandId, { page: 2, pageSize: 2 }));
      expect(second.counts.matched).toBe(3);
      expect(second.items.map((row) => row.manufacturerCode)).toEqual(['P-3']);
      expect(second).toMatchObject({ page: 2, pageSize: 2 });
    });

    it('filters by brand, by category with its subcategories, and by both', async () => {
      const brandId = await newBrand();
      const otherBrandId = await newBrand();
      const inBearings = await fx.newProduct({ brandId, categoryId: state.bearingsId });
      const inSubcategory = await fx.newProduct({ brandId, categoryId: state.subcategoryId });
      const inSeals = await fx.newProduct({ brandId, categoryId: state.sealsId });
      const otherBrand = await fx.newProduct({ brandId: otherBrandId, categoryId: state.bearingsId });
      const ids = async (body: BulkPriceInput) => (await bulk().preview(body)).items.map((row) => row.productId).sort();

      expect(await ids(input(brandId))).toEqual([inBearings.id, inSubcategory.id, inSeals.id].sort());
      expect(await ids({ ...input(brandId), brandId: undefined, categoryId: state.sealsId })).toContain(inSeals.id);
      // the category also matches the products of its subcategories
      const byCategory = await ids({ ...input(brandId), brandId: undefined, categoryId: state.bearingsId });
      expect(byCategory).toEqual(expect.arrayContaining([inBearings.id, inSubcategory.id, otherBrand.id]));
      expect(byCategory).not.toContain(inSeals.id);
      // both filters narrow each other
      expect(await ids(input(brandId, { categoryId: state.bearingsId }))).toEqual([inBearings.id, inSubcategory.id].sort());
    });

    it('never matches a draft', async () => {
      const brandId = await newBrand();
      const draft = await fx.newProduct({ brandId, status: 'DRAFT' });
      const active = await fx.newProduct({ brandId });
      const preview = await bulk().preview(input(brandId));
      expect(preview.counts.matched).toBe(1);
      expect(preview.items.map((row) => row.productId)).toEqual([active.id]);
      await bulk().apply(await applyOf(input(brandId)));
      expect(await priceOf(draft.id)).toBe('245.00');
    });

    it('reports the products that do not change and the ones without a price', async () => {
      const brandId = await newBrand();
      await fx.newProduct({ brandId, price: '100.00', code: 'C-OK' });
      await fx.newProduct({ brandId, price: '20.00', code: 'C-SAME' });
      await fx.newProduct({ brandId, price: '0.00', code: 'C-NOPRICE' });
      // +1 % rounded to a whole boliviano: 100 -> 101, 20 -> 20.20 -> 20
      const preview = await bulk().preview(input(brandId, { percent: '1', rounding: 'INTEGER' }));
      expect(preview.counts).toEqual({ matched: 3, toChange: 1, unchanged: 1, invalid: 1 });
      const byCode = Object.fromEntries(preview.items.map((row) => [row.manufacturerCode, row]));
      expect(byCode['C-OK']).toMatchObject({ newPrice: '101.00', status: 'CHANGE' });
      expect(byCode['C-SAME']).toMatchObject({ newPrice: null, percent: null, status: 'UNCHANGED' });
      expect(byCode['C-NOPRICE']).toMatchObject({ newPrice: null, status: 'INVALID' });
    });

    it('answers the rounding of the company so the screen can preselect it', async () => {
      const brandId = await newBrand();
      await fx.newProduct({ brandId });
      await setRounding('HALF_BOLIVIANO');
      try {
        expect((await bulk().preview(input(brandId))).defaultRounding).toBe('HALF_BOLIVIANO');
      } finally {
        await setRounding('NONE');
      }
    });

    it('says when the company asks for approval', async () => {
      const brandId = await newBrand();
      await fx.newProduct({ brandId });
      await setApproval(true);
      expect((await bulk().preview(input(brandId))).requiresApproval).toBe(true);
    });
  });

  describe('the guards', () => {
    it('needs a brand or a category', async () => {
      expect(await codeOf(bulk().preview({ direction: 'INCREASE', percent: '5', rounding: 'NONE' }))).toBe('BULK_FILTER_REQUIRED');
      expect(await codeOf(bulk().apply({ direction: 'INCREASE', percent: '5', rounding: 'NONE', previewHash: 'x' }))).toBe('BULK_FILTER_REQUIRED');
    });

    it('refuses an unknown brand or category and the ones of another company', async () => {
      const otherBrand = await newBrand('X', state.otherCompanyId);
      expect(await codeOf(bulk().preview(input(randomUUID())))).toBe('INVALID_FILTER');
      expect(await codeOf(bulk().preview(input(otherBrand)))).toBe('INVALID_FILTER');
      expect(await detailsOf(bulk().preview(input(otherBrand)))).toEqual([{ field: 'brandId' }]);
      const brandId = await newBrand();
      expect(await codeOf(bulk().preview(input(brandId, { categoryId: state.otherCategoryId })))).toBe('INVALID_FILTER');
      expect(await codeOf(bulk().preview(input(brandId, { categoryId: randomUUID() })))).toBe('INVALID_FILTER');
    });

    it.each(['0', '-5', 'abc', '5.123', '1001', ''])('refuses the percent %j', async (percent) => {
      const brandId = await newBrand();
      expect(await codeOf(bulk().preview(input(brandId, { percent })))).toBe('INVALID_PERCENT');
    });

    it('refuses a decrease of 100 % or more', async () => {
      const brandId = await newBrand();
      expect(await codeOf(bulk().preview(input(brandId, { direction: 'DECREASE', percent: '100' })))).toBe('INVALID_PERCENT');
    });

    it('refuses a filter that matches more than the cap', async () => {
      const brandId = await newBrand();
      const category = state.bearingsId;
      await state.base.product.createMany({
        data: Array.from({ length: 5001 }, (_, i) => ({
          companyId: state.companyId,
          sku: `CAP-${brandId.slice(0, 8)}-${i}`,
          manufacturerCode: `CAP-${i}`,
          brandId,
          categoryId: category,
          name: 'Rodamiento',
          salePrice: '10.00',
        })),
      });
      expect(await codeOf(bulk().preview(input(brandId)))).toBe('BULK_TOO_MANY_PRODUCTS');
      expect(await detailsOf(bulk().preview(input(brandId)))).toEqual({ matched: 5001, max: 5000 });
      expect(await codeOf(bulk().apply({ ...input(brandId), previewHash: 'x' }))).toBe('BULK_TOO_MANY_PRODUCTS');
    }, 90_000);
  });

  describe('the apply', () => {
    it('updates every price, one history row per product under one batch, one audit entry and one event', async () => {
      const brandId = await newBrand('SKF');
      const a = await fx.newProduct({ brandId, price: '245.00' });
      const b = await fx.newProduct({ brandId, price: '100.00' });
      const untouched = await fx.newProduct({ brandId: await newBrand() });
      const before = await countWritten();

      const result = await bulk().apply(await applyOf(input(brandId, { rounding: 'HALF_BOLIVIANO' }), '  Lista de abril  '));

      expect(result.updated).toBe(2);
      expect(await priceOf(a.id)).toBe('257.50');
      expect(await priceOf(b.id)).toBe('105.00');
      expect(await priceOf(untouched.id)).toBe('245.00');
      expect((await state.base.product.findUniqueOrThrow({ where: { id: a.id } })).updatedById).toBe(manager.userId);

      const rows = await state.base.priceChange.findMany({ where: { batchId: result.batchId }, orderBy: { oldPrice: 'asc' } });
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => [r.productId, r.oldPrice.toFixed(2), r.newPrice.toFixed(2)])).toEqual([
        [b.id, '100.00', '105.00'],
        [a.id, '245.00', '257.50'],
      ]);
      for (const row of rows) expect(row).toMatchObject({ companyId: state.companyId, userId: manager.userId, source: 'BULK', reason: 'Lista de abril' });

      const audits = await state.base.auditLog.findMany({ where: { companyId: state.companyId, action: 'sales.price.bulk-update', entityId: result.batchId } });
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ entity: 'PriceBatch', userId: manager.userId });
      expect(audits[0].after).toMatchObject({
        filter: { brandId, brandName: expect.stringContaining('SKF') },
        adjustment: { direction: 'INCREASE', percent: '5.00', rounding: 'HALF_BOLIVIANO' },
        counts: { matched: 2, changed: 2, unchanged: 0, invalid: 0 },
        reason: 'Lista de abril',
      });

      const events = await state.base.outboxEvent.findMany({ where: { idempotencyKey: `price-batch:${result.batchId}` } });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'sales.prices.bulk-changed', companyId: state.companyId });
      expect(events[0].payload).toMatchObject({ batchId: result.batchId, count: 2, direction: 'INCREASE', percent: '5.00', rounding: 'HALF_BOLIVIANO', userId: manager.userId });

      const after = await countWritten();
      expect(after).toEqual({ changes: before.changes + 2, audits: before.audits + 1, events: before.events + 1 });
    });

    it('lowers prices and shows the batch in the history of the product', async () => {
      const brandId = await newBrand();
      const product = await fx.newProduct({ brandId, price: '200.00' });
      await bulk().apply(await applyOf(input(brandId, { direction: 'DECREASE', percent: '10' })));
      expect(await priceOf(product.id)).toBe('180.00');
      const detail = await prices().detail(product.id);
      expect(detail.changes[0]).toMatchObject({ source: 'BULK', oldPrice: '200.00', newPrice: '180.00', percent: '-10.0' });
    });

    it('leaves the products that do not change and the ones without a price as they were', async () => {
      const brandId = await newBrand();
      const same = await fx.newProduct({ brandId, price: '20.00' });
      const free = await fx.newProduct({ brandId, price: '0.00' });
      const moves = await fx.newProduct({ brandId, price: '100.00' });
      const result = await bulk().apply(await applyOf(input(brandId, { percent: '1', rounding: 'INTEGER' })));
      expect(result.updated).toBe(1);
      expect([await priceOf(same.id), await priceOf(free.id), await priceOf(moves.id)]).toEqual(['20.00', '0.00', '101.00']);
      expect(await state.base.priceChange.count({ where: { productId: { in: [same.id, free.id] } } })).toBe(0);
    });

    it('applies a category filter to the subcategories too', async () => {
      const brandId = await newBrand();
      const sub = await fx.newProduct({ brandId, categoryId: state.subcategoryId, price: '100.00' });
      const seals = await fx.newProduct({ brandId, categoryId: state.sealsId, price: '100.00' });
      await bulk().apply(await applyOf({ ...input(brandId), brandId: undefined, categoryId: state.subcategoryId }));
      expect(await priceOf(sub.id)).toBe('105.00');
      expect(await priceOf(seals.id)).toBe('100.00');
    });

    it('keeps a price edit possible afterwards: the single edit reads the new price', async () => {
      const brandId = await newBrand();
      const product = await fx.newProduct({ brandId, price: '100.00' });
      await bulk().apply(await applyOf(input(brandId)));
      expect(await codeOf(prices().edit(product.id, { newPrice: '110.00', expectedPrice: '100.00' }))).toBe('PRICE_CHANGED');
      const detail = await prices().edit(product.id, { newPrice: '110.00', expectedPrice: '105.00' });
      expect(detail.changes.map((c) => c.source)).toEqual(['MANUAL', 'BULK']);
    });

    it('writes nothing and says BULK_PREVIEW_STALE when a price was edited after the preview', async () => {
      const brandId = await newBrand();
      const product = await fx.newProduct({ brandId, price: '100.00' });
      const body = await applyOf(input(brandId));
      await prices().edit(product.id, { newPrice: '120.00', expectedPrice: '100.00' });
      const before = await countWritten();

      expect(await codeOf(bulk().apply(body))).toBe('BULK_PREVIEW_STALE');
      expect(await priceOf(product.id)).toBe('120.00');
      expect(await countWritten()).toEqual(before);
    });

    it('writes nothing when a product of the filter was added after the preview', async () => {
      const brandId = await newBrand();
      const first = await fx.newProduct({ brandId, price: '100.00' });
      const body = await applyOf(input(brandId));
      const late = await fx.newProduct({ brandId, price: '50.00' });
      const before = await countWritten();

      expect(await codeOf(bulk().apply(body))).toBe('BULK_PREVIEW_STALE');
      expect([await priceOf(first.id), await priceOf(late.id)]).toEqual(['100.00', '50.00']);
      expect(await countWritten()).toEqual(before);
    });

    it('refuses an apply without a preview hash or with another percent than the preview', async () => {
      const brandId = await newBrand();
      const product = await fx.newProduct({ brandId, price: '100.00' });
      const body = await applyOf(input(brandId));
      expect(await codeOf(bulk().apply({ ...body, previewHash: undefined as never }))).toBe('BULK_PREVIEW_STALE');
      expect(await codeOf(bulk().apply({ ...body, previewHash: 'not-a-hash' }))).toBe('BULK_PREVIEW_STALE');
      expect(await codeOf(bulk().apply({ ...body, percent: '6' }))).toBe('BULK_PREVIEW_STALE');
      expect(await priceOf(product.id)).toBe('100.00');
    });

    it('answers BULK_NOTHING_TO_CHANGE when no product would move', async () => {
      const brandId = await newBrand();
      await fx.newProduct({ brandId, price: '20.00' });
      await fx.newProduct({ brandId, price: '0.00' });
      const before = await countWritten();
      expect(await codeOf(bulk().apply(await applyOf(input(brandId, { percent: '1', rounding: 'INTEGER' }))))).toBe('BULK_NOTHING_TO_CHANGE');
      expect(await countWritten()).toEqual(before);
    });

    it('answers BULK_NOTHING_TO_CHANGE for a brand without products', async () => {
      const brandId = await newBrand();
      expect(await codeOf(bulk().apply(await applyOf(input(brandId))))).toBe('BULK_NOTHING_TO_CHANGE');
    });

    it('is blocked while the company asks for approval (decision #19) and works again when it stops', async () => {
      const brandId = await newBrand();
      const product = await fx.newProduct({ brandId, price: '100.00' });
      const body = await applyOf(input(brandId));
      await setApproval(true);
      expect(await codeOf(bulk().apply(body))).toBe('BULK_PRICE_APPROVAL_REQUIRED');
      expect(await priceOf(product.id)).toBe('100.00');
      await setApproval(false);
      expect((await bulk().apply(body)).updated).toBe(1);
    });

    it('keeps companies apart', async () => {
      const brandId = await newBrand();
      const mine = await fx.newProduct({ brandId, price: '100.00' });
      const otherBrandId = await newBrand('SKF', state.otherCompanyId);
      const theirs = await fx.newProduct({ brandId: otherBrandId, price: '100.00', companyId: state.otherCompanyId });
      await bulk().apply(await applyOf(input(brandId)));
      expect(await priceOf(mine.id)).toBe('105.00');
      expect(await priceOf(theirs.id)).toBe('100.00');
      expect(await state.base.priceChange.count({ where: { companyId: state.otherCompanyId } })).toBe(0);
    });

    it('applies a batch of 1 000 products in one transaction', async () => {
      const brandId = await newBrand();
      await state.base.product.createMany({
        data: Array.from({ length: 1000 }, (_, i) => ({
          companyId: state.companyId,
          sku: `BIG-${brandId.slice(0, 8)}-${i}`,
          manufacturerCode: `BIG-${i}`,
          brandId,
          categoryId: state.bearingsId,
          name: 'Rodamiento',
          salePrice: `${100 + (i % 50)}.50`,
        })),
      });
      const body = await applyOf(input(brandId, { rounding: 'HALF_BOLIVIANO' }));
      const result = await bulk().apply(body);

      expect(result.updated).toBe(1000);
      const batch = await state.base.priceChange.count({ where: { batchId: result.batchId } });
      expect(batch).toBe(1000);
      // every stored price is the one the history says, rounded to Bs 0,50
      const rows = await state.base.priceChange.findMany({ where: { batchId: result.batchId }, select: { productId: true, newPrice: true } });
      const products = await state.base.product.findMany({ where: { brandId }, select: { id: true, salePrice: true } });
      const stored = new Map(products.map((p) => [p.id, p.salePrice.toFixed(2)]));
      for (const row of rows) {
        expect(stored.get(row.productId)).toBe(row.newPrice.toFixed(2));
        expect(['00', '50']).toContain(row.newPrice.toFixed(2).slice(-2));
      }
      expect(await state.base.auditLog.count({ where: { entityId: result.batchId } })).toBe(1);
    }, 90_000);
  });

  describe('concurrency', () => {
    it('two applies with the same hash: one wins, the other is stale, the prices move once', async () => {
      const brandId = await newBrand();
      const product = await fx.newProduct({ brandId, price: '100.00' });
      const body = await applyOf(input(brandId));

      const settled = await Promise.allSettled([bulk().apply(body), bulk().apply(body), bulk().apply(body)]);

      expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const codes = await Promise.all(settled.filter((r) => r.status === 'rejected').map((r) => codeOf(Promise.reject((r as PromiseRejectedResult).reason))));
      expect(codes).toEqual(['BULK_PREVIEW_STALE', 'BULK_PREVIEW_STALE']);
      expect(await priceOf(product.id)).toBe('105.00');
      expect(await state.base.priceChange.count({ where: { productId: product.id } })).toBe(1);
    });

    it('an apply and a single edit of one of its products: one wins, the history matches the price', async () => {
      const brandId = await newBrand();
      const product = await fx.newProduct({ brandId, price: '100.00' });
      const other = await fx.newProduct({ brandId, price: '200.00' });
      const body = await applyOf(input(brandId));

      const [applied, edited] = await Promise.allSettled([bulk().apply(body), prices(manager).edit(product.id, { newPrice: '130.00', expectedPrice: '100.00' })]);

      // whoever locks the product first wins; the other one sees its price and is refused
      expect([applied.status, edited.status].sort()).toEqual(['fulfilled', 'rejected']);
      const history = await state.base.priceChange.findMany({ where: { productId: product.id }, orderBy: { createdAt: 'asc' } });
      expect(history).toHaveLength(1);
      expect(await priceOf(product.id)).toBe(history[0].newPrice.toFixed(2));
      if (applied.status === 'fulfilled') {
        expect(history[0].source).toBe('BULK');
        expect(await priceOf(other.id)).toBe('210.00');
        expect(await codeOf(Promise.reject((edited as PromiseRejectedResult).reason))).toBe('PRICE_CHANGED');
      } else {
        expect(history[0].source).toBe('MANUAL');
        expect(await priceOf(other.id)).toBe('200.00');
        expect(await codeOf(Promise.reject((applied as PromiseRejectedResult).reason))).toBe('BULK_PREVIEW_STALE');
      }
    });
  });
});
