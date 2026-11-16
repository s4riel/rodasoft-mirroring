/**
 * Integration test of the credit and debit notes (HU-FAC-11, HU-FAC-12) against the real Postgres: the list and its indicators,
 * the detail, tenant isolation, the price-adjustment gate, "only what was invoiced is credited" (also under concurrency), issuing
 * by hand and the documents of a valid note.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, type Caller } from '../sales/pos/pos.int-fixture';

const fx = createPosFixture('creditnotes');
const { state } = fx;

describe('Credit notes (integration, real Postgres)', () => {
  let manager: Caller;
  let viewer: Caller;
  let otherManager: Caller;

  beforeAll(async () => {
    await fx.setup();
    manager = await fx.newMember('notemanager', state.companyId);
    fx.grant(manager, 'sales.history.view-all', 'invoicing.invoices.view', 'invoicing.notes.issue', 'sales.returns.manage');
    viewer = await fx.newMember('noteviewer', state.companyId);
    fx.grant(viewer, 'sales.history.view-all', 'invoicing.invoices.view');
    otherManager = await fx.newMember('noteother', state.otherCompanyId);
    fx.grant(otherManager, 'sales.history.view-all', 'invoicing.invoices.view', 'invoicing.notes.issue');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    const where = { companyId: state.companyId };
    await state.base.companySetting.deleteMany({ where: { ...where, key: { startsWith: 'invoicing.' } } });
    await state.base.creditNoteDocument.deleteMany({ where });
    await state.base.creditNote.deleteMany({ where });
    await state.base.saleReturn.deleteMany({ where });
    await state.base.invoiceDocument.deleteMany({ where });
    await state.base.invoice.deleteMany({ where });
    await state.base.sale.deleteMany({ where });
    await state.base.cashMovement.deleteMany({ where });
    await state.base.posCheckoutItem.deleteMany({ where });
    await state.base.posCheckout.deleteMany({ where });
    await state.base.outboxEvent.deleteMany({ where });
    await state.base.auditLog.deleteMany({ where });
  });

  const svc = (caller: Caller = manager) => fx.as(caller);
  const setSetting = (key: string, value: unknown) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key } },
      create: { companyId: state.companyId, key, value: value as never },
      update: { value: value as never },
    });
  const events = (type = 'credit-note.issue') => state.base.outboxEvent.findMany({ where: { companyId: state.companyId, type }, orderBy: { id: 'asc' } });

  /** Sells 4 pieces of one product at 100.00 each in cash and makes its invoice VALID. */
  async function sellValid() {
    const product = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 50 } });
    await svc(state.cashier).checkout.addItem({ productId: product.id, quantity: 4 });
    const { total } = await svc(state.cashier).payment.pay();
    const done = await svc(state.cashier).payment.complete({ payments: [{ method: 'CASH', received: total }], expectedTotal: total, idempotencyKey: randomUUID() });
    const invoice = await state.base.invoice.update({ where: { saleId: done.sale.saleId }, data: { status: 'VALID', number: 70, cuf: `CUF-${randomUUID().slice(0, 8)}`, issuedAt: new Date() } });
    const item = await state.base.saleItem.findFirstOrThrow({ where: { saleId: done.sale.saleId } });
    return { invoice, item, saleId: done.sale.saleId };
  }

  const adjust = (invoiceId: string, items: { saleItemId: string; quantity: number; amount: string }[], reasonCode = 4, caller: Caller = manager) =>
    svc(caller).creditNotes.createPriceAdjustment(invoiceId, { reasonCode, items });

  describe('price-adjustment notes (HU-FAC-12)', () => {
    it('are refused while the company does not allow them', async () => {
      const { invoice, item } = await sellValid();
      expect(await codeOf(adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '10.00' }]))).toBe('PRICE_ADJUSTMENT_NOT_ALLOWED');
      expect(await state.base.creditNote.count({ where: { companyId: state.companyId } })).toBe(0);
    });

    it('create a PENDING note without a return, with its VAT, lines, audit and the first attempt published', async () => {
      await setSetting('invoicing.allowPriceAdjustmentNotes', true);
      const { invoice, item } = await sellValid();
      const created = await adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '40.00' }]);
      const note = await state.base.creditNote.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } });
      expect(note).toMatchObject({ status: 'PENDING', returnId: null, reasonCode: 4, number: null, branchId: invoice.branchId });
      expect(note.total.toFixed(2)).toBe('40.00');
      expect(note.vatAdjusted.toFixed(2)).toBe('5.20');
      expect(note.items).toHaveLength(1);
      expect(await state.base.auditLog.count({ where: { entity: 'CreditNote', entityId: note.id, action: 'invoicing.note.create' } })).toBe(1);
      expect((await events())[0]).toMatchObject({ idempotencyKey: `credit-note-issue:${note.id}:1`, payload: { creditNoteId: note.id, manual: false } });
    });

    it('refuse an invoice that is not VALID, an unknown reason and an empty or malformed note', async () => {
      await setSetting('invoicing.allowPriceAdjustmentNotes', true);
      const { invoice, item } = await sellValid();
      await state.base.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } });
      expect(await codeOf(adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '10.00' }]))).toBe('INVOICE_NOT_CREDITABLE');
      await state.base.invoice.update({ where: { id: invoice.id }, data: { status: 'VALID' } });
      expect(await codeOf(adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '10.00' }], 99))).toBe('VALIDATION_FAILED');
      expect(await codeOf(adjust(invoice.id, []))).toBe('VALIDATION_FAILED');
      expect(await codeOf(adjust(invoice.id, [{ saleItemId: randomUUID(), quantity: 0, amount: '10.00' }]))).toBe('VALIDATION_FAILED');
      expect(await codeOf(adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '0.00' }]))).toBe('VALIDATION_FAILED');
    });

    it('credit only what was invoiced, counting the notes already made', async () => {
      await setSetting('invoicing.allowPriceAdjustmentNotes', true);
      const { invoice, item } = await sellValid();
      expect(await codeOf(adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '400.01' }]))).toBe('CREDIT_EXCEEDS_INVOICED');
      await adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '300.00' }]);
      expect(await codeOf(adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '100.01' }]))).toBe('CREDIT_EXCEEDS_INVOICED');
      await adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '100.00' }]);
      const creditable = await svc().creditNoteQueries.creditable(invoice.id);
      expect(creditable).toMatchObject({ credited: '400.00', total: '400.00', priceAdjustmentAllowed: true, saleId: invoice.saleId });
      expect(creditable.lines[0]).toMatchObject({ creditableAmount: '0.00', creditableQuantity: 4, invoicedAmount: '400.00' });
    });

    it('a voided note frees what it credited', async () => {
      await setSetting('invoicing.allowPriceAdjustmentNotes', true);
      const { invoice, item } = await sellValid();
      const created = await adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '400.00' }]);
      await svc().creditNotes.voidNote(created.id);
      expect((await state.base.creditNote.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('CANCELLED');
      expect(await state.base.auditLog.count({ where: { entityId: created.id, action: 'invoicing.note.void' } })).toBe(1);
      await adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '400.00' }]);
    });

    it('only a note the SIAT never validated can be voided', async () => {
      await setSetting('invoicing.allowPriceAdjustmentNotes', true);
      const { invoice, item } = await sellValid();
      const created = await adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '40.00' }]);
      await state.base.creditNote.update({ where: { id: created.id }, data: { status: 'SENDING' } });
      expect(await codeOf(svc().creditNotes.voidNote(created.id))).toBe('NOTE_NOT_VOIDABLE');
      await state.base.creditNote.update({ where: { id: created.id }, data: { status: 'VALID' } });
      expect(await codeOf(svc().creditNotes.voidNote(created.id))).toBe('NOTE_NOT_VOIDABLE');
      expect(await codeOf(svc().creditNotes.voidNote(randomUUID()))).toBe('CREDIT_NOTE_NOT_FOUND');
    });

    it('a return cannot credit a line more than what price adjustments left of it', async () => {
      await setSetting('invoicing.allowPriceAdjustmentNotes', true);
      const { invoice, item, saleId } = await sellValid();
      await adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '400.00' }]);
      const attempt = svc(state.cashier).returns.create(
        { saleId, reason: 'FACTORY_DEFECT', refundMethod: 'CASH', items: [{ saleItemId: item.id, quantity: 1, condition: 'RESTOCK' }] } as never,
        randomUUID(),
      );
      expect(await codeOf(attempt)).toBe('CREDIT_EXCEEDS_INVOICED');
      expect(await state.base.saleReturn.count({ where: { saleId } })).toBe(0);
    });

    it('two concurrent notes over the same line: one wins, the other is refused', async () => {
      await setSetting('invoicing.allowPriceAdjustmentNotes', true);
      const { invoice, item } = await sellValid();
      const results = await Promise.allSettled([
        adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '300.00' }]),
        adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '300.00' }]),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((failed.reason as { getResponse: () => { code: string } }).getResponse().code).toBe('CREDIT_EXCEEDS_INVOICED');
      expect(await state.base.creditNote.count({ where: { companyId: state.companyId } })).toBe(1);
    });
  });

  describe('list and detail (HU-FAC-11)', () => {
    async function noteOfReturn() {
      const sold = await sellValid();
      const detail = await svc(state.cashier).returns.create(
        { saleId: sold.saleId, reason: 'FACTORY_DEFECT', refundMethod: 'CASH', items: [{ saleItemId: sold.item.id, quantity: 1, condition: 'RESTOCK' }] } as never,
        randomUUID(),
      );
      const note = await state.base.creditNote.findUniqueOrThrow({ where: { returnId: detail.id } });
      return { ...sold, note, returnNumber: detail.number };
    }

    it('lists with the row actions of the caller, the total and the indicators', async () => {
      const { note, returnNumber } = await noteOfReturn();
      const all = await svc().creditNoteQueries.list({});
      expect(all.total).toBe(1);
      expect(all.totalAmount).toBe('100.00');
      expect(all.items[0]).toMatchObject({ id: note.id, status: 'PENDING', returnNumber, total: '100.00', number: null, actions: ['VIEW_DETAIL', 'ISSUE', 'VOID'] });
      expect(all.kpis).toEqual({ issuedThisMonth: { count: 0, total: '0.00' }, notIssued: 1, fromReturns: 0, rejected: 0 });
      expect((await svc(viewer).creditNoteQueries.list({})).items[0].actions).toEqual(['VIEW_DETAIL']);

      await state.base.creditNote.update({ where: { id: note.id }, data: { status: 'VALID', number: 3, cuf: 'C', issuedAt: new Date() } });
      expect((await svc().creditNoteQueries.list({})).kpis).toEqual({ issuedThisMonth: { count: 1, total: '100.00' }, notIssued: 0, fromReturns: 1, rejected: 0 });
    });

    it('filters by status, text, branch and dates, and rejects an empty range', async () => {
      const { note, invoice } = await noteOfReturn();
      expect((await svc().creditNoteQueries.list({ status: 'VALID' })).total).toBe(0);
      expect((await svc().creditNoteQueries.list({ status: 'PENDING' })).items.map((n) => n.id)).toEqual([note.id]);
      expect((await svc().creditNoteQueries.list({ q: 'DEV-' })).total).toBe(1);
      expect((await svc().creditNoteQueries.list({ q: String(invoice.number) })).total).toBe(1);
      expect((await svc().creditNoteQueries.list({ q: 'no-such-customer' })).total).toBe(0);
      expect((await svc().creditNoteQueries.list({ branchId: randomUUID() })).total).toBe(0);
      expect(await codeOf(svc().creditNoteQueries.list({ from: '2026-11-12', to: '2026-11-01' }))).toBe('INVALID_FILTER');
    });

    it('shows the detail with the adjusted VAT, the linked return, the original invoice and the history', async () => {
      const { note, returnNumber, invoice } = await noteOfReturn();
      const detail = await svc().creditNoteQueries.detail(note.id);
      expect(detail).toMatchObject({ id: note.id, returnNumber, vatAdjusted: '13.00', total: '100.00', reasonCode: 2, invoice: { id: invoice.id, number: 70, status: 'VALID' } });
      expect(detail.lines).toHaveLength(1);
      expect(detail.lines[0]).toMatchObject({ quantity: 1, amount: '100.00' });
      expect(await codeOf(svc().creditNoteQueries.detail(randomUUID()))).toBe('CREDIT_NOTE_NOT_FOUND');
    });

    it('never shows a note of another company', async () => {
      const { note } = await noteOfReturn();
      fx.useCompany(state.otherCompanyId);
      expect((await svc(otherManager).creditNoteQueries.list({})).total).toBe(0);
      expect(await codeOf(svc(otherManager).creditNoteQueries.detail(note.id))).toBe('CREDIT_NOTE_NOT_FOUND');
      expect(await codeOf(svc(otherManager).creditNotes.issue(note.id))).toBe('CREDIT_NOTE_NOT_FOUND');
    });
  });

  describe('issuing by hand', () => {
    async function pendingNote() {
      await setSetting('invoicing.allowPriceAdjustmentNotes', true);
      const { invoice, item } = await sellValid();
      const created = await adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '40.00' }]);
      await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
      return created.id;
    }

    it('moves a PENDING note to SENDING with an audit and a manual event, once even under concurrency', async () => {
      const id = await pendingNote();
      const results = await Promise.allSettled([svc().creditNotes.issue(id), svc().creditNotes.issue(id)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((failed.reason as { getResponse: () => { code: string } }).getResponse().code).toBe('NOTE_ALREADY_SENDING');
      expect((await state.base.creditNote.findUniqueOrThrow({ where: { id } })).status).toBe('SENDING');
      const published = await events();
      expect(published).toHaveLength(1);
      expect(published[0].payload).toMatchObject({ creditNoteId: id, manual: true });
      expect(await state.base.auditLog.count({ where: { entityId: id, action: 'invoicing.note.issue' } })).toBe(1);
    });

    it('sends a REJECTED note again, lets a stuck SENDING one be retried, and refuses a VALID one', async () => {
      const id = await pendingNote();
      await state.base.creditNote.update({ where: { id }, data: { status: 'REJECTED', rejectionCode: 1037 } });
      await svc().creditNotes.issue(id);
      expect((await state.base.creditNote.findUniqueOrThrow({ where: { id } })).status).toBe('SENDING');
      await state.base.creditNote.update({ where: { id }, data: { lastAttemptAt: new Date(Date.now() - 3_600_000) } });
      await svc().creditNotes.issue(id);
      await state.base.creditNote.update({ where: { id }, data: { status: 'VALID' } });
      expect(await codeOf(svc().creditNotes.issue(id))).toBe('NOTE_NOT_ISSUABLE');
    });
  });

  describe('documents', () => {
    it('are refused until the SIAT validated the note, then give the PDF and the XML', async () => {
      await setSetting('invoicing.allowPriceAdjustmentNotes', true);
      const { invoice, item } = await sellValid();
      const { id } = await adjust(invoice.id, [{ saleItemId: item.id, quantity: 0, amount: '40.00' }]);
      expect(await codeOf(svc().creditNoteQueries.pdfOf(id))).toBe('NOTE_NOT_ISSUED');
      await state.base.creditNote.update({ where: { id }, data: { status: 'VALID', number: 9, cuf: 'ABCDEF0123', issuedAt: new Date() } });
      await state.base.creditNoteDocument.create({ data: { creditNoteId: id, companyId: state.companyId, signedXml: '<nota/>' } });
      const pdf = await svc().creditNoteQueries.pdfOf(id);
      expect(pdf).toMatchObject({ filename: 'nota-credito-debito-000009.pdf', contentType: 'application/pdf' });
      expect(pdf.content.subarray(0, 5).toString()).toBe('%PDF-');
      const xml = await svc().creditNoteQueries.xmlOf(id);
      expect(xml).toMatchObject({ filename: 'nota-credito-debito-000009.xml', contentType: 'application/xml' });
      expect(xml.content.toString()).toBe('<nota/>');
    });
  });
});
