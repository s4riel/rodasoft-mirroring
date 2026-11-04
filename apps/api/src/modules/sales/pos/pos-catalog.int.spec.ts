/**
 * Integration test of the POS search (HU-VEN-02) against the real Postgres: search by code, measurement and brand, the
 * available stock (`quantity − reserved`) of the register's warehouse only, the low and out statuses, no cost, the
 * category filter, tenant isolation and the open shift requirement.
 */
import { codeOf, createPosFixture } from './pos.int-fixture';

const fx = createPosFixture('poscat');
const { state } = fx;

describe('POS catalog (integration, real Postgres)', () => {
  let p6205: string;
  let p6205z: string;
  let lowId: string;
  let outId: string;
  let sealId: string;
  let subId: string;

  beforeAll(async () => {
    await fx.setup();
    p6205 = (
      await fx.newProduct({
        code: `6205-2RS-${state.run}`,
        price: '245.00',
        stock: { [state.centralId]: 26, [state.annexId]: 40 },
        reserved: { [state.centralId]: 2 },
        dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15' },
      })
    ).id;
    p6205z = (await fx.newProduct({ code: `6205-2RS-${state.run}-Z`, stock: { [state.centralId]: 8 } })).id;
    lowId = (await fx.newProduct({ code: `6306-${state.run}`, stock: { [state.centralId]: 3 }, minStock: { [state.centralId]: 5 } })).id;
    outId = (await fx.newProduct({ code: `6208-${state.run}`, stock: { [state.annexId]: 9 } })).id;
    await fx.newProduct({ code: `6205-${state.run}-OFF`, status: 'INACTIVE', stock: { [state.centralId]: 4 } });
    sealId = (await fx.newProduct({ code: `TC-${state.run}`, name: 'Retén', categoryId: state.sealsId, stock: { [state.centralId]: 4 } })).id;
    subId = (await fx.newProduct({ code: `61805-${state.run}`, categoryId: state.subcategoryId, stock: { [state.centralId]: 4 } })).id;
    // same code in the other company, with stock: must never show up
    fx.useCompany(state.otherCompanyId);
    await fx.newProduct({ code: `6205-2RS-${state.run}`, companyId: state.otherCompanyId, brandId: state.otherBrandId, categoryId: state.otherCategoryId, stock: { [state.otherCentralId]: 99 } });
  });

  afterAll(() => fx.teardown());

  beforeEach(() => fx.useCompany(state.companyId));

  it('finds by exact code first, with the available stock of the register warehouse', async () => {
    const { items } = await fx.as(state.cashier).catalog.search({ q: `6205-2rs-${state.run}` });
    expect(items[0]).toMatchObject({
      id: p6205,
      code: `6205-2RS-${state.run}`,
      salePrice: '245.00',
      // 26 in Central − 2 reserved; the 40 of the annex do not count
      available: 24,
      stockStatus: 'ok',
      maxQuantity: 24,
      warehouse: { id: state.centralId, name: 'Central' },
      brand: { name: `SKF${state.run}`, initials: 'SK' },
    });
    expect(items.map((i) => i.id)).toContain(p6205z);
  });

  it('finds by measurement (25x52x15)', async () => {
    const { items } = await fx.as(state.cashier).catalog.search({ q: '25x52x15' });
    expect(items.map((i) => i.id)).toContain(p6205);
  });

  it('finds by brand', async () => {
    const { items } = await fx.as(state.cashier).catalog.search({ q: `skf${state.run}` });
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining([p6205, lowId, outId]));
    expect(items.length).toBeLessThanOrEqual(20);
  });

  it('marks low and out stock, and leaves inactive products out', async () => {
    const { items } = await fx.as(state.cashier).catalog.search({ q: state.run });
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get(lowId)).toMatchObject({ available: 3, stockStatus: 'low' });
    // all its stock is in the annex, not in the register's warehouse
    expect(byId.get(outId)).toMatchObject({ available: 0, stockStatus: 'out', maxQuantity: 0 });
    expect(items.some((i) => i.code.endsWith('-OFF'))).toBe(false);
  });

  it('never returns the cost', async () => {
    const { items } = await fx.as(state.cashier).catalog.search({ q: state.run });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(JSON.stringify(item)).not.toMatch(/cost/i);
  });

  it('filters by a root category, including its subcategories', async () => {
    const bearings = await fx.as(state.cashier).catalog.search({ q: state.run, categoryId: state.bearingsId });
    expect(bearings.items.map((i) => i.id)).toContain(subId);
    expect(bearings.items.map((i) => i.id)).not.toContain(sealId);

    const seals = await fx.as(state.cashier).catalog.search({ q: '', categoryId: state.sealsId });
    expect(seals.items.map((i) => i.id)).toEqual([sealId]);
  });

  it('returns nothing without text nor category', async () => {
    expect((await fx.as(state.cashier).catalog.search({ q: '' })).items).toEqual([]);
  });

  it('lists the active root categories with their icon', async () => {
    const { items } = await fx.as(state.cashier).catalog.categories();
    expect(items).toEqual([
      { id: state.bearingsId, name: 'Rodamientos', icon: 'bearing' },
      { id: state.sealsId, name: 'Retenes', icon: 'seal' },
    ]);
  });

  it('keeps each company to its own products', async () => {
    fx.useCompany(state.otherCompanyId);
    const { items } = await fx.as(state.other).catalog.search({ q: `6205-2RS-${state.run}` });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ available: 99, warehouse: { id: state.otherCentralId } });
    expect(items[0].id).not.toBe(p6205);
  });

  it('refuses without an open cash shift', async () => {
    expect(await codeOf(fx.as(state.noShift).catalog.search({ q: '6205' }))).toBe('CASH_SHIFT_NOT_OPEN');
    expect(await codeOf(fx.as(state.noShift).catalog.categories())).toBe('CASH_SHIFT_NOT_OPEN');
  });
});
