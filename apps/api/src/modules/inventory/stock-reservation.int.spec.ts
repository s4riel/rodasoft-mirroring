/**
 * Integration test of `StockReservationService` (HU-VEN-19) against the real Postgres: all-or-nothing reserve, release that
 * never goes below zero (twice, and with more than reserved), invalid quantities, an inactive warehouse, and that
 * `quantity` and the kardex never change. `consume` (HU-VEN-20) takes reserved units out for a dispatch and never goes below zero.
 */
import { codeOf, createPosFixture } from '../sales/pos/pos.int-fixture';
import { StockReservationService } from './stock-reservation.service';

const fx = createPosFixture('reserv');
const { state } = fx;

describe('StockReservationService (integration, real Postgres)', () => {
  beforeAll(() => fx.setup(), 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  const service = () =>
    new StockReservationService({ get: (k: string) => (k === 'companyId' ? state.companyId : null) } as never, fx.settingsService());
  const run = <T>(fn: (tx: never) => Promise<T>) => (fx.useCompany(state.companyId), fx.tenantTransaction(fn));
  const level = (productId: string, warehouseId = state.centralId) => state.base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId } });

  it('reserves and releases without touching quantity or the kardex', async () => {
    const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
    const movements = await state.base.stockMovement.count({ where: { productId: p.id } });
    await run((tx) => service().reserve(tx, state.centralId, [{ productId: p.id, quantity: 4 }]));
    expect(await level(p.id)).toMatchObject({ quantity: 10, reserved: 4 });
    await run((tx) => service().release(tx, state.centralId, [{ productId: p.id, quantity: 4 }]));
    expect(await level(p.id)).toMatchObject({ quantity: 10, reserved: 0 });
    expect(await state.base.stockMovement.count({ where: { productId: p.id } })).toBe(movements);
  });

  it('is all or nothing and names every short product', async () => {
    const ok = await fx.newProduct({ stock: { [state.centralId]: 5 } });
    const short = await fx.newProduct({ stock: { [state.centralId]: 1 } });
    const attempt = run((tx) =>
      service().reserve(tx, state.centralId, [
        { productId: ok.id, quantity: 2 },
        { productId: short.id, quantity: 3 },
      ]),
    );
    expect(await codeOf(attempt)).toBe('INSUFFICIENT_STOCK');
    expect(await level(ok.id)).toMatchObject({ reserved: 0 });
    expect(await level(short.id)).toMatchObject({ reserved: 0 });
  });

  it('releasing twice, or more than was reserved, never goes below zero or frees another order’s units', async () => {
    const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
    await run((tx) => service().reserve(tx, state.centralId, [{ productId: p.id, quantity: 3 }]));
    await run((tx) => service().reserve(tx, state.centralId, [{ productId: p.id, quantity: 2 }]));
    await run((tx) => service().release(tx, state.centralId, [{ productId: p.id, quantity: 3 }]));
    expect(await level(p.id)).toMatchObject({ reserved: 2 });
    await run((tx) => service().release(tx, state.centralId, [{ productId: p.id, quantity: 9 }]));
    expect(await level(p.id)).toMatchObject({ reserved: 0 });
  });

  it('refuses invalid quantities and an inactive or foreign warehouse', async () => {
    const p = await fx.newProduct({ stock: { [state.centralId]: 3 } });
    expect(await codeOf(run((tx) => service().reserve(tx, state.centralId, [{ productId: p.id, quantity: 0 }])))).toBe('INVALID_QUANTITY');
    expect(await codeOf(run((tx) => service().reserve(tx, state.centralId, [{ productId: p.id, quantity: -2 }])))).toBe('INVALID_QUANTITY');
    expect(await codeOf(run((tx) => service().reserve(tx, state.otherCentralId, [{ productId: p.id, quantity: 1 }])))).toBe('SALES_WAREHOUSE_INACTIVE');
    await state.base.warehouse.update({ where: { id: state.annexId }, data: { status: 'INACTIVE' } });
    expect(await codeOf(run((tx) => service().reserve(tx, state.annexId, [{ productId: p.id, quantity: 1 }])))).toBe('SALES_WAREHOUSE_INACTIVE');
    await state.base.warehouse.update({ where: { id: state.annexId }, data: { status: 'ACTIVE' } });
    expect(await level(p.id)).toMatchObject({ reserved: 0 });
  });

  it('a company cannot reserve in or release from another company’s warehouse', async () => {
    const p = await fx.newProduct({ stock: { [state.centralId]: 3 } });
    fx.useCompany(state.otherCompanyId);
    const other = new StockReservationService({ get: (k: string) => (k === 'companyId' ? state.otherCompanyId : null) } as never, fx.settingsService());
    expect(await codeOf(fx.tenantTransaction((tx) => other.reserve(tx as never, state.centralId, [{ productId: p.id, quantity: 1 }])))).toBe(
      'SALES_WAREHOUSE_INACTIVE',
    );
    await fx.tenantTransaction((tx) => other.release(tx as never, state.centralId, [{ productId: p.id, quantity: 1 }]));
    fx.useCompany(state.companyId);
    expect(await level(p.id)).toMatchObject({ reserved: 0 });
  });

  describe('consume (HU-VEN-20)', () => {
    it('takes reserved units out and leaves quantity alone: the movement is the caller’s', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const movements = await state.base.stockMovement.count({ where: { productId: p.id } });
      await run((tx) => service().reserve(tx, state.centralId, [{ productId: p.id, quantity: 5 }]));
      await run((tx) => service().consume(tx, state.centralId, [{ productId: p.id, quantity: 3 }]));
      expect(await level(p.id)).toMatchObject({ quantity: 10, reserved: 2 });
      expect(await state.base.stockMovement.count({ where: { productId: p.id } })).toBe(movements);
    });

    it('refuses to take more than is reserved and changes nothing', async () => {
      const a = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      const b = await fx.newProduct({ stock: { [state.centralId]: 10 } });
      await run((tx) =>
        service().reserve(tx, state.centralId, [
          { productId: a.id, quantity: 4 },
          { productId: b.id, quantity: 1 },
        ]),
      );
      const attempt = run((tx) =>
        service().consume(tx, state.centralId, [
          { productId: a.id, quantity: 2 },
          { productId: b.id, quantity: 2 },
        ]),
      );
      expect(await codeOf(attempt)).toBe('RESERVATION_SHORT');
      expect(await level(a.id)).toMatchObject({ reserved: 4 });
      expect(await level(b.id)).toMatchObject({ reserved: 1 });
    });

    it('refuses units that were never reserved (no level) and invalid quantities', async () => {
      const p = await fx.newProduct({ stock: { [state.centralId]: 3 } });
      expect(await codeOf(run((tx) => service().consume(tx, state.centralId, [{ productId: p.id, quantity: 1 }])))).toBe('RESERVATION_SHORT');
      expect(await codeOf(run((tx) => service().consume(tx, state.centralId, [{ productId: p.id, quantity: 0 }])))).toBe('INVALID_QUANTITY');
    });
  });
});
