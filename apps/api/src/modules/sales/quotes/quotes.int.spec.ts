/**
 * Integration test of the quotes (HU-VEN-16) against the real Postgres: creation with server-side prices, customer discount
 * and rounding, the validity rules, numbering under concurrency, the list and its filters, the editor search without costs,
 * and tenant isolation.
 */
import { codeOf, createPosFixture } from '../pos/pos.int-fixture';

const fx = createPosFixture('quotes');
const { state } = fx;

describe('Quotes (integration, real Postgres)', () => {
  beforeAll(() => fx.setup(), 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));
  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.quote.deleteMany({ where: { companyId: state.companyId } });
    await state.base.customer.deleteMany({ where: { companyId: state.companyId } });
    await state.base.documentSequence.deleteMany({ where: { companyId: state.companyId } });
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
  });

  const svc = () => fx.as(state.cashier).quotes;
  let docSeq = 0;
  const customer = (opts: { name?: string; discountType?: 'NONE' | 'PERCENT' | 'AMOUNT'; discountValue?: string; companyId?: string } = {}) => {
    docSeq += 1;
    return state.base.customer.create({
      data: {
        companyId: opts.companyId ?? state.companyId,
        name: opts.name ?? 'Cliente Prueba',
        documentType: 1,
        documentNumber: `${1000000 + docSeq}`,
        discountType: opts.discountType ?? 'NONE',
        discountValue: opts.discountValue ?? '0',
      },
    });
  };
  const todayPlus = (days: number) => new Date(Date.now() - 4 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);

  describe('create', () => {
    it('creates a draft COT-000001 with prices from the product, never from the client', async () => {
      const c = await customer();
      const a = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 10 } });
      const b = await fx.newProduct({ price: '25.50' });
      const quote = await svc().create({
        customerId: c.id,
        lines: [
          { productId: a.id, quantity: 2 },
          { productId: b.id, quantity: 4 },
        ],
      });
      expect(quote.number).toBe('COT-000001');
      expect(quote.status).toBe('DRAFT');
      expect(quote.lines.map((l) => [l.unitPrice, l.lineTotal])).toEqual([
        ['100.00', '200.00'],
        ['25.50', '102.00'],
      ]);
      expect(quote.subtotal).toBe('302.00');
      expect(quote.total).toBe('302.00');
      expect(quote.convertible).toBe(true);
      // nothing is reserved by a quote
      const level = await state.base.stockLevel.findFirstOrThrow({ where: { productId: a.id, warehouseId: state.centralId } });
      expect(level.reserved).toBe(0);
    });

    it('defaults the validity to today plus sales.quoteValidityDays', async () => {
      const c = await customer();
      const p = await fx.newProduct();
      const quote = await svc().create({ customerId: c.id, lines: [{ productId: p.id, quantity: 1 }] });
      expect(quote.validUntil).toBe(todayPlus(7));
      await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'sales.quoteValidityDays', value: 15 } });
      const longer = await svc().create({ customerId: c.id, lines: [{ productId: p.id, quantity: 1 }] });
      expect(longer.validUntil).toBe(todayPlus(15));
    });

    it('applies the customer discount and the rounding mode', async () => {
      const c = await customer({ discountType: 'PERCENT', discountValue: '10.00' });
      const p = await fx.newProduct({ price: '33.33' });
      await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'sales.roundingMode', value: 'INTEGER' } });
      const quote = await svc().create({ customerId: c.id, lines: [{ productId: p.id, quantity: 3 }] });
      // 99.99 − 10% (10.00) = 89.99 → 90.00
      expect(quote.subtotal).toBe('99.99');
      expect(quote.discountAmount).toBe('10.00');
      expect(quote.roundingAmount).toBe('0.01');
      expect(quote.total).toBe('90.00');
    });

    it('refuses a bad validity, an empty quote, bad quantities, and unknown or inactive records', async () => {
      const c = await customer();
      const p = await fx.newProduct();
      const line = { productId: p.id, quantity: 1 };
      expect(await codeOf(svc().create({ customerId: c.id, validUntil: todayPlus(-1), lines: [line] }))).toBe('QUOTE_VALIDITY_IN_PAST');
      expect(await codeOf(svc().create({ customerId: c.id, validUntil: '2026-02-30', lines: [line] }))).toBe('QUOTE_VALIDITY_INVALID');
      expect(await codeOf(svc().create({ customerId: c.id, validUntil: todayPlus(400), lines: [line] }))).toBe('QUOTE_VALIDITY_TOO_FAR');
      expect(await codeOf(svc().create({ customerId: c.id, lines: [] }))).toBe('QUOTE_EMPTY');
      expect(await codeOf(svc().create({ customerId: c.id, lines: [{ productId: p.id, quantity: 0 }] }))).toBe('INVALID_QUANTITY');
      expect(await codeOf(svc().create({ customerId: c.id, lines: [{ productId: '019a0000-0000-7000-8000-000000000000', quantity: 1 }] }))).toBe(
        'PRODUCT_NOT_FOUND',
      );
      const inactive = await fx.newProduct({ status: 'INACTIVE' });
      expect(await codeOf(svc().create({ customerId: c.id, lines: [{ productId: inactive.id, quantity: 1 }] }))).toBe('PRODUCT_INACTIVE');
      expect(await codeOf(svc().create({ customerId: '019a0000-0000-7000-8000-000000000000', lines: [line] }))).toBe('CUSTOMER_NOT_FOUND');
      const off = await state.base.customer.update({ where: { id: c.id }, data: { status: 'INACTIVE' } });
      expect(await codeOf(svc().create({ customerId: off.id, lines: [line] }))).toBe('CUSTOMER_INACTIVE');
      expect(await state.base.quote.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('gives 20 concurrent quotes 20 distinct numbers', async () => {
      const c = await customer();
      const p = await fx.newProduct();
      const made = await Promise.all(Array.from({ length: 20 }, () => svc().create({ customerId: c.id, lines: [{ productId: p.id, quantity: 1 }] })));
      expect(new Set(made.map((q) => q.number)).size).toBe(20);
    });

    it('audits the creation', async () => {
      const c = await customer();
      const p = await fx.newProduct();
      const quote = await svc().create({ customerId: c.id, lines: [{ productId: p.id, quantity: 1 }] });
      expect(await state.base.auditLog.count({ where: { entity: 'Quote', entityId: quote.id, action: 'sales.quote.create' } })).toBe(1);
    });
  });

  describe('list and detail', () => {
    it('lists newest first with filters by status and text, and reads a sent quote past its day as expired', async () => {
      const ana = await customer({ name: 'Ana Rojas' });
      const luis = await customer({ name: 'Luis Vega' });
      const p = await fx.newProduct();
      const line = { productId: p.id, quantity: 1 };
      const first = await svc().create({ customerId: ana.id, lines: [line] });
      const second = await svc().create({ customerId: luis.id, lines: [line] });
      await state.base.quote.update({ where: { id: first.id }, data: { status: 'SENT', validUntil: new Date(`${todayPlus(-2)}T00:00:00Z`) } });

      const all = await svc().list({});
      expect(all.items.map((q) => q.number)).toEqual([second.number, first.number]);
      expect(all.items[1].status).toBe('EXPIRED');
      expect(all.items.map((q) => q.itemsCount)).toEqual([1, 1]);
      expect((await svc().list({ status: 'EXPIRED' })).items.map((q) => q.number)).toEqual([first.number]);
      expect((await svc().list({ status: 'SENT' })).items).toHaveLength(0);
      expect((await svc().list({ status: 'DRAFT' })).items.map((q) => q.number)).toEqual([second.number]);
      expect((await svc().list({ q: 'rojas' })).items.map((q) => q.number)).toEqual([first.number]);
      expect((await svc().list({ q: second.number })).items.map((q) => q.number)).toEqual([second.number]);
      const paged = await svc().list({ page: 2, pageSize: 1 });
      expect(paged.total).toBe(2);
      expect(paged.items.map((q) => q.number)).toEqual([first.number]);
    });

    it('returns the detail with its lines, and 404 for another company’s quote', async () => {
      const c = await customer();
      const p = await fx.newProduct({ price: '10.00', code: 'DETAIL-1' });
      const quote = await svc().create({ customerId: c.id, lines: [{ productId: p.id, quantity: 3 }] });
      const detail = await svc().detail(quote.id);
      expect(detail.lines).toMatchObject([{ code: 'DETAIL-1', quantity: 3, unitPrice: '10.00', lineTotal: '30.00' }]);
      expect(detail.customer.name).toBe('Cliente Prueba');
      expect(detail.createdByName).toBe('User cashier');
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc().detail(quote.id))).toBe('QUOTE_NOT_FOUND');
      expect((await svc().list({})).total).toBe(0);
    });
  });

  describe('editor search', () => {
    it('searches products with the available stock of the warehouse and no costs', async () => {
      const p = await fx.newProduct({ code: 'QSEARCH-9', stock: { [state.centralId]: 12 }, reserved: { [state.centralId]: 5 } });
      const res = await svc().searchProducts('QSEARCH-9', state.centralId);
      expect(res.items).toHaveLength(1);
      expect(res.items[0]).toMatchObject({ id: p.id, available: 7 });
      expect(JSON.stringify(res)).not.toMatch(/cost/i);
      expect((await svc().searchProducts('QSEARCH-9', state.annexId)).items[0].available).toBe(0);
      expect(await codeOf(svc().searchProducts('x', '019a0000-0000-7000-8000-000000000000'))).toBe('SALES_WAREHOUSE_NOT_FOUND');
    });

    it('offers the default validity and the active warehouses, the main one first', async () => {
      const ctx = await svc().context();
      expect(ctx.validityDays).toBe(7);
      expect(ctx.defaultValidUntil).toBe(todayPlus(7));
      expect(ctx.warehouses.map((w) => w.id)).toEqual(expect.arrayContaining([state.centralId, state.annexId]));
    });
  });
});
