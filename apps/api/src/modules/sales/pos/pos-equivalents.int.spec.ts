/**
 * Integration test of the POS equivalents (HU-VEN-03) against the real Postgres: the link works in both directions,
 * incompatible, pending, inactive and out-of-stock equivalents are left out, the stock is the register warehouse's
 * `quantity − reserved`, the other-branches line, no cost, tenant isolation and the open shift requirement.
 */
import { codeOf, createPosFixture } from './pos.int-fixture';

const fx = createPosFixture('poseq');
const { state } = fx;

const D = { innerDiameter: '40', outerDiameter: '80', width: '18' };
const seal = (value: string) => ({ seal: value });

describe('POS equivalents (integration, real Postgres)', () => {
  let original: string;
  let exactSmall: string;
  let exactBig: string;
  let different: string;
  let reverse: string;
  let incompatible: string;
  let pending: string;
  let inactive: string;
  let noStock: string;
  let annexOnly: string;
  let reservedAll: string;
  let substitute: string;
  let foreign: string;

  beforeAll(async () => {
    await fx.setup();
    const sacaba = await fx.newBranch('Sacaba');
    const panamericana = await fx.newBranch('Panamericana');
    const closedBranch = await fx.newBranch('Cerrada', { status: 'INACTIVE' });
    const emptyBranch = await fx.newBranch('Vacía');

    const make = (code: string, over: Parameters<typeof fx.newProduct>[0] = {}) =>
      fx.newProduct({ code: `${code}-${state.run}`, dimensions: D, attributes: seal('2RS'), ...over }).then((p) => p.id);

    // the original is out of stock in the register's warehouse (Central), with stock elsewhere
    original = await make('6208', {
      // the empty branch holds 3, all reserved: nothing available
      stock: { [state.annexId]: 9, [sacaba]: 4, [panamericana]: 2, [closedBranch]: 7, [emptyBranch]: 3 },
      reserved: { [emptyBranch]: 3 },
    });
    exactSmall = await make('E1', { stock: { [state.centralId]: 3 } });
    exactBig = await make('E2', { stock: { [state.centralId]: 12 }, reserved: { [state.centralId]: 2 } });
    different = await make('E3', { attributes: seal('2Z'), stock: { [state.centralId]: 50 } });
    reverse = await make('E4', { stock: { [state.centralId]: 1 } });
    incompatible = await make('X1', { dimensions: { innerDiameter: '40', outerDiameter: '80', width: '20' }, stock: { [state.centralId]: 30 } });
    pending = await make('P1', { stock: { [state.centralId]: 5 } });
    inactive = await make('I1', { status: 'INACTIVE', stock: { [state.centralId]: 5 } });
    noStock = await make('N1');
    annexOnly = await make('A1', { stock: { [state.annexId]: 20 } });
    reservedAll = await make('R1', { stock: { [state.centralId]: 4 }, reserved: { [state.centralId]: 4 } });
    substitute = await make('S1', { stock: { [state.centralId]: 6 } });

    await fx.link(original, exactSmall);
    await fx.link(original, exactBig);
    await fx.link(original, different, { notes: 'blindaje metálico en vez de sello' });
    // linked from the equivalent's side: the pair is stored once, in canonical order
    await fx.link(reverse, original);
    await fx.link(original, incompatible);
    await fx.link(original, pending, { approved: false });
    await fx.link(original, inactive);
    await fx.link(original, noStock);
    await fx.link(original, annexOnly);
    await fx.link(original, reservedAll);
    await fx.link(original, substitute, { substitute: true });

    // another company: a product with the same code, never visible to the first
    fx.useCompany(state.otherCompanyId);
    foreign = (
      await fx.newProduct({
        code: `6208-${state.run}`,
        companyId: state.otherCompanyId,
        brandId: state.otherBrandId,
        categoryId: state.otherCategoryId,
        dimensions: D,
        stock: { [state.otherCentralId]: 1 },
      })
    ).id;
  });

  afterAll(() => fx.teardown());

  beforeEach(async () => {
    fx.useCompany(state.companyId);
    await fx.setRequireApproval(false);
  });

  const list = (id = original) => fx.as(state.cashier).equivalents.list(id);

  it('offers exact equivalents first, then by stock, with the available stock of the register warehouse', async () => {
    const res = await list();
    expect(res.warehouse).toEqual({ id: state.centralId, name: 'Central' });
    expect(res.original).toMatchObject({ id: original, available: 0 });
    // approval is not required here, so the pending link counts too.
    // exact: E2 (12 − 2 reserved = 10), S1 (6), P1 (5), E1 (3), E4 (1); then with differences: E3 (50)
    expect(res.items.map((i) => [i.productId, i.available, i.kind])).toEqual([
      [exactBig, 10, 'EXACT'],
      [substitute, 6, 'EXACT'],
      [pending, 5, 'EXACT'],
      [exactSmall, 3, 'EXACT'],
      [reverse, 1, 'EXACT'],
      [different, 50, 'WITH_DIFFERENCES'],
    ]);
  });

  it('says how each one differs: kind, differences, substitute, notes and measures', async () => {
    const { items } = await list();
    const byId = new Map(items.map((i) => [i.productId, i]));
    expect(byId.get(different)).toMatchObject({
      kind: 'WITH_DIFFERENCES',
      differences: [{ key: 'seal', label: 'seal', source: '2RS', other: '2Z' }],
      notes: 'blindaje metálico en vez de sello',
      substitute: false,
    });
    expect(byId.get(exactSmall)).toMatchObject({
      kind: 'EXACT',
      differences: [],
      notes: null,
      measures: { innerDiameter: '40', outerDiameter: '80', width: '18' },
      salePrice: '245.00',
      brand: { name: `SKF${state.run}`, initials: 'SK' },
      code: `E1-${state.run}`,
    });
    expect(byId.get(substitute)).toMatchObject({ substitute: true });
  });

  it('finds the link from either side (A→B and B→A)', async () => {
    expect((await list()).items.map((i) => i.productId)).toContain(reverse);

    // asked from the equivalent: the original is now the equivalent, and it has stock only in the annex
    const back = await list(reverse);
    expect(back.original).toMatchObject({ id: reverse, available: 1 });
    expect(back.items.map((i) => i.productId)).not.toContain(reverse);
    expect(back.items.map((i) => i.productId)).toEqual([]);
  });

  it('leaves out incompatible, inactive, empty and out-of-stock equivalents', async () => {
    const ids = (await list()).items.map((i) => i.productId);
    for (const left of [incompatible, inactive, noStock, annexOnly, reservedAll]) expect(ids).not.toContain(left);
  });

  it('offers a pending link only when approval is not required', async () => {
    expect((await list()).items.map((i) => i.productId)).toContain(pending);

    await fx.setRequireApproval(true);
    const required = (await list()).items.map((i) => i.productId);
    expect(required).not.toContain(pending);
    // links saved approved keep showing
    expect(required).toContain(exactSmall);
  });

  it('lists the original in other active branches with stock, highest first, leaving out mine and the empty ones', async () => {
    const { otherBranches } = await list();
    expect(otherBranches).toEqual([
      { branchName: 'Sacaba', available: 4 },
      { branchName: 'Panamericana', available: 2 },
    ]);
  });

  it('returns no other branches when the product is in stock nowhere else', async () => {
    expect((await list(exactSmall)).otherBranches).toEqual([]);
  });

  it('only reads: stock levels and movements are the same after the call', async () => {
    const count = async () => [
      await fx.state.base.stockLevel.count({ where: { companyId: state.companyId } }),
      await fx.state.base.stockMovement.count({ where: { companyId: state.companyId } }),
      (await fx.state.base.stockLevel.aggregate({ where: { companyId: state.companyId }, _sum: { quantity: true, reserved: true } }))._sum,
    ];
    const before = await count();
    await list();
    expect(await count()).toEqual(before);
  });

  it('never returns the cost', async () => {
    const res = await list();
    expect(res.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(res)).not.toMatch(/cost/i);
  });

  it('keeps each company to its own products', async () => {
    expect(await codeOf(list(foreign))).toBe('PRODUCT_NOT_FOUND');
    fx.useCompany(state.otherCompanyId);
    expect(await codeOf(fx.as(state.other).equivalents.list(original))).toBe('PRODUCT_NOT_FOUND');
    const own = await fx.as(state.other).equivalents.list(foreign);
    expect(own.items).toEqual([]);
    expect(own.warehouse.id).toBe(state.otherCentralId);
  });

  it('refuses an unknown product, and a call without an open cash shift', async () => {
    expect(await codeOf(list('00000000-0000-4000-8000-000000000000'))).toBe('PRODUCT_NOT_FOUND');
    expect(await codeOf(fx.as(state.noShift).equivalents.list(original))).toBe('CASH_SHIFT_NOT_OPEN');
  });
});
