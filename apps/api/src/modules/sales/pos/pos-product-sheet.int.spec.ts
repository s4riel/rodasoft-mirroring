/**
 * Integration test of the POS product sheet (HU-VEN-04) against the real Postgres: the fields of VP-03e, the stock of the
 * register's warehouse and per branch, the equivalents (with and without stock), no cost at all, read only, tenant
 * isolation and the open shift requirement.
 */
import { codeOf, createPosFixture } from './pos.int-fixture';

const fx = createPosFixture('possheet');
const { state } = fx;

const D = { innerDiameter: '25', outerDiameter: '52', width: '15' };
const seal = (value: string) => ({ seal: value });

describe('POS product sheet (integration, real Postgres)', () => {
  let product: string;
  let exact: string;
  let different: string;
  let noStock: string;
  let incompatible: string;
  let pending: string;
  let inactiveEquivalent: string;
  let inactive: string;
  let foreign: string;

  beforeAll(async () => {
    await fx.setup();
    const sacaba = await fx.newBranch('Sacaba');
    const make = (code: string, over: Parameters<typeof fx.newProduct>[0] = {}) =>
      fx.newProduct({ code: `${code}-${state.run}`, dimensions: D, attributes: seal('2RS'), ...over }).then((p) => p.id);

    product = await make('6205', {
      stock: { [state.centralId]: 24, [state.annexId]: 6, [sacaba]: 10 },
      reserved: { [state.centralId]: 4 },
      minStock: { [state.centralId]: 5, [sacaba]: 2 },
      photos: ['a/photo/6205_v1.jpg', 'a/photo/6205_v2.jpg'],
      sectors: ['Minería', 'Agroindustria'],
    });
    exact = await make('E1', { stock: { [state.centralId]: 3 } });
    different = await make('E2', { attributes: seal('2Z'), stock: { [state.centralId]: 9 } });
    noStock = await make('E3');
    incompatible = await make('X1', { dimensions: { innerDiameter: '25', outerDiameter: '52', width: '20' }, stock: { [state.centralId]: 30 } });
    pending = await make('P1', { stock: { [state.centralId]: 5 } });
    inactiveEquivalent = await make('I1', { status: 'INACTIVE', stock: { [state.centralId]: 5 } });
    inactive = await make('IN', { status: 'INACTIVE', stock: { [state.centralId]: 5 } });
    await fx.link(product, exact);
    await fx.link(product, different, { notes: 'blindaje metálico' });
    await fx.link(product, noStock);
    await fx.link(product, incompatible);
    await fx.link(product, pending, { approved: false });
    await fx.link(product, inactiveEquivalent);

    fx.useCompany(state.otherCompanyId);
    foreign = (
      await fx.newProduct({
        companyId: state.otherCompanyId,
        brandId: state.otherBrandId,
        categoryId: state.otherCategoryId,
        stock: { [state.otherCentralId]: 1 },
      })
    ).id;
  });

  afterAll(() => fx.teardown());

  beforeEach(async () => {
    fx.useCompany(state.companyId);
    await fx.setRequireApproval(false);
  });

  const sheet = (id = product, caller = state.cashier) => fx.as(caller).sheet.sheet(id);

  it('has the brand, measurements, photos, sectors, price and the stock of my warehouse', async () => {
    const res = await sheet();
    expect(res.product).toMatchObject({
      id: product,
      manufacturerCode: `6205-${state.run}`,
      name: 'Rodamiento rígido de bolas',
      brand: { name: `SKF${state.run}` },
      dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15' },
      salePrice: '245.00',
      photos: ['a/photo/6205_v1.jpg', 'a/photo/6205_v2.jpg'],
      sectors: ['Minería', 'Agroindustria'],
    });
    expect(res.warehouse).toEqual({ id: state.centralId, name: 'Central' });
    expect(res.branchId).toBe(state.branchId);
    // 24 − 4 reserved; minimum 5 → ok
    expect(res).toMatchObject({ available: 20, stockStatus: 'ok', maxQuantity: 20 });
  });

  it('gives the stock per branch with minimum and maximum, and the total', async () => {
    const { product: p } = await sheet();
    const central = p.stockByBranch.find((b) => b.branchId === state.branchId);
    const sacaba = p.stockByBranch.find((b) => b.branchName === 'Sacaba');
    // central branch: Central 24 + Anexo 6 = 30
    expect(central).toMatchObject({ quantity: 30, minStock: 5 });
    expect(sacaba).toMatchObject({ quantity: 10, minStock: 2 });
    expect(p.totalStock).toBe(40);
  });

  it('marks the stock low at the minimum, and has no limit with negative stock allowed', async () => {
    const lowId = await fx
      .newProduct({ code: `LOW-${state.run}`, stock: { [state.centralId]: 5 }, minStock: { [state.centralId]: 5 } })
      .then((p) => p.id);
    expect(await sheet(lowId)).toMatchObject({ available: 5, stockStatus: 'low', maxQuantity: 5 });

    await fx.setAllowNegativeStock(true);
    try {
      expect(await sheet(lowId)).toMatchObject({ maxQuantity: null });
    } finally {
      await fx.setAllowNegativeStock(false);
    }
  });

  it('lists compatible approved equivalents with or without stock, exact first', async () => {
    const { equivalents } = await sheet();
    // approval is not required here, so the pending link counts too
    expect(equivalents.map((e) => [e.productId, e.available, e.kind])).toEqual([
      [pending, 5, 'EXACT'],
      [exact, 3, 'EXACT'],
      [noStock, 0, 'EXACT'],
      [different, 9, 'WITH_DIFFERENCES'],
    ]);
    expect(equivalents.find((e) => e.productId === different)).toMatchObject({
      notes: 'blindaje metálico',
      differences: [{ key: 'seal', source: '2RS', other: '2Z' }],
    });
  });

  it('leaves out incompatible and inactive equivalents, and pending links when approval is required', async () => {
    const ids = (await sheet()).equivalents.map((e) => e.productId);
    expect(ids).not.toContain(incompatible);
    expect(ids).not.toContain(inactiveEquivalent);

    await fx.setRequireApproval(true);
    const required = (await sheet()).equivalents.map((e) => e.productId);
    expect(required).not.toContain(pending);
    expect(required).toContain(exact);
  });

  it('never returns cost, margin or audit actors, although the product has a cost', async () => {
    const json = JSON.stringify(await sheet());
    expect(json).not.toMatch(/cost|margin/i);
    expect(json).not.toMatch(/createdBy|updatedBy/);
    const row = await state.base.product.findUniqueOrThrow({ where: { id: product } });
    expect(row.cost).not.toBeNull();
  });

  it('only reads: stock, movements, audit and outbox are the same after the call', async () => {
    const count = async () => [
      await state.base.stockLevel.count({ where: { companyId: state.companyId } }),
      await state.base.stockMovement.count({ where: { companyId: state.companyId } }),
      (await state.base.stockLevel.aggregate({ where: { companyId: state.companyId }, _sum: { quantity: true, reserved: true } }))._sum,
      await state.base.auditLog.count({ where: { companyId: state.companyId } }),
      await state.base.outboxEvent.count({ where: { companyId: state.companyId } }),
    ];
    const before = await count();
    await sheet();
    expect(await count()).toEqual(before);
  });

  it('answers PRODUCT_NOT_FOUND for an inactive product, an unknown one and one of another company', async () => {
    expect(await codeOf(sheet(inactive))).toBe('PRODUCT_NOT_FOUND');
    expect(await codeOf(sheet('00000000-0000-4000-8000-000000000000'))).toBe('PRODUCT_NOT_FOUND');
    expect(await codeOf(sheet(foreign))).toBe('PRODUCT_NOT_FOUND');
    fx.useCompany(state.otherCompanyId);
    expect(await codeOf(sheet(product, state.other))).toBe('PRODUCT_NOT_FOUND');
    expect((await sheet(foreign, state.other)).warehouse.id).toBe(state.otherCentralId);
  });

  it('answers CASH_SHIFT_NOT_OPEN without an open shift', async () => {
    expect(await codeOf(sheet(product, state.noShift))).toBe('CASH_SHIFT_NOT_OPEN');
  });
});
