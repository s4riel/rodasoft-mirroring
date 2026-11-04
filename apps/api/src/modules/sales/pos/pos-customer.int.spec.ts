/**
 * Integration test of the customer of the POS cart (HU-VEN-05, HU-VEN-37) against the real Postgres: choosing a customer or a
 * final consumer, the customer's discount in the server totals (equal to `cartTotals()`), the invoice data check, and the
 * rules about inactive customers, other companies and carts that are no longer editable.
 */
import { cartTotals, FINAL_CONSUMER, IdentityDocumentType } from '@rodasoft/domain';
import { codeOf, createPosFixture } from './pos.int-fixture';

const fx = createPosFixture('poscus');
const { state } = fx;
const { NIT, CI } = IdentityDocumentType;

describe('POS cart customer (integration, real Postgres)', () => {
  let bearing: string;

  beforeAll(async () => {
    await fx.setup();
    bearing = (await fx.newProduct({ price: '245.00', stock: { [state.centralId]: 50 } })).id;
  });
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));
  afterEach(async () => {
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.customer.deleteMany({ where: { companyId: state.companyId } });
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'sales.roundingMode' } });
  });

  const cashier = () => fx.as(state.cashier);
  const customer = (over: Partial<Parameters<ReturnType<typeof cashier>['customers']['create']>[0]> = {}) =>
    cashier().customers.create({
      name: 'Minera Sur',
      documentType: NIT,
      documentNumber: '5550001112',
      creditEnabled: false,
      discountType: 'NONE',
      discountValue: '0',
      ...over,
    });

  it('a cart has no customer (final consumer) until one is chosen', async () => {
    const { checkout } = await cashier().checkout.addItem({ productId: bearing, quantity: 1 });
    expect(checkout?.customer).toBeNull();
    expect(await cashier().checkout.invoiceData()).toEqual({ ...FINAL_CONSUMER, finalConsumer: true });
  });

  it('invoices a final consumer without creating a customer row', async () => {
    const { checkout } = await cashier().checkout.setCustomer(null);
    expect(checkout).toMatchObject({ status: 'OPEN', customer: null });
    expect(await state.base.customer.count({ where: { companyId: state.companyId } })).toBe(0);
    const stored = await state.base.posCheckout.findFirstOrThrow({ where: { companyId: state.companyId } });
    expect(stored.customerId).toBeNull();
  });

  it('links the customer to my cart, creating the cart when there is none', async () => {
    const minera = await customer();
    const { checkout } = await cashier().checkout.setCustomer(minera.id);
    expect(checkout?.customer).toMatchObject({ id: minera.id, name: 'Minera Sur' });
    const stored = await state.base.posCheckout.findFirstOrThrow({ where: { companyId: state.companyId } });
    expect(stored.customerId).toBe(minera.id);
    // the customer stays when products are added afterwards, and the cart is read back with it
    await cashier().checkout.addItem({ productId: bearing, quantity: 1 });
    expect((await cashier().checkout.current()).checkout?.customer?.id).toBe(minera.id);
  });

  it('going back to a final consumer removes the customer and the discount', async () => {
    const minera = await customer({ discountType: 'PERCENT', discountValue: '10.00' });
    await cashier().checkout.addItem({ productId: bearing, quantity: 2 });
    await cashier().checkout.setCustomer(minera.id);
    const { checkout } = await cashier().checkout.setCustomer(null);
    expect(checkout).toMatchObject({ customer: null, discount: '0.00', total: '490.00' });
    expect(checkout?.pricing.discount).toBeNull();
  });

  it('a percent discount lowers the server total, and the total equals cartTotals()', async () => {
    const minera = await customer({ discountType: 'PERCENT', discountValue: '10.00' });
    await cashier().checkout.addItem({ productId: bearing, quantity: 2 });
    const { checkout } = await cashier().checkout.setCustomer(minera.id);
    expect(checkout).toMatchObject({ subtotal: '490.00', discount: '49.00', total: '441.00' });
    expect(checkout?.pricing.discount).toEqual({ type: 'PERCENT', value: '10.00' });

    // the ERP feeds `pricing` to the same function and gets the same numbers
    const local = cartTotals(checkout!.lines, checkout!.pricing);
    expect([local.subtotal.toString(), local.discount.toString(), local.total.toString()]).toEqual(['490.00', '49.00', '441.00']);
  });

  it('a fixed amount per sale is taken once from the whole sale', async () => {
    const minera = await customer({ discountType: 'AMOUNT', discountValue: '15.50' });
    await cashier().checkout.setCustomer(minera.id);
    await cashier().checkout.addItem({ productId: bearing, quantity: 1 });
    const { checkout } = await cashier().checkout.addItem({ productId: bearing, quantity: 1 });
    expect(checkout).toMatchObject({ subtotal: '490.00', discount: '15.50', total: '474.50' });
  });

  it('the total never goes below 0', async () => {
    const minera = await customer({ discountType: 'AMOUNT', discountValue: '1000.00' });
    await cashier().checkout.setCustomer(minera.id);
    const { checkout } = await cashier().checkout.addItem({ productId: bearing, quantity: 1 });
    expect(checkout).toMatchObject({ subtotal: '245.00', discount: '245.00', total: '0.00' });
  });

  it('rounds after the discount with the company setting', async () => {
    await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'sales.roundingMode', value: 'INTEGER' } });
    const minera = await customer({ discountType: 'PERCENT', discountValue: '10.00' });
    await cashier().checkout.setCustomer(minera.id);
    // 245.00 − 24.50 = 220.50 → 221.00
    const { checkout } = await cashier().checkout.addItem({ productId: bearing, quantity: 1 });
    expect(checkout?.total).toBe('221.00');
  });

  it('a change of the customer’s discount reaches the open cart on its next read', async () => {
    const minera = await customer({ discountType: 'PERCENT', discountValue: '10.00' });
    await cashier().checkout.setCustomer(minera.id);
    await cashier().checkout.addItem({ productId: bearing, quantity: 1 });
    await cashier().customers.update(minera.id, { discountValue: '20.00' });
    expect((await cashier().checkout.current()).checkout).toMatchObject({ discount: '49.00', total: '196.00' });
  });

  it('refuses an unknown customer, another company’s customer and an inactive one', async () => {
    const minera = await customer();
    await cashier().customers.update(minera.id, { status: 'INACTIVE' });
    expect(await codeOf(cashier().checkout.setCustomer(minera.id))).toBe('CUSTOMER_INACTIVE');
    expect(await codeOf(cashier().checkout.setCustomer('00000000-0000-7000-8000-000000000000'))).toBe('CUSTOMER_NOT_FOUND');

    fx.useCompany(state.otherCompanyId);
    const ajeno = await fx.as(state.other).customers.create({
      name: 'Ajeno',
      documentType: NIT,
      documentNumber: '8880001112',
      creditEnabled: false,
      discountType: 'NONE',
      discountValue: '0',
    });
    fx.useCompany(state.companyId);
    expect(await codeOf(cashier().checkout.setCustomer(ajeno.id))).toBe('CUSTOMER_NOT_FOUND');
    await state.base.customer.deleteMany({ where: { companyId: state.otherCompanyId } });
  });

  it('cannot change the customer of a cart that is no longer OPEN', async () => {
    const minera = await customer();
    const { checkout } = await cashier().checkout.addItem({ productId: bearing, quantity: 1 });
    await state.base.posCheckout.update({ where: { id: checkout!.id }, data: { status: 'PAYING' } });
    // no OPEN cart is left, so a new one is created for the customer instead of touching the paying one
    const next = await cashier().checkout.setCustomer(minera.id);
    expect(next.checkout?.id).not.toBe(checkout!.id);
    expect((await state.base.posCheckout.findUniqueOrThrow({ where: { id: checkout!.id } })).customerId).toBeNull();
  });

  it('needs an open shift', async () => {
    const minera = await customer();
    expect(await codeOf(fx.as(state.noShift).checkout.setCustomer(minera.id))).toBe('CASH_SHIFT_NOT_OPEN');
    expect(await codeOf(fx.as(state.noShift).checkout.invoiceData())).toBe('CASH_SHIFT_NOT_OPEN');
  });

  describe('invoice data (the NIT is validated before invoicing)', () => {
    it('gives the customer’s name and normalized document', async () => {
      const minera = await customer();
      await cashier().checkout.setCustomer(minera.id);
      expect(await cashier().checkout.invoiceData()).toEqual({
        name: 'Minera Sur',
        documentType: NIT,
        documentNumber: '5550001112',
        complement: null,
        finalConsumer: false,
      });
    });

    it('carries the complement of a CI', async () => {
      const juan = await customer({ name: 'Juan Pérez', documentType: CI, documentNumber: '4567890', complement: '1A' });
      await cashier().checkout.setCustomer(juan.id);
      expect(await cashier().checkout.invoiceData()).toMatchObject({ documentType: CI, documentNumber: '4567890', complement: '1A', finalConsumer: false });
    });

    it('refuses a cart whose customer has an invalid document (a row that bypassed the form)', async () => {
      const bad = await state.base.customer.create({
        data: { companyId: state.companyId, name: 'Mal importado', documentType: NIT, documentNumber: '12a45' },
      });
      await cashier().checkout.setCustomer(bad.id);
      expect(await codeOf(cashier().checkout.invoiceData())).toBe('INVALID_NIT');
    });

    it('refuses a cart whose customer was deactivated after it was chosen', async () => {
      const minera = await customer();
      await cashier().checkout.setCustomer(minera.id);
      await cashier().customers.update(minera.id, { status: 'INACTIVE' });
      expect(await codeOf(cashier().checkout.invoiceData())).toBe('CUSTOMER_INACTIVE');
    });
  });

  it('does not write stock: choosing a customer only touches the cart', async () => {
    const before = await state.base.stockMovement.count({ where: { companyId: state.companyId } });
    const minera = await customer();
    await cashier().checkout.setCustomer(minera.id);
    expect(await state.base.stockMovement.count({ where: { companyId: state.companyId } })).toBe(before);
  });
});
