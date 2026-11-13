/**
 * Integration test of the NIT exception (HU-FAC-08) against the real Postgres: the request with its reason, the setting that
 * turns it off, one pending request per invoice, the approval that sends the invoice again with the exception, the rejection with
 * its reply, who may decide, the approvals inbox and the audit trail.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, detailsOf, type Caller } from '../sales/pos/pos.int-fixture';

const fx = createPosFixture('nitexc');
const { state } = fx;

const REASON = 'El cliente no recuerda su NIT y necesita la factura hoy';

describe('NIT exception (integration, real Postgres)', () => {
  let issuer: Caller;
  let approver: Caller;
  let otherApprover: Caller;

  beforeAll(async () => {
    await fx.setup();
    issuer = await fx.newMember('issuer', state.companyId);
    fx.grant(issuer, 'sales.history.view-all', 'invoicing.invoices.view', 'invoicing.invoices.issue');
    approver = await fx.newMember('approver', state.companyId);
    fx.grant(approver, 'sales.history.view-all', 'invoicing.invoices.view', 'invoicing.nit-exception.approve');
    otherApprover = await fx.newMember('otherapprover', state.otherCompanyId);
    fx.grant(otherApprover, 'sales.history.view-all', 'invoicing.nit-exception.approve');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: { startsWith: 'invoicing.' } } });
    await state.base.approvalRequest.deleteMany({ where: { companyId: state.companyId } });
    await state.base.invoiceDocument.deleteMany({ where: { companyId: state.companyId } });
    await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
    await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
  });

  const svc = (caller: Caller = issuer) => fx.as(caller);
  const events = (type: string) => state.base.outboxEvent.findMany({ where: { companyId: state.companyId, type }, orderBy: { id: 'asc' } });
  const audits = (action: string) => state.base.auditLog.findMany({ where: { companyId: state.companyId, action } });
  const requests = (invoiceId: string) => state.base.approvalRequest.findMany({ where: { subjectId: invoiceId }, orderBy: { createdAt: 'asc' } });
  const invoiceRow = (id: string) => state.base.invoice.findUniqueOrThrow({ where: { id } });

  /** A sale whose invoice the SIN rejected for an unknown NIT. */
  async function rejectedInvoice(status: 'REJECTED' | 'PENDING' | 'VALID' = 'REJECTED') {
    const product = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 50 } });
    await svc(state.cashier).checkout.addItem({ productId: product.id, quantity: 1 });
    const { total } = await svc(state.cashier).payment.pay();
    const done = await svc(state.cashier).payment.complete({ payments: [{ method: 'CASH', received: total }], expectedTotal: total, idempotencyKey: randomUUID() });
    const invoice = await state.base.invoice.findUniqueOrThrow({ where: { saleId: done.sale.saleId } });
    await state.base.invoice.update({
      where: { id: invoice.id },
      data: { status, number: status === 'PENDING' ? null : 4, customerDocumentType: 5, customerDocumentNumber: '9991234', rejectionCode: status === 'REJECTED' ? 1037 : null, rejectionMessage: status === 'REJECTED' ? 'NIT INVALIDO' : null },
    });
    return invoice.id;
  }

  describe('request', () => {
    it('creates one pending request with the reason, audits it and announces it', async () => {
      const id = await rejectedInvoice();
      await svc().nitException.request(id, { reason: `  ${REASON}  ` });
      const [request] = await requests(id);
      expect(request).toMatchObject({ type: 'NIT_EXCEPTION', status: 'PENDING', requestedById: issuer.userId, requesterComment: REASON });
      expect((await audits('invoicing.invoice.nit-exception-request'))[0]).toMatchObject({ entityId: id, userId: issuer.userId, after: { reason: REASON } });
      expect(await events('invoicing.nit-exception.requested')).toHaveLength(1);
      // the invoice is not touched until somebody decides
      expect(await invoiceRow(id)).toMatchObject({ status: 'REJECTED', nitException: false });
    });

    it('needs a reason of a sensible length', async () => {
      const id = await rejectedInvoice();
      expect(await detailsOf(svc().nitException.request(id, { reason: '   ' }))).toEqual([{ field: 'reason', error: 'REASON_REQUIRED' }]);
      expect(await detailsOf(svc().nitException.request(id, { reason: 'corto' }))).toEqual([{ field: 'reason', error: 'REASON_TOO_SHORT' }]);
      expect(await requests(id)).toHaveLength(0);
    });

    it('is refused when the company does not allow it', async () => {
      const id = await rejectedInvoice();
      await state.base.companySetting.create({ data: { companyId: state.companyId, key: 'invoicing.allowNitException', value: false } });
      expect(await codeOf(svc().nitException.request(id, { reason: REASON }))).toBe('NIT_EXCEPTION_DISABLED');
      expect(await requests(id)).toHaveLength(0);
    });

    it('allows one pending request per invoice, even from two callers at once', async () => {
      const id = await rejectedInvoice();
      const outcomes = await Promise.all([codeOf(svc().nitException.request(id, { reason: REASON })), codeOf(svc().nitException.request(id, { reason: REASON }))]);
      expect(outcomes.filter((o) => o === null)).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'NIT_EXCEPTION_ALREADY_PENDING')).toHaveLength(1);
      expect(await requests(id)).toHaveLength(1);
    });

    it('only an invoice the SIN refused or that still waits can ask; an unknown one is not found', async () => {
      const valid = await rejectedInvoice('VALID');
      expect(await codeOf(svc().nitException.request(valid, { reason: REASON }))).toBe('INVOICE_NOT_ISSUABLE');
      expect(await codeOf(svc().nitException.request(randomUUID(), { reason: REASON }))).toBe('INVOICE_NOT_FOUND');
      const pending = await rejectedInvoice('PENDING');
      await expect(svc().nitException.request(pending, { reason: REASON })).resolves.toBeUndefined();
    });

    it('does not ask again once the exception is approved', async () => {
      const id = await rejectedInvoice();
      await state.base.invoice.update({ where: { id }, data: { nitException: true } });
      expect(await codeOf(svc().nitException.request(id, { reason: REASON }))).toBe('NIT_EXCEPTION_ALREADY_APPROVED');
    });

    it('an exception approved for one NIT does not cover another: correcting the customer drops it', async () => {
      const id = await rejectedInvoice();
      await state.base.invoice.update({ where: { id }, data: { nitException: true, nitVerifiedAt: null } });
      // same document: the exception stays
      await svc().invoiceIssuing.updateCustomer(id, { name: 'Otra razón social', documentType: 5, documentNumber: '9991234' });
      expect((await invoiceRow(id)).nitException).toBe(true);
      // a different document: it is a different NIT for the SIN, so the exception is gone
      await svc().invoiceIssuing.updateCustomer(id, { name: 'Otra razón social', documentType: 5, documentNumber: '9995555' });
      expect(await invoiceRow(id)).toMatchObject({ nitException: false, nitVerifiedAt: null, customerDocumentNumber: '9995555' });
    });
  });

  describe('decision', () => {
    it('an approval marks the invoice with the exception and sends it again, all audited', async () => {
      const id = await rejectedInvoice();
      await svc().nitException.request(id, { reason: REASON });
      await svc(approver).nitException.approve(id, { comment: 'Autorizado por gerencia' });

      const [request] = await requests(id);
      expect(request).toMatchObject({ status: 'APPROVED', decidedById: approver.userId, comment: 'Autorizado por gerencia' });
      expect(request.decidedAt).not.toBeNull();
      // sending again with the exception: REJECTED → PENDING → SENDING, and the attempt is published
      expect(await invoiceRow(id)).toMatchObject({ status: 'SENDING', nitException: true });
      const manual = (await events('invoice.issue')).filter((e) => (e.payload as { manual?: boolean }).manual === true);
      expect(manual).toHaveLength(1);
      expect((await audits('invoicing.invoice.nit-exception-approve'))[0]).toMatchObject({ entityId: id, userId: approver.userId });
      expect(await events('invoicing.nit-exception.decided')).toHaveLength(1);
    });

    it('a rejection leaves the invoice as it was and needs a reply', async () => {
      const id = await rejectedInvoice();
      await svc().nitException.request(id, { reason: REASON });
      expect(await detailsOf(svc(approver).nitException.reject(id, {}))).toEqual([{ field: 'comment', error: 'COMMENT_REQUIRED' }]);
      await svc(approver).nitException.reject(id, { comment: 'Pida al cliente su NIT' });
      const [request] = await requests(id);
      expect(request).toMatchObject({ status: 'REJECTED', decidedById: approver.userId, comment: 'Pida al cliente su NIT' });
      expect(await invoiceRow(id)).toMatchObject({ status: 'REJECTED', nitException: false });
      expect((await audits('invoicing.invoice.nit-exception-reject')).length).toBe(1);
      // after a rejection the cashier can ask again
      await expect(svc().nitException.request(id, { reason: REASON })).resolves.toBeUndefined();
    });

    it('decides nothing when no request waits, and a second decision loses to the first', async () => {
      const id = await rejectedInvoice();
      expect(await codeOf(svc(approver).nitException.approve(id, {}))).toBe('NIT_EXCEPTION_NOT_PENDING');
      await svc().nitException.request(id, { reason: REASON });
      const outcomes = await Promise.all([codeOf(svc(approver).nitException.reject(id, { comment: 'No' })), codeOf(svc(approver).nitException.reject(id, { comment: 'No' }))]);
      expect(outcomes.filter((o) => o === null)).toHaveLength(1);
      expect(outcomes.filter((o) => o === 'NIT_EXCEPTION_NOT_PENDING')).toHaveLength(1);
    });

    it('never reaches another company', async () => {
      const id = await rejectedInvoice();
      await svc().nitException.request(id, { reason: REASON });
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(otherApprover).nitException.approve(id, {}))).toBe('INVOICE_NOT_FOUND');
      fx.useCompany(state.companyId);
      expect((await requests(id))[0].status).toBe('PENDING');
    });
  });

  describe('approvals inbox', () => {
    it('lists the pending request for who holds the permission, with the invoice, the sale and the customer', async () => {
      const id = await rejectedInvoice();
      await svc().nitException.request(id, { reason: REASON });
      const inbox = await svc(approver).approvals.list();
      const group = inbox.groups.find((g) => g.type === 'NIT_EXCEPTION');
      expect(group?.count).toBe(1);
      expect(group?.items[0]).toMatchObject({ type: 'NIT_EXCEPTION', subjectId: id, number: '000004', comment: REASON, customerName: expect.any(String), amount: null });
      // who cannot decide it does not see it
      expect((await svc(issuer).approvals.list()).groups.find((g) => g.type === 'NIT_EXCEPTION')).toBeUndefined();
    });
  });
});
