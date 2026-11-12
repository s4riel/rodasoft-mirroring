/**
 * Integration test of selling on credit (HU-VEN-34) against the real Postgres: the sale is written atomically with a CREDIT
 * payment that carries its due date and no cash movement; credit needs an identified customer with a NIT and the flag on;
 * it is never mixed with another method; the last unit sells once under concurrency; and a retry returns the same sale.
 */
import { IdentityDocumentType, laPazToday } from '@rodasoft/domain';
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, type Caller } from './pos.int-fixture';

const fx = createPosFixture('poscredit');
const { state } = fx;

const key = () => randomUUID();

describe('POS credit sale (integration, real Postgres)', () => {
  let approver: Caller;

  beforeAll(async () => {
    await fx.setup();
    approver = await fx.newMember('approver', state.companyId);
    fx.grant(approver, 'sales.history.view-all', 'sales.cancellations.approve');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    await fx.setAllowNegativeStock(false);
    await state.base.creditNote.deleteMany({ where: { companyId: state.companyId } });
    await state.base.saleReturn.deleteMany({ where: { companyId: state.companyId } });
    await state.base.approvalRequest.deleteMany({ where: { companyId: state.companyId } });
    await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
    await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.customer.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'sales.creditTermDays' } });
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);

  const product = (stock: number, price = '245.00') => fx.newProduct({ price, stock: { [state.centralId]: stock } });

  let customerSeq = 0;
  /** A customer with credit and a NIT, unless the options say otherwise. */
  async function customer(opts: { creditEnabled?: boolean; documentType?: number; status?: 'ACTIVE' | 'INACTIVE' } = {}) {
    customerSeq += 1;
    return state.base.customer.create({
      data: {
        companyId: state.companyId,
        name: 'Taller Pérez',
        email: 'perez@example.com',
        documentType: opts.documentType ?? IdentityDocumentType.NIT,
        documentNumber: `10203040${customerSeq}`,
        creditEnabled: opts.creditEnabled ?? true,
        status: opts.status ?? 'ACTIVE',
      },
    });
  }

  /** Fills the cart, picks the customer and sends it to payment. */
  async function pay(lines: [string, number][], customerId: string | null, caller: Caller = state.cashier) {
    for (const [productId, quantity] of lines) await svc(caller).checkout.addItem({ productId, quantity });
    if (customerId) await svc(caller).checkout.setCustomer(customerId);
    return svc(caller).payment.pay();
  }

  const creditPayment = (termDays: unknown = 30) => ({ method: 'CREDIT' as const, termDays: termDays as number });

  const completeCredit = (expectedTotal: string, termDays: unknown = 30, caller: Caller = state.cashier, idempotencyKey = key()) =>
    svc(caller).payment.complete({ payments: [creditPayment(termDays)], expectedTotal, idempotencyKey });

  const stockOf = async (productId: string) =>
    (await state.base.stockLevel.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId: state.centralId } } })).quantity;

  describe('pay offers credit', () => {
    it('is available for an identified customer with a NIT and the flag on, with the terms of the setting', async () => {
      const p = await product(5);
      const c = await customer();
      const response = await pay([[p.id, 1]], c.id);
      expect(response.credit).toEqual({ available: true, reason: null, termOptions: [5, 15, 30] });
    });

    it('uses the terms the company configures', async () => {
      await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'sales.creditTermDays', value: [7, 45] } });
      const p = await product(5);
      const c = await customer();
      expect((await pay([[p.id, 1]], c.id)).credit.termOptions).toEqual([7, 45]);
    });

    it('says why it is not available', async () => {
      const p = await product(5);
      expect((await pay([[p.id, 1]], null)).credit).toMatchObject({ available: false, reason: 'CUSTOMER_REQUIRED' });
      await svc().payment.back();
      await svc().checkout.setCustomer((await customer({ creditEnabled: false })).id);
      expect((await svc().payment.pay()).credit).toMatchObject({ available: false, reason: 'CREDIT_NOT_ENABLED' });
      await svc().payment.back();
      await svc().checkout.setCustomer((await customer({ documentType: IdentityDocumentType.CI })).id);
      expect((await svc().payment.pay()).credit).toMatchObject({ available: false, reason: 'NIT_REQUIRED' });
    });
  });

  describe('complete on credit', () => {
    it('writes the sale, the CREDIT payment with its due date, the stock, the invoice and the outbox event, and no cash', async () => {
      const p = await product(10);
      const c = await customer();
      const { total } = await pay([[p.id, 2]], c.id);
      const { sale } = await completeCredit(total, 15);

      const dueDate = new Date(`${laPazToday(new Date())}T00:00:00Z`);
      dueDate.setUTCDate(dueDate.getUTCDate() + 15);
      const expectedDue = dueDate.toISOString().slice(0, 10);

      expect(sale).toMatchObject({ total: '490.00', received: '0.00', change: '0.00', dueDate: expectedDue, invoiceStatus: 'PENDING' });
      const payments = await state.base.salePayment.findMany({ where: { saleId: sale.saleId } });
      expect(payments).toHaveLength(1);
      expect(payments[0].method).toBe('CREDIT');
      expect(payments[0].amount.toFixed(2)).toBe('490.00');
      expect(payments[0].change.toFixed(2)).toBe('0.00');
      expect(payments[0].dueDate?.toISOString().slice(0, 10)).toBe(expectedDue);

      // nothing enters the drawer
      expect(await state.base.cashMovement.count({ where: { companyId: state.companyId, refId: sale.saleId } })).toBe(0);
      expect(await stockOf(p.id)).toBe(8);
      const invoice = await state.base.invoice.findFirstOrThrow({ where: { saleId: sale.saleId } });
      expect(invoice).toMatchObject({ status: 'PENDING' });
      expect(invoice.total.toFixed(2)).toBe('490.00');
      expect(await state.base.posCheckout.findFirstOrThrow({ where: { sale: { id: sale.saleId } } })).toMatchObject({ status: 'COMPLETED' });

      const audit = await state.base.auditLog.findFirstOrThrow({ where: { companyId: state.companyId, action: 'sales.sale.complete' } });
      expect(audit.after).toMatchObject({ method: 'CREDIT', payments: [{ method: 'CREDIT', amount: '490.00', termDays: 15, dueDate: expectedDue }] });
      const event = await state.base.outboxEvent.findFirstOrThrow({ where: { companyId: state.companyId, type: 'sale.completed' } });
      expect(event.payload).toMatchObject({ saleId: sale.saleId, total: '490.00', credit: { customerId: c.id, amount: '490.00', dueDate: expectedDue } });
    });

    it('has no amount limit: a large sale completes on credit', async () => {
      const p = await product(100, '9999.00');
      const c = await customer();
      const { total } = await pay([[p.id, 50]], c.id);
      const { sale } = await completeCredit(total, 30);
      expect(sale.total).toBe('499950.00');
    });

    it('lists the credit apart from the drawer in the shift summary', async () => {
      const p = await product(5);
      const c = await customer();
      const { total } = await pay([[p.id, 1]], c.id);
      await completeCredit(total, 5);
      const shift = await svc().shifts.requireOpenShift();
      const detail = await svc().cashSummary.shiftDetail(shift.id);
      expect(detail.methods).toContainEqual({ method: 'CREDIT', amount: '245.00', count: 1 });
      expect(detail.methods.find((m) => m.method === 'CASH')).toMatchObject({ amount: '0.00', count: 0 });
    });

    it('refuses a final consumer, a customer without the flag and one identified by another document', async () => {
      const p = await product(10);
      const { total } = await pay([[p.id, 1]], null);
      expect(await codeOf(completeCredit(total))).toBe('CREDIT_CUSTOMER_REQUIRED');
      await svc().payment.back();

      await svc().checkout.setCustomer((await customer({ creditEnabled: false })).id);
      const second = await svc().payment.pay();
      expect(await codeOf(completeCredit(second.total))).toBe('CREDIT_NOT_ENABLED');
      await svc().payment.back();

      await svc().checkout.setCustomer((await customer({ documentType: IdentityDocumentType.CI })).id);
      const third = await svc().payment.pay();
      expect(await codeOf(completeCredit(third.total))).toBe('CREDIT_NIT_REQUIRED');

      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await stockOf(p.id)).toBe(10);
    });

    it('refuses the sale when the flag is turned off between pay and complete', async () => {
      const p = await product(10);
      const c = await customer();
      const { total } = await pay([[p.id, 1]], c.id);
      await state.base.customer.update({ where: { id: c.id }, data: { creditEnabled: false } });
      expect(await codeOf(completeCredit(total))).toBe('CREDIT_NOT_ENABLED');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await stockOf(p.id)).toBe(10);
    });

    it('refuses an invalid term', async () => {
      const p = await product(10);
      const c = await customer();
      const { total } = await pay([[p.id, 1]], c.id);
      for (const bad of [0, -1, 1.5, 366, '30', null]) expect(await codeOf(completeCredit(total, bad))).toBe('CREDIT_TERM_INVALID');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('accepts "other" terms: any whole number of days up to a year', async () => {
      const p = await product(10);
      const c = await customer();
      const { total } = await pay([[p.id, 1]], c.id);
      const { sale } = await completeCredit(total, 45);
      expect(sale.dueDate).not.toBeNull();
    });

    it('is never mixed with another method', async () => {
      const p = await product(10);
      const c = await customer();
      const { total } = await pay([[p.id, 1]], c.id);
      const mixed = svc().payment.complete({
        payments: [{ method: 'CASH', received: '100' }, creditPayment(30)],
        expectedTotal: total,
        idempotencyKey: key(),
      });
      expect(await codeOf(mixed)).toBe('PAYMENT_METHOD_NOT_AVAILABLE');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('is refused while a QR of the cart waits for the customer', async () => {
      const p = await product(10);
      const c = await customer();
      const { total } = await pay([[p.id, 1]], c.id);
      await svc().qr.start({ idempotencyKey: key(), expectedTotal: total });
      expect(await codeOf(completeCredit(total))).toBe('PAYMENT_ALREADY_PENDING');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('answers INSUFFICIENT_STOCK and writes nothing when the stock is gone', async () => {
      const p = await product(1);
      const c = await customer();
      const { total } = await pay([[p.id, 1]], c.id);
      await state.base.stockLevel.update({ where: { productId_warehouseId: { productId: p.id, warehouseId: state.centralId } }, data: { quantity: 0 } });
      expect(await codeOf(completeCredit(total))).toBe('INSUFFICIENT_STOCK');
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(0);
      expect(await state.base.salePayment.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('two cashiers selling the last unit on credit at the same time: only one succeeds', async () => {
      const last = await product(1);
      const c = await customer();
      const a = await pay([[last.id, 1]], c.id, state.cashier);
      const b = await pay([[last.id, 1]], c.id, state.second);
      const results = await Promise.all([completeCredit(a.total, 30, state.cashier), completeCredit(b.total, 30, state.second)].map(codeOf));
      expect(results.filter((r) => r === null)).toHaveLength(1);
      expect(results.filter((r) => r === 'INSUFFICIENT_STOCK')).toHaveLength(1);
      expect(await stockOf(last.id)).toBe(0);
      expect(await state.base.salePayment.count({ where: { companyId: state.companyId, method: 'CREDIT' } })).toBe(1);
    });

    it('a retry with the same key returns the same sale and writes nothing twice', async () => {
      const p = await product(10);
      const c = await customer();
      const { total } = await pay([[p.id, 2]], c.id);
      const idempotencyKey = key();
      const first = await completeCredit(total, 30, state.cashier, idempotencyKey);
      const again = await completeCredit(total, 30, state.cashier, idempotencyKey);
      expect(again).toEqual(first);
      expect(again.sale.dueDate).toBe(first.sale.dueDate);
      expect(await state.base.sale.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await state.base.salePayment.count({ where: { companyId: state.companyId } })).toBe(1);
      expect(await stockOf(p.id)).toBe(8);
    });
  });

  describe('other payments of the cart and negative stock', () => {
    it('is not blocked by a QR the cashier already dropped', async () => {
      const p = await product(5);
      const c = await customer();
      const { total } = await pay([[p.id, 1]], c.id);
      const started = await svc().qr.start({ idempotencyKey: key(), expectedTotal: total });
      await svc().qr.cancel(started.payment.paymentId);
      const { sale } = await completeCredit(total, 5);
      expect(sale.dueDate).not.toBeNull();
      expect(await stockOf(p.id)).toBe(4);
    });

    it('follows inventory.allowNegativeStock like a cash sale: the stock may go below zero', async () => {
      await fx.setAllowNegativeStock(true);
      // a product that never had stock: there is no stock level to lock until the sale creates it
      const p = await fx.newProduct({ price: '245.00' });
      const c = await customer();
      const { total } = await pay([[p.id, 1]], c.id);
      await completeCredit(total, 5);
      expect(await stockOf(p.id)).toBe(-1);
    });
  });

  describe('returns and cancellations of a credit sale', () => {
    /** Sells 2 units of a fresh product at 245.00 on credit and returns the sale with its product. */
    async function creditSale() {
      const p = await product(10);
      const c = await customer();
      const { total } = await pay([[p.id, 2]], c.id);
      const { sale } = await completeCredit(total, 30);
      const items = await state.base.saleItem.findMany({ where: { saleId: sale.saleId } });
      return { saleId: sale.saleId, productId: p.id, itemId: items[0].id, customerId: c.id };
    }

    const events = (type: string) => state.base.outboxEvent.findMany({ where: { companyId: state.companyId, type } });
    const cashRows = () => state.base.cashMovement.count({ where: { companyId: state.companyId } });

    it('a cash return restocks and pays out nothing, because nothing was collected; the credit reduction is reported', async () => {
      const sold = await creditSale();
      const cashBefore = await cashRows();
      const detail = await svc().returns.create(
        { saleId: sold.saleId, reason: 'FACTORY_DEFECT', refundMethod: 'CASH', items: [{ saleItemId: sold.itemId, quantity: 1, condition: 'RESTOCK' }] } as never,
        key(),
      );
      expect(detail).toMatchObject({ status: 'APPROVED', total: '245.00' });
      expect(await stockOf(sold.productId)).toBe(9);
      expect(await cashRows()).toBe(cashBefore);
      const [event] = await events('sales.return.completed');
      expect(event.payload).toMatchObject({ total: '245.00', paidOut: '0.00', creditReduction: '245.00', customerId: sold.customerId });
    });

    it('a cancellation restocks, moves no cash and reports the credit to reverse', async () => {
      const sold = await creditSale();
      const cashBefore = await cashRows();
      await svc().cancellations.request(sold.saleId, { reason: 'CUSTOMER_DATA_ERROR', comment: 'El cliente pidió la factura a nombre de otra empresa' } as never);
      await svc(approver).cancellations.approve(sold.saleId, {});
      expect(await stockOf(sold.productId)).toBe(10);
      expect(await cashRows()).toBe(cashBefore);
      const [event] = await events('sales.cancellation.approved');
      expect(event.payload).toMatchObject({ saleId: sold.saleId, cashRefund: '0.00', creditReversal: '490.00', customerId: sold.customerId });
    });
  });

  describe('the customer balance (HU-VEN-34, until accounts receivable)', () => {
    it('is derived from the credit sales: open ones add up, returns and cancellations take their part off', async () => {
      const c = await customer();
      const p = await product(20);
      const sell = async (quantity: number, termDays: number) => {
        const { total } = await pay([[p.id, quantity]], c.id);
        const { sale } = await completeCredit(total, termDays);
        const [item] = await state.base.saleItem.findMany({ where: { saleId: sale.saleId } });
        return { saleId: sale.saleId, itemId: item.id };
      };
      const first = await sell(2, 30);
      const second = await sell(1, 5);

      const today = new Date(`${laPazToday(new Date())}T00:00:00Z`);
      const plus = (days: number) => new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10);
      expect(await svc().customers.creditBalance(c.id)).toEqual({ customerId: c.id, balance: '735.00', overdue: '0.00', openSales: 2, nextDueDate: plus(5) });

      // a return of one piece of the first sale takes its refund off the debt
      await svc().returns.create(
        { saleId: first.saleId, reason: 'FACTORY_DEFECT', refundMethod: 'CASH', items: [{ saleItemId: first.itemId, quantity: 1, condition: 'RESTOCK' }] } as never,
        key(),
      );
      expect((await svc().customers.creditBalance(c.id)).balance).toBe('490.00');

      // a cancelled sale owes nothing
      await svc().cancellations.request(second.saleId, { reason: 'CUSTOMER_DATA_ERROR', comment: 'El cliente pidió la factura a nombre de otra empresa' } as never);
      await svc(approver).cancellations.approve(second.saleId, {});
      expect(await svc().customers.creditBalance(c.id)).toMatchObject({ balance: '245.00', openSales: 1, nextDueDate: plus(30) });
    });

    it('is zero for a customer without credit sales, and another company’s customer does not exist', async () => {
      const c = await customer();
      expect(await svc().customers.creditBalance(c.id)).toEqual({ customerId: c.id, balance: '0.00', overdue: '0.00', openSales: 0, nextDueDate: null });
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(state.other).customers.creditBalance(c.id))).toBe('CUSTOMER_NOT_FOUND');
    });
  });

  describe('the due date check', () => {
    async function saleFor(): Promise<string> {
      const p = await product(3);
      const c = await customer();
      const { total } = await pay([[p.id, 1]], c.id);
      return (await completeCredit(total, 5)).sale.saleId;
    }

    it('rejects a CREDIT payment without a due date', async () => {
      const saleId = await saleFor();
      await expect(
        state.base.salePayment.create({ data: { companyId: state.companyId, saleId, method: 'CREDIT', amount: '10.00' } }),
      ).rejects.toThrow(/sale_payments_credit_due_date_check/);
    });

    it('rejects a due date on any other method', async () => {
      const saleId = await saleFor();
      await expect(
        state.base.salePayment.create({
          data: { companyId: state.companyId, saleId, method: 'CASH', amount: '10.00', dueDate: new Date('2026-12-01T00:00:00Z') },
        }),
      ).rejects.toThrow(/sale_payments_credit_due_date_check/);
    });
  });
});
