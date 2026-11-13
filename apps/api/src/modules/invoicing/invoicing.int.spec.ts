/**
 * Integration test of the invoicing module (HU-FAC-01…04, HU-FAC-07) against the real Postgres: the invoice a sale leaves behind
 * and the event that issues it, the list with its day indicators and visibility, the detail, issuing by hand (once, even under
 * concurrency), fixing a customer, verifying the NIT with the SIN and sending a rejected invoice again.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, type Caller } from '../sales/pos/pos.int-fixture';

const fx = createPosFixture('invoicing');
const { state } = fx;

describe('Invoicing (integration, real Postgres)', () => {
  let manager: Caller;
  let issuer: Caller;
  let viewer: Caller;
  let otherManager: Caller;

  beforeAll(async () => {
    await fx.setup();
    manager = await fx.newMember('manager', state.companyId);
    fx.grant(manager, 'sales.history.view-all', 'invoicing.invoices.view', 'invoicing.invoices.issue', 'sales.cancellations.request', 'sales.returns.manage');
    issuer = await fx.newMember('issuer', state.companyId);
    fx.grant(issuer, 'sales.history.view-all', 'invoicing.invoices.view', 'invoicing.invoices.issue');
    viewer = await fx.newMember('viewer', state.companyId);
    fx.grant(viewer, 'invoicing.invoices.view');
    otherManager = await fx.newMember('othermanager', state.otherCompanyId);
    fx.grant(otherManager, 'sales.history.view-all', 'invoicing.invoices.view', 'invoicing.invoices.issue');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: { startsWith: 'invoicing.' } } });
    await state.base.invoiceDocument.deleteMany({ where: { companyId: state.companyId } });
    await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
    await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);
  const events = (type = 'invoice.issue') => state.base.outboxEvent.findMany({ where: { companyId: state.companyId, type }, orderBy: { id: 'asc' } });
  const invoiceRow = (id: string) => state.base.invoice.findUniqueOrThrow({ where: { id } });
  const setSetting = (key: string, value: unknown) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key } },
      create: { companyId: state.companyId, key, value: value as never },
      update: { value: value as never },
    });

  /** Sells `quantity` units in cash as the cashier and returns the sale and its invoice. */
  async function sell(quantity = 1, caller: Caller = state.cashier) {
    const product = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 50 } });
    await svc(caller).checkout.addItem({ productId: product.id, quantity });
    const { total } = await svc(caller).payment.pay();
    const done = await svc(caller).payment.complete({ payments: [{ method: 'CASH', received: total }], expectedTotal: total, idempotencyKey: randomUUID() });
    const invoice = await state.base.invoice.findUniqueOrThrow({ where: { saleId: done.sale.saleId } });
    return { saleId: done.sale.saleId, invoice, total };
  }

  describe('the invoice a sale leaves', () => {
    it('is PENDING, belongs to the branch and the register point of sale, and its issue event is published with the sale', async () => {
      const { invoice, saleId } = await sell();
      const register = await state.base.cashShift.findFirstOrThrow({ where: { companyId: state.companyId, openedById: state.cashier.userId }, include: { register: true } });
      expect(invoice).toMatchObject({ status: 'PENDING', branchId: state.branchId, pointOfSaleId: register.register.pointOfSaleId, number: null, cuf: null });
      const published = await events();
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({ idempotencyKey: `invoice-issue:${invoice.id}:1`, payload: { invoiceId: invoice.id, attempt: 1, manual: false } });
      expect(saleId).toBeDefined();
    });

    it('publishes no event when the company turns the automatic first attempt off, and the invoice still exists', async () => {
      await setSetting('invoicing.autoIssueOnSale', false);
      const { invoice } = await sell();
      expect(invoice.status).toBe('PENDING');
      expect(await events()).toHaveLength(0);
    });
  });

  describe('status, list and detail', () => {
    it('counts what waits for a person and reports an unknown connection until the first check', async () => {
      const a = await sell();
      const b = await sell();
      await state.base.invoice.update({ where: { id: b.invoice.id }, data: { status: 'REJECTED', rejectionCode: 1037, rejectionMessage: 'NIT INVALIDO' } });
      expect(a.invoice.id).toBeDefined();
      expect(await svc(manager).invoiceQueries.status()).toEqual({ connection: 'UNKNOWN', checkedAt: null, notIssued: 1, rejected: 1 });
      await state.base.siatSettings.upsert({
        where: { companyId: state.companyId },
        create: { companyId: state.companyId, connectionStatus: 'OFFLINE', connectionCheckedAt: new Date() },
        update: { connectionStatus: 'OFFLINE', connectionCheckedAt: new Date() },
      });
      expect((await svc(manager).invoiceQueries.status()).connection).toBe('OFFLINE');
      await state.base.siatSettings.deleteMany({ where: { companyId: state.companyId } });
    });

    it('lists with the day indicators, the total row, filters and the row actions of the caller', async () => {
      const valid = await sell(2);
      const pending = await sell(1);
      await state.base.invoice.update({ where: { id: valid.invoice.id }, data: { status: 'VALID', number: 7, issuedAt: new Date() } });

      const all = await svc(manager).invoiceQueries.list({});
      expect(all.total).toBe(2);
      expect(all.totalAmount).toBe('300.00');
      expect(all.kpis).toEqual({ issuedToday: { count: 1, total: '200.00' }, notIssued: 1, rejected: 0, cancellationsPending: 0 });
      const byId = new Map(all.items.map((item) => [item.id, item]));
      expect(byId.get(valid.invoice.id)).toMatchObject({ number: 7, status: 'VALID', total: '200.00' });
      expect(byId.get(valid.invoice.id)?.actions).toEqual(['VIEW_DETAIL', 'DOWNLOAD_PDF', 'DOWNLOAD_XML', 'SEND', 'ISSUE_CREDIT_NOTE', 'REQUEST_CANCELLATION']);
      expect(byId.get(pending.invoice.id)?.actions).toEqual(['VIEW_DETAIL', 'ISSUE']);

      expect((await svc(manager).invoiceQueries.list({ status: 'PENDING' })).items.map((i) => i.id)).toEqual([pending.invoice.id]);
      expect((await svc(manager).invoiceQueries.list({ q: '7' })).items.map((i) => i.id)).toEqual([valid.invoice.id]);
      expect((await svc(manager).invoiceQueries.list({ q: 'no-such-customer' })).total).toBe(0);
      expect((await svc(manager).invoiceQueries.list({ branchId: randomUUID() })).total).toBe(0);
      expect(await codeOf(svc(manager).invoiceQueries.list({ from: '2026-11-12', to: '2026-11-01' }))).toBe('INVALID_FILTER');
    });

    it('pages the list', async () => {
      await sell();
      await sell();
      await sell();
      const page = await svc(manager).invoiceQueries.list({ page: 2, pageSize: 2 });
      expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page.items).toHaveLength(1);
    });

    it('shows own sales unless the caller may see every sale, and never another company', async () => {
      const mine = await sell(1, state.cashier);
      const theirs = await sell(1, state.second);
      expect((await svc(viewer).invoiceQueries.list({})).total).toBe(0);
      // a caller without `sales.history.view-all` sees only the invoices of their own sales
      expect((await svc(state.cashier).invoiceQueries.list({})).items.map((i) => i.id)).toEqual([mine.invoice.id]);
      const all = await svc(manager).invoiceQueries.list({});
      expect(all.items.map((i) => i.id).sort()).toEqual([mine.invoice.id, theirs.invoice.id].sort());

      fx.useCompany(state.otherCompanyId);
      expect((await svc(otherManager).invoiceQueries.list({})).total).toBe(0);
      expect(await codeOf(svc(otherManager).invoiceQueries.detail(mine.invoice.id))).toBe('INVOICE_NOT_FOUND');
    });

    it('gives the detail: lines, payments, history, verification link and the caller actions; unknown ids are not found', async () => {
      const { invoice } = await sell(2);
      await state.base.invoice.update({ where: { id: invoice.id }, data: { status: 'VALID', number: 12, cuf: 'ABCDEF0123SIM0', issuedAt: new Date(), siatReceptionCode: 'SIM-1' } });
      await state.base.auditLog.create({
        data: { companyId: state.companyId, userId: manager.userId, action: 'invoicing.invoice.accept', entity: 'Invoice', entityId: invoice.id, after: { receptionCode: 'SIM-1' } },
      });
      const detail = await svc(manager).invoiceQueries.detail(invoice.id);
      expect(detail).toMatchObject({
        id: invoice.id,
        number: 12,
        status: 'VALID',
        cuf: 'ABCDEF0123SIM0',
        total: '200.00',
        pendingNitException: false,
        nitException: false,
      });
      expect(detail.lines).toHaveLength(1);
      expect(detail.lines[0]).toMatchObject({ quantity: 2, unitPrice: '100.00', total: '200.00' });
      // the code printed next to the product, the branch of the sale, and no open cancellation yet
      expect(detail.lines[0].code).toEqual(expect.any(String));
      expect(detail.lines[0].code).not.toBe('');
      expect(detail.branchName).toEqual(expect.any(String));
      expect(detail.pendingCancellation).toBeNull();
      // an open cancellation request of the sale shows who asked and when (FS-12)
      await state.base.approvalRequest.create({
        data: { companyId: state.companyId, type: 'CANCELLATION', subjectId: invoice.saleId, requestedById: manager.userId, reason: 'OTHER', requesterComment: 'Prueba', status: 'PENDING' },
      });
      const asked = await svc(manager).invoiceQueries.detail(invoice.id);
      expect(asked.pendingCancellation).toEqual({ requestedBy: 'User manager', requestedAt: expect.any(String) });
      expect(detail.payments).toEqual([{ method: 'CASH', amount: '200.00' }]);
      expect(detail.history).toEqual([expect.objectContaining({ action: 'invoicing.invoice.accept', actor: 'User manager', detail: 'SIM-1' })]);
      expect(detail.verificationUrl).toContain('cuf=ABCDEF0123SIM0');
      expect(detail.verificationUrl).toContain('numero=12');
      expect(detail.legend).toContain('Ley N° 453');
      expect(await codeOf(svc(manager).invoiceQueries.detail(randomUUID()))).toBe('INVOICE_NOT_FOUND');
    });
  });

  describe('issuing by hand', () => {
    it('moves a PENDING invoice to SENDING, audits it and publishes the attempt in the same transaction', async () => {
      const { invoice } = await sell();
      await svc(issuer).invoiceIssuing.issue(invoice.id);
      const saved = await invoiceRow(invoice.id);
      expect(saved.status).toBe('SENDING');
      expect(saved.lastAttemptAt).not.toBeNull();
      const manual = (await events()).filter((e) => (e.payload as { manual?: boolean }).manual === true);
      expect(manual).toHaveLength(1);
      expect(manual[0].payload).toMatchObject({ invoiceId: invoice.id, manual: true, userId: issuer.userId });
      const audit = await state.base.auditLog.findMany({ where: { entityId: invoice.id, action: 'invoicing.invoice.issue' } });
      expect(audit).toHaveLength(1);
      expect(audit[0].userId).toBe(issuer.userId);
    });

    it('refuses an invoice that is being sent, one already valid, and one that does not exist', async () => {
      const { invoice } = await sell();
      await svc(issuer).invoiceIssuing.issue(invoice.id);
      expect(await codeOf(svc(issuer).invoiceIssuing.issue(invoice.id))).toBe('INVOICE_ALREADY_SENDING');
      await state.base.invoice.update({ where: { id: invoice.id }, data: { status: 'VALID' } });
      expect(await codeOf(svc(issuer).invoiceIssuing.issue(invoice.id))).toBe('INVOICE_NOT_ISSUABLE');
      expect(await codeOf(svc(issuer).invoiceIssuing.issue(randomUUID()))).toBe('INVOICE_NOT_FOUND');
    });

    it('lets a SENDING invoice lost past the timeout be issued again', async () => {
      const { invoice } = await sell();
      await state.base.invoice.update({ where: { id: invoice.id }, data: { status: 'SENDING', lastAttemptAt: new Date(Date.now() - 6 * 60_000) } });
      await svc(issuer).invoiceIssuing.issue(invoice.id);
      expect((await invoiceRow(invoice.id)).status).toBe('SENDING');
      expect((await events()).filter((e) => (e.payload as { manual?: boolean }).manual === true)).toHaveLength(1);
    });

    it('two people issuing the same invoice at once make one attempt', async () => {
      const { invoice } = await sell();
      const outcomes = await Promise.all([codeOf(svc(issuer).invoiceIssuing.issue(invoice.id)), codeOf(svc(manager).invoiceIssuing.issue(invoice.id))]);
      expect(outcomes.filter((o) => o === null)).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'INVOICE_ALREADY_SENDING')).toHaveLength(1);
      expect((await events()).filter((e) => (e.payload as { manual?: boolean }).manual === true)).toHaveLength(1);
    });

    it('issues in bulk and reports each invoice on its own', async () => {
      const a = await sell();
      const b = await sell();
      await state.base.invoice.update({ where: { id: b.invoice.id }, data: { status: 'VALID' } });
      const missing = randomUUID();
      const results = await svc(issuer).invoiceIssuing.issueMany([a.invoice.id, b.invoice.id, missing, a.invoice.id]);
      expect(results).toEqual([
        { id: a.invoice.id, ok: true },
        { id: b.invoice.id, ok: false, code: 'INVOICE_NOT_ISSUABLE' },
        { id: missing, ok: false, code: 'INVOICE_NOT_FOUND' },
      ]);
    });

    it('does not touch another company', async () => {
      const { invoice } = await sell();
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(otherManager).invoiceIssuing.issue(invoice.id))).toBe('INVOICE_NOT_FOUND');
      fx.useCompany(state.companyId);
      expect((await invoiceRow(invoice.id)).status).toBe('PENDING');
    });
  });

  describe('a rejected invoice: correct, verify, send again', () => {
    async function rejected(documentNumber = '9991234') {
      const { invoice } = await sell();
      await state.base.invoice.update({
        where: { id: invoice.id },
        data: { status: 'REJECTED', number: 3, customerDocumentType: 5, customerDocumentNumber: documentNumber, rejectionCode: 1037, rejectionMessage: 'NIT INVALIDO' },
      });
      return invoice.id;
    }

    it('does not send again until the NIT is verified', async () => {
      const id = await rejected();
      expect(await codeOf(svc(issuer).invoiceIssuing.resend(id))).toBe('NIT_NOT_VERIFIED');
      expect((await invoiceRow(id)).status).toBe('REJECTED');
    });

    it('verifies the NIT with the SIN: an unknown one is not stored, a known one is', async () => {
      const id = await rejected();
      expect(await svc(issuer).invoiceIssuing.verifyNit(id)).toMatchObject({ valid: false, messages: [{ code: 1037 }] });
      expect((await invoiceRow(id)).nitVerifiedAt).toBeNull();

      await svc(issuer).invoiceIssuing.updateCustomer(id, { name: 'Cliente corregido', documentType: 5, documentNumber: '1234567' });
      expect(await svc(issuer).invoiceIssuing.verifyNit(id)).toMatchObject({ valid: true });
      expect((await invoiceRow(id)).nitVerifiedAt).not.toBeNull();
      const audits = (await state.base.auditLog.findMany({ where: { entityId: id }, orderBy: { id: 'asc' } })).map((a) => a.action);
      expect(audits).toEqual(['invoicing.invoice.verify-nit', 'invoicing.invoice.correct', 'invoicing.invoice.verify-nit']);
    });

    it('sends a corrected, verified invoice again: REJECTED goes through PENDING to SENDING and keeps its number', async () => {
      const id = await rejected();
      await svc(issuer).invoiceIssuing.updateCustomer(id, { name: 'Cliente corregido', documentType: 5, documentNumber: '1234567' });
      await svc(issuer).invoiceIssuing.verifyNit(id);
      await svc(issuer).invoiceIssuing.resend(id);
      expect(await invoiceRow(id)).toMatchObject({ status: 'SENDING', number: 3, customerTaxName: 'Cliente corregido', customerDocumentNumber: '1234567' });
    });

    it('changing the document drops the earlier verification', async () => {
      const id = await rejected('1234567');
      await svc(issuer).invoiceIssuing.verifyNit(id);
      await svc(issuer).invoiceIssuing.updateCustomer(id, { name: 'Otro', documentType: 5, documentNumber: '7654321' });
      expect((await invoiceRow(id)).nitVerifiedAt).toBeNull();
      // the same document keeps it
      await svc(issuer).invoiceIssuing.verifyNit(id);
      await svc(issuer).invoiceIssuing.updateCustomer(id, { name: 'Otro nombre', documentType: 5, documentNumber: '7654321' });
      expect((await invoiceRow(id)).nitVerifiedAt).not.toBeNull();
    });

    it('a CI needs no verification with the SIN', async () => {
      const id = await rejected();
      await svc(issuer).invoiceIssuing.updateCustomer(id, { name: 'Con CI', documentType: 1, documentNumber: '5432109' });
      await svc(issuer).invoiceIssuing.resend(id);
      expect((await invoiceRow(id)).status).toBe('SENDING');
    });

    it('verifying says SIAT_UNAVAILABLE when the SIAT does not answer', async () => {
      const id = await rejected();
      await setSetting('invoicing.simulatorMode', 'OFFLINE');
      expect(await codeOf(svc(issuer).invoiceIssuing.verifyNit(id))).toBe('SIAT_UNAVAILABLE');
      expect((await invoiceRow(id)).nitVerifiedAt).toBeNull();
    });

    it('refuses an invalid document and a customer change on an invoice already accepted', async () => {
      const id = await rejected();
      expect(await codeOf(svc(issuer).invoiceIssuing.updateCustomer(id, { name: 'X', documentType: 5, documentNumber: 'abc' }))).toBe('INVALID_NIT');
      await state.base.invoice.update({ where: { id }, data: { status: 'VALID' } });
      expect(await codeOf(svc(issuer).invoiceIssuing.updateCustomer(id, { name: 'X', documentType: 5, documentNumber: '1234567' }))).toBe('INVOICE_NOT_EDITABLE');
      expect(await codeOf(svc(issuer).invoiceIssuing.verifyNit(id))).toBe('INVOICE_NOT_EDITABLE');
    });
  });
});
