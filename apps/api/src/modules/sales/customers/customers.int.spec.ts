/**
 * Integration test of the customers (HU-VEN-05, HU-VEN-37) against the real Postgres: POS search and quick creation, the
 * NIT check, duplicates (also under concurrency), the full form with the discount and credit flag, the audit of its changes
 * and tenant isolation.
 */
import { IdentityDocumentType } from '@rodasoft/domain';
import { codeOf, createPosFixture, detailsOf } from '../pos/pos.int-fixture';

const fx = createPosFixture('cust');
const { state } = fx;
const { NIT, CI } = IdentityDocumentType;

describe('Customers (integration, real Postgres)', () => {
  beforeAll(() => fx.setup());
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));
  afterEach(async () => {
    await state.base.customer.deleteMany({ where: { companyId: { in: [state.companyId, state.otherCompanyId] } } });
  });

  const customers = () => fx.as(state.cashier).customers;
  const quick = (over: Partial<{ name: string; documentType: number; documentNumber: string; complement: string | null }> = {}) =>
    customers().quickCreate({ name: 'Taller Los Andes', documentType: NIT, documentNumber: '1020304078', ...over });

  describe('quick creation (cashier)', () => {
    it('saves the customer without discount and without credit', async () => {
      const created = await quick();
      expect(created).toMatchObject({
        name: 'Taller Los Andes',
        documentType: NIT,
        documentNumber: '1020304078',
        creditEnabled: false,
        discount: { type: 'NONE', value: '0.00' },
        status: 'ACTIVE',
      });
      const stored = await state.base.customer.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored).toMatchObject({ companyId: state.companyId, createdById: state.cashier.userId });
    });

    it('normalizes the document (spaces, dots and dashes) and the CI complement', async () => {
      const nit = await quick({ documentNumber: '1020 304-078' });
      expect(nit.documentNumber).toBe('1020304078');
      const ci = await quick({ name: 'Juan Pérez', documentType: CI, documentNumber: '4567890', complement: '1a' });
      expect(ci).toMatchObject({ documentNumber: '4567890', complement: '1A' });
    });

    it.each([
      ['a NIT with letters', NIT, '12a45'],
      ['a NIT of zeros (that is the final consumer)', NIT, '0'],
      ['a NIT that is too short', NIT, '123'],
      ['a CI with letters', CI, '45A7890'],
    ])('refuses %s with INVALID_NIT', async (_label, documentType, documentNumber) => {
      expect(await codeOf(quick({ documentType, documentNumber }))).toBe('INVALID_NIT');
      expect(await state.base.customer.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('refuses a complement on a NIT', async () => {
      expect(await codeOf(quick({ complement: '1A' }))).toBe('INVALID_NIT');
    });

    it('refuses a repeated document with CUSTOMER_DOCUMENT_DUPLICATED and answers with the existing customer', async () => {
      const first = await quick();
      const attempt = quick({ name: 'Otro nombre' });
      expect(await codeOf(attempt)).toBe('CUSTOMER_DOCUMENT_DUPLICATED');
      expect(await detailsOf(quick({ name: 'Otro nombre' }))).toMatchObject({ customer: { id: first.id, name: 'Taller Los Andes' } });
    });

    it('two concurrent creations of the same document leave exactly one customer', async () => {
      const results = await Promise.allSettled(Array.from({ length: 4 }, () => quick()));
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await state.base.customer.count({ where: { companyId: state.companyId } })).toBe(1);
    });

    it('the same document in another company is another customer', async () => {
      await quick();
      fx.useCompany(state.otherCompanyId);
      const other = await fx.as(state.other).customers.quickCreate({ name: 'Taller Los Andes', documentType: NIT, documentNumber: '1020304078' });
      expect(other.id).toBeDefined();
    });

    it('audits the creation', async () => {
      const created = await quick();
      const log = await state.base.auditLog.findFirstOrThrow({ where: { entity: 'Customer', entityId: created.id, action: 'sales.customer.create' } });
      expect(log.userId).toBe(state.cashier.userId);
    });
  });

  describe('POS search', () => {
    beforeEach(async () => {
      await quick({ name: 'Taller Los Andes', documentNumber: '1020304078' });
      await quick({ name: 'Transportes Andinos', documentNumber: '2030405060' });
      await quick({ name: 'Juan Pérez', documentType: CI, documentNumber: '4567890' });
    });

    it('finds by name, case-insensitively', async () => {
      const { items } = await customers().search('andi');
      expect(items.map((c) => c.name)).toEqual(['Transportes Andinos']);
      expect((await customers().search('ANDES')).items.map((c) => c.name)).toEqual(['Taller Los Andes']);
    });

    it('finds by NIT or CI, ignoring separators', async () => {
      expect((await customers().search('1020 304')).items.map((c) => c.name)).toEqual(['Taller Los Andes']);
      expect((await customers().search('4567890')).items.map((c) => c.name)).toEqual(['Juan Pérez']);
    });

    it('lists the first customers by name without text, and finds nothing for a stranger', async () => {
      expect((await customers().search('')).items).toHaveLength(3);
      expect((await customers().search('zzz')).items).toEqual([]);
    });

    it('leaves out inactive customers', async () => {
      const [andes] = (await customers().search('ANDES')).items;
      await customers().update(andes.id, { status: 'INACTIVE' });
      expect((await customers().search('ANDES')).items).toEqual([]);
    });

    it('never shows another company’s customers', async () => {
      fx.useCompany(state.otherCompanyId);
      await fx.as(state.other).customers.quickCreate({ name: 'Andes Ajeno', documentType: NIT, documentNumber: '9990001112' });
      fx.useCompany(state.companyId);
      expect((await customers().search('andes')).items.map((c) => c.name)).toEqual(['Taller Los Andes']);
      fx.useCompany(state.otherCompanyId);
      expect((await fx.as(state.other).customers.search('andes')).items.map((c) => c.name)).toEqual(['Andes Ajeno']);
    });
  });

  describe('the full form (Management)', () => {
    const form = (over: Partial<Parameters<ReturnType<typeof customers>['create']>[0]> = {}) => ({
      name: 'Minera Sur',
      documentType: NIT,
      documentNumber: '5550001112',
      creditEnabled: true,
      discountType: 'PERCENT' as const,
      discountValue: '10.00',
      ...over,
    });

    it('creates a customer with the credit flag and a percent discount', async () => {
      const created = await customers().create(form());
      expect(created).toMatchObject({ creditEnabled: true, discount: { type: 'PERCENT', value: '10.00' } });
      expect((await customers().get(created.id)).discount).toEqual({ type: 'PERCENT', value: '10.00' });
    });

    it('creates a customer with a fixed amount per sale', async () => {
      const created = await customers().create(form({ discountType: 'AMOUNT', discountValue: '15.50' }));
      expect(created.discount).toEqual({ type: 'AMOUNT', value: '15.50' });
    });

    it.each([
      ['a percent above 100', 'PERCENT', '100.01'],
      ['a percent of 0', 'PERCENT', '0'],
      ['an amount of 0', 'AMOUNT', '0'],
      ['a value with no discount', 'NONE', '5.00'],
    ] as const)('refuses %s with INVALID_DISCOUNT', async (_label, discountType, discountValue) => {
      expect(await codeOf(customers().create(form({ discountType, discountValue })))).toBe('INVALID_DISCOUNT');
    });

    it('the database also refuses an inconsistent discount', async () => {
      // a distinct document per row, so a refusal can only come from the CHECK and not from the unique index
      const row = (documentNumber: string, over: object) =>
        state.base.customer.create({ data: { companyId: state.companyId, name: 'X', documentType: NIT, documentNumber, ...over } });
      await expect(row('7770001111', { discountType: 'NONE', discountValue: '5' })).rejects.toThrow(/customers_discount_none_check/);
      await expect(row('7770001112', { discountType: 'PERCENT', discountValue: '101' })).rejects.toThrow(/customers_discount_value_check/);
      await expect(row('7770001113', { discountType: 'AMOUNT', discountValue: '-1' })).rejects.toThrow(/customers_discount_value_check/);
    });

    it('changes the discount, keeps the rest, and records who changed what', async () => {
      const created = await customers().create(form());
      const updated = await customers().update(created.id, { discountType: 'AMOUNT', discountValue: '20.00' });
      expect(updated).toMatchObject({ name: 'Minera Sur', creditEnabled: true, discount: { type: 'AMOUNT', value: '20.00' } });

      const log = await state.base.auditLog.findFirstOrThrow({ where: { entity: 'Customer', entityId: created.id, action: 'sales.customer.update' } });
      expect(log.userId).toBe(state.cashier.userId);
      expect(log.createdAt).toBeInstanceOf(Date);
      expect(log.before).toMatchObject({ discountType: 'PERCENT', discountValue: '10.00' });
      expect(log.after).toMatchObject({ discountType: 'AMOUNT', discountValue: '20.00' });
    });

    it('records a change of the credit flag too', async () => {
      const created = await customers().create(form());
      await customers().update(created.id, { creditEnabled: false });
      const log = await state.base.auditLog.findFirstOrThrow({ where: { entity: 'Customer', entityId: created.id, action: 'sales.customer.update' } });
      expect(log.before).toMatchObject({ creditEnabled: true });
      expect(log.after).toMatchObject({ creditEnabled: false });
    });

    it('removing the discount sets the value to 0', async () => {
      const created = await customers().create(form());
      const updated = await customers().update(created.id, { discountType: 'NONE' });
      expect(updated.discount).toEqual({ type: 'NONE', value: '0.00' });
    });

    it('changing the type without a value does not turn a percent into an amount', async () => {
      const created = await customers().create(form({ discountValue: '10.00' }));
      expect(await codeOf(customers().update(created.id, { discountType: 'AMOUNT' }))).toBe('INVALID_DISCOUNT');
    });

    it('refuses to change a customer to a document that another customer has', async () => {
      await customers().create(form());
      const other = await customers().create(form({ documentNumber: '6660001112', name: 'Otra' }));
      expect(await codeOf(customers().update(other.id, { documentNumber: '5550001112' }))).toBe('CUSTOMER_DOCUMENT_DUPLICATED');
    });

    it('validates the document of an edit', async () => {
      const created = await customers().create(form());
      expect(await codeOf(customers().update(created.id, { documentNumber: '12' }))).toBe('INVALID_NIT');
    });

    it('answers CUSTOMER_NOT_FOUND for an unknown customer and for another company’s', async () => {
      const created = await customers().create(form());
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(fx.as(state.other).customers.get(created.id))).toBe('CUSTOMER_NOT_FOUND');
      expect(await codeOf(fx.as(state.other).customers.update(created.id, { name: 'Hackeado' }))).toBe('CUSTOMER_NOT_FOUND');
    });

    it('lists with a filter, a status and pages', async () => {
      for (let i = 1; i <= 3; i += 1) await customers().create(form({ name: `Cliente ${i}`, documentNumber: `10000000${i}` }));
      const inactive = await customers().create(form({ name: 'Cliente 4', documentNumber: '100000004' }));
      await customers().update(inactive.id, { status: 'INACTIVE' });

      const first = await customers().list({ pageSize: 2 });
      expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(first.items.map((c) => c.name)).toEqual(['Cliente 1', 'Cliente 2']);
      expect((await customers().list({ pageSize: 2, page: 2 })).items.map((c) => c.name)).toEqual(['Cliente 3']);
      expect((await customers().list({ status: 'ALL' })).total).toBe(4);
      expect((await customers().list({ status: 'INACTIVE' })).items.map((c) => c.name)).toEqual(['Cliente 4']);
      expect((await customers().list({ q: '100000002' })).items.map((c) => c.name)).toEqual(['Cliente 2']);
    });
  });
});
