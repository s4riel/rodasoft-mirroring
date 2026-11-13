/**
 * Integration test of the invoice documents (HU-FAC-03, 05, 06) against the real Postgres: the PDF and XML of an issued invoice,
 * the ZIP of several, and the delivery by e-mail (an outbox event with the attachments) and by WhatsApp (a link), all audited.
 */
import JSZip from 'jszip';
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, detailsOf, type Caller } from '../sales/pos/pos.int-fixture';

const fx = createPosFixture('invdocs');
const { state } = fx;

const six = (n: number | null) => String(n).padStart(6, '0');

describe('Invoice documents (integration, real Postgres)', () => {
  let manager: Caller;
  let otherManager: Caller;

  beforeAll(async () => {
    await fx.setup();
    manager = await fx.newMember('manager', state.companyId);
    fx.grant(manager, 'sales.history.view-all', 'invoicing.invoices.view');
    otherManager = await fx.newMember('othermanager', state.otherCompanyId);
    fx.grant(otherManager, 'sales.history.view-all', 'invoicing.invoices.view');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.invoiceDocument.deleteMany({ where: { companyId: state.companyId } });
    await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
    await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.customer.deleteMany({ where: { companyId: state.companyId, documentNumber: { startsWith: '9' } } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
  });

  const svc = (caller: Caller = manager) => fx.as(caller);
  let counter = 0;

  /** A sale in cash with its invoice; `issued` makes it VALID with the signed XML the worker would have stored. */
  async function sell(options: { issued?: boolean; caller?: Caller; customerEmail?: string } = {}) {
    const caller = options.caller ?? state.cashier;
    const product = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 50 } });
    await svc(caller).checkout.addItem({ productId: product.id, quantity: 2 });
    const { total } = await svc(caller).payment.pay();
    const done = await svc(caller).payment.complete({ payments: [{ method: 'CASH', received: total }], expectedTotal: total, idempotencyKey: randomUUID() });
    const invoice = await state.base.invoice.findUniqueOrThrow({ where: { saleId: done.sale.saleId } });
    counter += 1;
    if (options.customerEmail !== undefined) {
      const customer = await state.base.customer.create({
        data: { companyId: state.companyId, name: 'Cliente', documentType: 1, documentNumber: `9${Date.now()}${counter}`.slice(0, 12), email: options.customerEmail || null },
      });
      await state.base.sale.update({ where: { id: done.sale.saleId }, data: { customerId: customer.id } });
    }
    if (options.issued) {
      await state.base.invoice.update({
        where: { id: invoice.id },
        data: { status: 'VALID', number: counter, cuf: `ABCDEF${counter}SIM0`, issuedAt: new Date(), siatReceptionCode: 'SIM-1' },
      });
      await state.base.invoiceDocument.create({ data: { invoiceId: invoice.id, companyId: state.companyId, signedXml: `<factura n="${counter}"/>` } });
    }
    return { id: invoice.id, number: options.issued ? counter : null };
  }
  const events = (type: string) => state.base.outboxEvent.findMany({ where: { companyId: state.companyId, type } });
  const audits = (action: string) => state.base.auditLog.findMany({ where: { companyId: state.companyId, action } });

  describe('PDF and XML', () => {
    it('gives the PDF and the signed XML of an issued invoice', async () => {
      const { id, number } = await sell({ issued: true });
      const pdf = await svc().invoiceDocuments.pdfOf(id);
      expect(pdf).toMatchObject({ filename: `factura-${six(number)}.pdf`, contentType: 'application/pdf' });
      expect(pdf.content.subarray(0, 5).toString()).toBe('%PDF-');
      const xml = await svc().invoiceDocuments.xmlOf(id);
      expect(xml.contentType).toBe('application/xml');
      expect(xml.content.toString()).toBe(`<factura n="${number}"/>`);
    });

    it('refuses an invoice the SIAT has not issued, and one that does not exist or belongs to another company', async () => {
      const pending = await sell();
      expect(await codeOf(svc().invoiceDocuments.pdfOf(pending.id))).toBe('INVOICE_NOT_ISSUED');
      expect(await codeOf(svc().invoiceDocuments.xmlOf(pending.id))).toBe('INVOICE_NOT_ISSUED');
      expect(await codeOf(svc().invoiceDocuments.pdfOf(randomUUID()))).toBe('INVOICE_NOT_FOUND');

      const issued = await sell({ issued: true });
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(otherManager).invoiceDocuments.pdfOf(issued.id))).toBe('INVOICE_NOT_FOUND');
    });

    it('keeps the documents of a cancelled invoice and hides it from who cannot see every sale', async () => {
      const mine = await sell({ issued: true, caller: state.cashier });
      await state.base.invoice.update({ where: { id: mine.id }, data: { status: 'CANCELLED' } });
      expect((await svc().invoiceDocuments.pdfOf(mine.id)).content.length).toBeGreaterThan(100);
      // the second cashier has no history permission: only their own sales are visible
      expect(await codeOf(svc(state.second).invoiceDocuments.pdfOf(mine.id))).toBe('INVOICE_NOT_FOUND');
    });
  });

  describe('download', () => {
    it('zips one file per issued invoice and lists the ones left out', async () => {
      const a = await sell({ issued: true });
      const b = await sell({ issued: true });
      const pending = await sell();
      const missing = randomUUID();
      const result = await svc().invoiceDocuments.download([a.id, b.id, pending.id, missing, a.id], 'PDF');
      expect(result).toMatchObject({ contentType: 'application/zip', filename: 'facturas-pdf.zip' });
      expect(result.included).toEqual([a.id, b.id]);
      expect(result.skipped).toEqual([pending.id, missing]);
      const zip = await JSZip.loadAsync(result.content);
      expect(Object.keys(zip.files).sort()).toEqual([`factura-${six(a.number)}.pdf`, `factura-${six(b.number)}.pdf`].sort());
      expect(await audits('invoicing.invoice.download')).toHaveLength(1);
    });

    it('zips the XML too', async () => {
      const a = await sell({ issued: true });
      const zip = await JSZip.loadAsync((await svc().invoiceDocuments.download([a.id], 'XML')).content);
      expect(await zip.file(`factura-${six(a.number)}.xml`)?.async('string')).toBe(`<factura n="${a.number}"/>`);
    });
  });

  describe('delivery', () => {
    it('queues an e-mail with the PDF and the XML attached and audits it', async () => {
      const { id, number } = await sell({ issued: true });
      const answer = await svc().invoiceDocuments.deliver(id, 'EMAIL', ' ana@demo.test ');
      expect(answer).toEqual({ channel: 'EMAIL', url: null });
      const [event] = await events('invoice.email');
      const payload = event.payload as Record<string, string>;
      expect(payload).toMatchObject({ email: 'ana@demo.test', number: six(number) });
      expect(Buffer.from(payload['pdfBase64'], 'base64').subarray(0, 5).toString()).toBe('%PDF-');
      expect(Buffer.from(payload['xmlBase64'], 'base64').toString()).toBe(`<factura n="${number}"/>`);
      const [audit] = await audits('invoicing.invoice.deliver');
      expect(audit).toMatchObject({ entityId: id, userId: manager.userId, after: { channel: 'EMAIL', recipient: 'ana@demo.test' } });
    });

    it('builds a WhatsApp link with the verification URL, publishes nothing and audits it', async () => {
      const { id } = await sell({ issued: true });
      const answer = await svc().invoiceDocuments.deliver(id, 'WHATSAPP', '+591 7123 4567');
      expect(answer.url).toMatch(/^https:\/\/wa\.me\/59171234567\?text=/);
      expect(decodeURIComponent(answer.url ?? '')).toContain('consulta/QR');
      expect(await events('invoice.email')).toHaveLength(0);
      expect((await audits('invoicing.invoice.deliver'))[0].after).toMatchObject({ channel: 'WHATSAPP' });
    });

    it('rejects an invalid e-mail or phone, and an invoice not issued, without leaving anything behind', async () => {
      const issued = await sell({ issued: true });
      expect(await codeOf(svc().invoiceDocuments.deliver(issued.id, 'EMAIL', 'not-an-email'))).toBe('VALIDATION_FAILED');
      expect(await detailsOf(svc().invoiceDocuments.deliver(issued.id, 'WHATSAPP', '2123456'))).toEqual([{ field: 'recipient', error: 'PHONE_INVALID' }]);
      const pending = await sell();
      expect(await codeOf(svc().invoiceDocuments.deliver(pending.id, 'EMAIL', 'ana@demo.test'))).toBe('INVOICE_NOT_ISSUED');
      expect(await events('invoice.email')).toHaveLength(0);
      expect(await audits('invoicing.invoice.deliver')).toHaveLength(0);
    });

    it('e-mails several invoices to their customers and says which ones cannot be sent', async () => {
      const withEmail = await sell({ issued: true, customerEmail: 'cliente@demo.test' });
      const withoutEmail = await sell({ issued: true, customerEmail: '' });
      const notIssued = await sell({ customerEmail: 'otro@demo.test' });
      const missing = randomUUID();
      const results = await svc().invoiceDocuments.deliverMany([withEmail.id, withoutEmail.id, notIssued.id, missing]);
      expect(results).toEqual([
        { id: withEmail.id, ok: true },
        { id: withoutEmail.id, ok: false, code: 'CUSTOMER_WITHOUT_EMAIL' },
        { id: notIssued.id, ok: false, code: 'INVOICE_NOT_ISSUED' },
        { id: missing, ok: false, code: 'INVOICE_NOT_FOUND' },
      ]);
      expect(await events('invoice.email')).toHaveLength(1);
    });
  });
});
