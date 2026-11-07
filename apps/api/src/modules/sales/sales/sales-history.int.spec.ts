/**
 * Integration test of the sales history and the sale detail (HU-VEN-12, HU-VEN-13) against the real Postgres: paging and
 * order, every filter (with the La Paz day bounds), who sees which sales, the detail with its audit history, the reprint
 * audit, tenant isolation, and that no cost ever reaches the payloads.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, type Caller } from '../pos/pos.int-fixture';

const fx = createPosFixture('salehist');
const { state } = fx;

describe('Sales history and detail (integration, real Postgres)', () => {
  let manager: Caller;
  let otherManager: Caller;

  beforeAll(async () => {
    await fx.setup();
    manager = await fx.newMember('manager', state.companyId);
    fx.grant(manager, 'sales.history.view-all');
    otherManager = await fx.newMember('othermanager', state.otherCompanyId);
    fx.grant(otherManager, 'sales.history.view-all');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
    await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.customer.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);

  /** Sells `quantity` units of a fresh product in cash and returns the sale id. */
  async function sell(caller: Caller = state.cashier, quantity = 1, price = '100.00'): Promise<string> {
    const product = await fx.newProduct({ price, stock: { [state.centralId]: 50 } });
    await svc(caller).checkout.addItem({ productId: product.id, quantity });
    const { total } = await svc(caller).payment.pay();
    const done = await svc(caller).payment.complete({
      payments: [{ method: 'CASH', received: total }],
      expectedTotal: total,
      idempotencyKey: randomUUID(),
    });
    return done.sale.saleId;
  }

  /** Moves a sale to an instant, to test the day bounds. */
  const moveTo = (saleId: string, iso: string) => state.base.sale.update({ where: { id: saleId }, data: { createdAt: new Date(iso) } });

  describe('list', () => {
    it('lists newest first with number, customer, date, units, total and status', async () => {
      const first = await sell(state.cashier, 2, '100.00');
      const second = await sell(state.cashier, 1, '50.00');
      const page = await svc().history.list({});
      expect(page.total).toBe(2);
      expect(page.items.map((i) => i.id)).toEqual([second, first]);
      expect(page.items[1]).toMatchObject({
        id: first,
        customerName: 'S/N',
        itemsCount: 2,
        total: '200.00',
        status: 'COMPLETED',
        invoiceStatus: 'PENDING',
        methods: ['CASH'],
      });
      expect(page.items[1].number).toMatch(/^V-/);
      expect(Date.parse(page.items[1].createdAt)).not.toBeNaN();
    });

    it('pages the results', async () => {
      for (let i = 0; i < 3; i += 1) await sell();
      const one = await svc().history.list({ page: 1, pageSize: 2 });
      const two = await svc().history.list({ page: 2, pageSize: 2 });
      expect([one.items.length, two.items.length, one.total]).toEqual([2, 1, 3]);
      expect(new Set([...one.items, ...two.items].map((i) => i.id)).size).toBe(3);
    });

    it('a cashier sees only their own sales; view-all sees the whole company', async () => {
      const mine = await sell(state.cashier);
      const theirs = await sell(state.second);
      expect((await svc(state.cashier).history.list({})).items.map((i) => i.id)).toEqual([mine]);
      expect((await svc(state.second).history.list({})).items.map((i) => i.id)).toEqual([theirs]);
      expect((await svc(manager).history.list({})).items.map((i) => i.id).sort()).toEqual([mine, theirs].sort());
    });

    it('the cashier filter works with view-all and is ignored without it', async () => {
      const mine = await sell(state.cashier);
      const theirs = await sell(state.second);
      const byManager = await svc(manager).history.list({ cashierId: state.second.userId });
      expect(byManager.items.map((i) => i.id)).toEqual([theirs]);
      const byCashier = await svc(state.cashier).history.list({ cashierId: state.second.userId });
      expect(byCashier.items.map((i) => i.id)).toEqual([mine]);
    });

    it('filters by status and by payment method', async () => {
      const saleId = await sell();
      await state.base.sale.update({ where: { id: saleId }, data: { status: 'CANCELLED' } });
      await sell();
      expect((await svc().history.list({ status: 'CANCELLED' })).items.map((i) => i.id)).toEqual([saleId]);
      expect((await svc().history.list({ status: 'COMPLETED' })).total).toBe(1);
      expect((await svc().history.list({ method: 'CASH' })).total).toBe(2);
      expect((await svc().history.list({ method: 'QR' })).total).toBe(0);
    });

    it('searches by number and by the customer name or document', async () => {
      const saleId = await sell();
      await sell();
      const { number } = await state.base.sale.findUniqueOrThrow({ where: { id: saleId } });
      expect((await svc().history.list({ q: number })).items.map((i) => i.id)).toEqual([saleId]);
      await state.base.invoice.updateMany({
        where: { saleId },
        data: { customerTaxName: 'Minera Demo Ltda.', customerDocumentNumber: '1023456029' },
      });
      expect((await svc().history.list({ q: 'minera demo' })).items.map((i) => i.id)).toEqual([saleId]);
      expect((await svc().history.list({ q: '1023456' })).items.map((i) => i.id)).toEqual([saleId]);
      expect((await svc().history.list({ q: 'nobody' })).total).toBe(0);
    });

    it('the date range uses La Paz days: 23:30 in La Paz still belongs to that day', async () => {
      const late = await sell();
      const early = await sell();
      // 2026-10-10T03:30Z is 2026-10-09 23:30 in La Paz (UTC-4); 04:00Z is the first minute of 10 Oct
      await moveTo(late, '2026-10-10T03:30:00.000Z');
      await moveTo(early, '2026-10-10T04:00:00.000Z');
      const ninth = await svc().history.list({ from: '2026-10-09', to: '2026-10-09' });
      expect(ninth.items.map((i) => i.id)).toEqual([late]);
      const tenth = await svc().history.list({ from: '2026-10-10', to: '2026-10-10' });
      expect(tenth.items.map((i) => i.id)).toEqual([early]);
      expect((await svc().history.list({ from: '2026-10-09', to: '2026-10-10' })).total).toBe(2);
    });

    it('rejects an empty date range', async () => {
      expect(await codeOf(svc().history.list({ from: '2026-10-10', to: '2026-10-09' }))).toBe('INVALID_FILTER');
    });

    it('never returns another company\'s sales', async () => {
      await sell();
      fx.useCompany(state.otherCompanyId);
      expect((await svc(otherManager).history.list({})).total).toBe(0);
    });
  });

  describe('detail', () => {
    it('returns lines, payments, the invoice and the history, without costs', async () => {
      const saleId = await sell(state.cashier, 2, '100.00');
      const detail = await svc().history.detail(saleId);
      expect(detail).toMatchObject({
        id: saleId,
        status: 'COMPLETED',
        branch: { name: 'Sucursal central' },
        cashier: { name: 'User cashier' },
        customer: { name: 'S/N' },
        subtotal: '200.00',
        total: '200.00',
        invoice: { status: 'PENDING', number: null },
        payments: [{ method: 'CASH', amount: '200.00', change: '0.00' }],
      });
      expect(detail.lines).toHaveLength(1);
      expect(detail.lines[0]).toMatchObject({ quantity: 2, unitPrice: '100.00', lineTotal: '200.00' });
      expect(detail.history.map((h) => h.action)).toEqual(['sales.sale.complete']);
      expect(detail.history[0].userName).toBe('User cashier');
      const text = JSON.stringify(detail).toLowerCase();
      expect(text).not.toContain('cost');
    });

    it('the history lists the e-mail request and every reprint, oldest first, with only the address', async () => {
      const saleId = await sell();
      await svc().receipts.sendEmail(saleId, 'cliente@example.com');
      const first = await svc().receipts.reprint(saleId);
      await svc().receipts.reprint(saleId);
      expect(Date.parse(first.printedAt)).not.toBeNaN();
      const history = (await svc().history.detail(saleId)).history;
      expect(history.map((h) => h.action)).toEqual(['sales.sale.complete', 'sales.receipt.email', 'sales.receipt.reprint', 'sales.receipt.reprint']);
      expect(history[1].email).toBe('cliente@example.com');
      expect(history[2].email).toBeNull();
      expect(JSON.stringify(history)).not.toContain('printedAt');
      const audits = await state.base.auditLog.count({ where: { companyId: state.companyId, entityId: saleId, action: 'sales.receipt.reprint' } });
      expect(audits).toBe(2);
    });

    it('another cashier gets 404, in the detail, the receipt and the reprint', async () => {
      const saleId = await sell(state.cashier);
      expect(await codeOf(svc(state.second).history.detail(saleId))).toBe('SALE_NOT_FOUND');
      expect(await codeOf(svc(state.second).receipts.receipt(saleId))).toBe('SALE_NOT_FOUND');
      expect(await codeOf(svc(state.second).receipts.reprint(saleId))).toBe('SALE_NOT_FOUND');
      expect(await state.base.auditLog.count({ where: { companyId: state.companyId, action: 'sales.receipt.reprint' } })).toBe(0);
    });

    it('view-all opens any sale of the company, its receipt and its reprint', async () => {
      const saleId = await sell(state.cashier);
      expect((await svc(manager).history.detail(saleId)).id).toBe(saleId);
      expect((await svc(manager).receipts.receipt(saleId)).saleId).toBe(saleId);
      expect((await svc(manager).receipts.reprint(saleId)).printedAt).toBeTruthy();
    });

    it('another company cannot open it, even with view-all', async () => {
      const saleId = await sell(state.cashier);
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(otherManager).history.detail(saleId))).toBe('SALE_NOT_FOUND');
      expect(await codeOf(svc(otherManager).receipts.reprint(saleId))).toBe('SALE_NOT_FOUND');
    });

    it('an unknown sale is a 404', async () => {
      expect(await codeOf(svc().history.detail(randomUUID()))).toBe('SALE_NOT_FOUND');
    });
  });
});
