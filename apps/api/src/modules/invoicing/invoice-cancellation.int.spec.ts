/**
 * Integration test of cancelling a valid invoice (HU-FAC-09, HU-FAC-10) against the real Postgres: the request from the invoice, the
 * approval that cancels in the SIAT before any stock or cash moves, and what happens when the SIAT is offline or refuses, when two
 * people decide at once, when a withdraw races an approval, and when a crash left the invoice halfway.
 */
import { randomUUID } from 'node:crypto';
import { codeOf, createPosFixture, detailsOf, type Caller } from '../sales/pos/pos.int-fixture';

const fx = createPosFixture('invcancel');
const { state } = fx;

describe('Invoice cancellation (integration, real Postgres)', () => {
  let manager: Caller;
  let approver: Caller;
  let secondApprover: Caller;
  let otherApprover: Caller;

  beforeAll(async () => {
    await fx.setup();
    manager = await fx.newMember('manager', state.companyId);
    fx.grant(manager, 'sales.history.view-all', 'invoicing.invoices.view', 'sales.cancellations.request');
    approver = await fx.newMember('approver', state.companyId);
    fx.grant(approver, 'sales.history.view-all', 'sales.cancellations.approve');
    secondApprover = await fx.newMember('approver2', state.companyId);
    fx.grant(secondApprover, 'sales.history.view-all', 'sales.cancellations.approve');
    otherApprover = await fx.newMember('otherapprover', state.otherCompanyId);
    fx.grant(otherApprover, 'sales.history.view-all', 'sales.cancellations.approve');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: { in: ['invoicing.simulatorMode', 'sales.cancellationWindowDays'] } } });
    await state.base.cashShift.updateMany({ where: { companyId: state.companyId, status: 'CLOSED' }, data: { status: 'OPEN' } });
    await state.base.approvalRequest.deleteMany({ where: { companyId: state.companyId } });
    await state.base.invoiceDocument.deleteMany({ where: { companyId: state.companyId } });
    await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
    await state.base.simulatedSiatRecord.deleteMany({ where: { companyId: state.companyId } });
    await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
    await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckoutItem.deleteMany({ where: { companyId: state.companyId } });
    await state.base.posCheckout.deleteMany({ where: { companyId: state.companyId } });
    await state.base.outboxEvent.deleteMany({ where: { companyId: state.companyId } });
    await state.base.auditLog.deleteMany({ where: { companyId: state.companyId } });
  });

  const svc = (caller: Caller = state.cashier) => fx.as(caller);
  const COMMENT = 'La factura salió con los datos de otra empresa';
  let counter = 0;

  /** A cash sale of `quantity` units whose invoice the SIAT accepted (and whose SIN record exists), unless `known` is false. */
  async function sellIssued(options: { quantity?: number; known?: boolean } = {}) {
    const product = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 50 } });
    await svc().checkout.addItem({ productId: product.id, quantity: options.quantity ?? 2 });
    const { total } = await svc().payment.pay();
    const done = await svc().payment.complete({ payments: [{ method: 'CASH', received: total }], expectedTotal: total, idempotencyKey: randomUUID() });
    const invoice = await state.base.invoice.findUniqueOrThrow({ where: { saleId: done.sale.saleId } });
    counter += 1;
    const cuf = `CAFE${counter}${randomUUID().slice(0, 8).toUpperCase()}SIM0`;
    await state.base.invoice.update({ where: { id: invoice.id }, data: { status: 'VALID', number: counter, cuf, issuedAt: new Date(), siatReceptionCode: 'SIM-1' } });
    if (options.known !== false) await state.base.simulatedSiatRecord.create({ data: { cuf, companyId: state.companyId, receptionCode: 'SIM-1' } });
    return { saleId: done.sale.saleId, invoiceId: invoice.id, productId: product.id, cuf, quantity: options.quantity ?? 2 };
  }

  const askFromInvoice = (invoiceId: string, reasonCode = 3, comment = COMMENT) => svc(manager).invoiceCancellations.request(invoiceId, { reasonCode, comment });
  const approve = (saleId: string, caller: Caller = approver) => svc(caller).cancellations.approve(saleId, { comment: 'Aprobado' });
  const invoiceRow = (id: string) => state.base.invoice.findUniqueOrThrow({ where: { id } });
  const saleRow = (id: string) => state.base.sale.findUniqueOrThrow({ where: { id } });
  const requests = (saleId: string) => state.base.approvalRequest.findMany({ where: { subjectId: saleId } });
  const onHand = async (productId: string) => (await state.base.stockLevel.findFirstOrThrow({ where: { productId, warehouseId: state.centralId } })).quantity;
  const returns = (productId: string) => state.base.stockMovement.count({ where: { productId, type: 'SALE_CANCELLATION' } });
  const refunds = (saleId: string) => state.base.cashMovement.count({ where: { refId: saleId, type: 'REFUND' } });
  const siatCancelled = async (cuf: string) => (await state.base.simulatedSiatRecord.findUniqueOrThrow({ where: { cuf } })).cancelledAt !== null;
  const audits = (action: string) => state.base.auditLog.findMany({ where: { companyId: state.companyId, action } });
  const setSetting = (key: string, value: unknown) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key } },
      create: { companyId: state.companyId, key, value: value as never },
      update: { value: value as never },
    });

  describe('asking from the invoice', () => {
    it('puts the sale in CANCELLATION_PENDING, keeps the invoice VALID and carries the SIN reason', async () => {
      const { saleId, invoiceId } = await sellIssued();
      expect(await askFromInvoice(invoiceId, 3)).toEqual({ saleId, status: 'CANCELLATION_PENDING' });
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
      expect((await invoiceRow(invoiceId)).status).toBe('VALID');
      const [request] = await requests(saleId);
      expect(request).toMatchObject({ type: 'CANCELLATION', status: 'PENDING', reason: 'SIN_3', requesterComment: COMMENT });
    });

    it('refuses an unknown SIN reason, an empty comment and an invoice that is not valid', async () => {
      const { invoiceId } = await sellIssued();
      expect(await detailsOf(askFromInvoice(invoiceId, 77))).toEqual([{ field: 'reasonCode', error: 'REASON_INVALID' }]);
      expect(await codeOf(askFromInvoice(invoiceId, 3, '   '))).toBe('VALIDATION_FAILED');
      await state.base.invoice.update({ where: { id: invoiceId }, data: { status: 'REJECTED' } });
      expect(await codeOf(askFromInvoice(invoiceId))).toBe('INVOICE_NOT_CANCELLABLE');
      expect(await codeOf(askFromInvoice(randomUUID()))).toBe('INVOICE_NOT_FOUND');
    });

    it('allows one open request per sale and respects the cancellation window', async () => {
      const { saleId, invoiceId } = await sellIssued();
      await askFromInvoice(invoiceId);
      expect(await codeOf(askFromInvoice(invoiceId))).toBe('CANCELLATION_ALREADY_PENDING');
      expect((await invoiceRow(invoiceId)).status).toBe('VALID');
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');

      const old = await sellIssued();
      await setSetting('sales.cancellationWindowDays', 1);
      await state.base.sale.update({ where: { id: old.saleId }, data: { createdAt: new Date(Date.now() - 5 * 86_400_000) } });
      expect(await codeOf(askFromInvoice(old.invoiceId))).toBe('CANCELLATION_WINDOW_EXPIRED');
    });

    it('lists the open requests for Management with the invoice, the customer and the reason', async () => {
      const { saleId, invoiceId } = await sellIssued();
      await askFromInvoice(invoiceId, 3);
      const { items } = await svc(approver).invoiceCancellations.pending();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ saleId, invoiceId, invoiceStatus: 'VALID', total: '200.00', reason: 'SIN_3', comment: COMMENT, requestedBy: 'User manager' });
      fx.useCompany(state.otherCompanyId);
      expect((await svc(otherApprover).invoiceCancellations.pending()).items).toEqual([]);
    });
  });

  describe('approving', () => {
    it('cancels in the SIAT, then cancels the sale, returns the stock and refunds the cash, once', async () => {
      const { saleId, invoiceId, productId, cuf } = await sellIssued({ quantity: 2 });
      await askFromInvoice(invoiceId, 3);
      expect(await onHand(productId)).toBe(48);

      expect(await approve(saleId)).toEqual({ saleId, status: 'CANCELLED' });
      expect(await siatCancelled(cuf)).toBe(true);
      const invoice = await invoiceRow(invoiceId);
      expect(invoice).toMatchObject({ status: 'CANCELLED', cancellationReasonCode: 3 });
      expect(invoice.cancelledAt).not.toBeNull();
      expect((await saleRow(saleId)).status).toBe('CANCELLED');
      expect((await requests(saleId))[0]).toMatchObject({ status: 'APPROVED', decidedById: approver.userId });
      expect(await onHand(productId)).toBe(50);
      expect(await returns(productId)).toBe(1);
      expect(await refunds(saleId)).toBe(1);
      expect((await audits('invoicing.invoice.cancellation-start')).length).toBe(1);
    });

    it('maps a sale reason to the SIN reason when the request came from the sale', async () => {
      const { saleId, invoiceId, cuf } = await sellIssued();
      await svc(state.cashier).cancellations.request(saleId, { reason: 'CUSTOMER_DATA_ERROR', comment: COMMENT });
      await approve(saleId);
      expect(await siatCancelled(cuf)).toBe(true);
      expect((await invoiceRow(invoiceId)).cancellationReasonCode).toBe(3);
    });

    it('SIAT offline: 503, the invoice is VALID again and nothing moved, so the request can be approved later', async () => {
      const { saleId, invoiceId, productId, cuf } = await sellIssued();
      await askFromInvoice(invoiceId);
      await setSetting('invoicing.simulatorMode', 'OFFLINE');

      expect(await codeOf(approve(saleId))).toBe('SIAT_UNAVAILABLE');
      expect((await invoiceRow(invoiceId)).status).toBe('VALID');
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
      expect((await requests(saleId))[0].status).toBe('PENDING');
      expect(await onHand(productId)).toBe(48);
      expect(await returns(productId)).toBe(0);
      expect(await refunds(saleId)).toBe(0);
      expect(await siatCancelled(cuf)).toBe(false);
      expect((await audits('invoicing.invoice.cancellation-revert'))[0].after).toMatchObject({ why: 'unavailable' });

      // the SIAT is back
      await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'invoicing.simulatorMode' } });
      expect(await approve(saleId)).toEqual({ saleId, status: 'CANCELLED' });
      expect(await returns(productId)).toBe(1);
    });

    it('SIAT refuses: 409 with its messages, nothing moved, the invoice stays VALID', async () => {
      // the SIN has no record of this invoice, so it refuses to cancel it
      const { saleId, invoiceId, productId } = await sellIssued({ known: false });
      await askFromInvoice(invoiceId);
      expect(await codeOf(approve(saleId))).toBe('SIAT_CANCELLATION_REJECTED');
      expect(await detailsOf(approve(saleId))).toEqual([{ code: 905, description: 'FACTURA NO ENCONTRADA' }]);
      expect((await invoiceRow(invoiceId)).status).toBe('VALID');
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
      expect(await returns(productId)).toBe(0);
      expect(await refunds(saleId)).toBe(0);
      expect((await audits('invoicing.invoice.cancellation-revert'))[0].after).toMatchObject({ why: 'refused' });
    });

    it('a closed shift is refused before the SIAT is asked, so the SIAT never cancels what the sale cannot undo', async () => {
      const { saleId, invoiceId, productId, cuf } = await sellIssued();
      await askFromInvoice(invoiceId);
      await state.base.cashShift.updateMany({ where: { companyId: state.companyId, status: 'OPEN' }, data: { status: 'CLOSED' } });
      expect(await codeOf(approve(saleId))).toBe('CASH_SHIFT_NOT_OPEN_FOR_REFUND');
      expect(await siatCancelled(cuf)).toBe(false);
      expect((await invoiceRow(invoiceId)).status).toBe('VALID');
      expect(await returns(productId)).toBe(0);
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
    });

    it('two approvals at once: one cancels, stock and cash move exactly once', async () => {
      const { saleId, invoiceId, productId, cuf } = await sellIssued({ quantity: 3 });
      await askFromInvoice(invoiceId);
      const outcomes = await Promise.all([codeOf(approve(saleId, approver)), codeOf(approve(saleId, secondApprover))]);
      expect(outcomes.filter((o) => o === null)).toHaveLength(1);
      expect(outcomes.filter((o) => o !== null)).toEqual(['CANCELLATION_NOT_PENDING']);
      expect((await saleRow(saleId)).status).toBe('CANCELLED');
      expect((await invoiceRow(invoiceId)).status).toBe('CANCELLED');
      expect(await siatCancelled(cuf)).toBe(true);
      expect(await returns(productId)).toBe(1);
      expect(await refunds(saleId)).toBe(1);
      expect(await onHand(productId)).toBe(50);
    });

    it('an approval racing a withdraw leaves a consistent sale, invoice and SIAT', async () => {
      const { saleId, invoiceId, productId, cuf } = await sellIssued();
      await askFromInvoice(invoiceId);
      const [approval, withdrawal] = await Promise.all([codeOf(approve(saleId)), codeOf(svc(manager).cancellations.withdraw(saleId))]);

      const sale = await saleRow(saleId);
      const invoice = await invoiceRow(invoiceId);
      if (sale.status === 'CANCELLED') {
        expect(approval).toBeNull();
        expect(invoice.status).toBe('CANCELLED');
        expect(await siatCancelled(cuf)).toBe(true);
        expect(await returns(productId)).toBe(1);
        // the withdraw lost: the sale was locked, in progress, or already cancelled
        expect(['CANCELLATION_IN_PROGRESS', 'CANCELLATION_NOT_PENDING']).toContain(withdrawal);
      } else {
        expect(sale.status).toBe('COMPLETED');
        expect(withdrawal).toBeNull();
        expect(invoice.status).toBe('VALID');
        expect(await siatCancelled(cuf)).toBe(false);
        expect(await returns(productId)).toBe(0);
        expect(approval).toBe('CANCELLATION_NOT_PENDING');
      }
    });

    it('while the SIAT cancellation is under way the request can be neither withdrawn nor rejected', async () => {
      const { saleId, invoiceId } = await sellIssued();
      await askFromInvoice(invoiceId);
      await state.base.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLATION_PENDING' } });
      expect(await codeOf(svc(manager).cancellations.withdraw(saleId))).toBe('CANCELLATION_IN_PROGRESS');
      expect(await codeOf(svc(approver).cancellations.reject(saleId, { comment: 'No' }))).toBe('CANCELLATION_IN_PROGRESS');
      expect((await saleRow(saleId)).status).toBe('CANCELLATION_PENDING');
    });
  });

  describe('recovery after a crash between the SIAT and the local commit', () => {
    it('the SIAT already cancelled it: the approval finishes the commit without cancelling again', async () => {
      const { saleId, invoiceId, productId, cuf } = await sellIssued();
      await askFromInvoice(invoiceId);
      await state.base.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLATION_PENDING' } });
      await state.base.simulatedSiatRecord.update({ where: { cuf }, data: { cancelledAt: new Date('2026-11-12T12:00:00Z') } });

      expect(await approve(saleId)).toEqual({ saleId, status: 'CANCELLED' });
      expect((await invoiceRow(invoiceId)).status).toBe('CANCELLED');
      // the SIAT kept the time of its own cancellation
      expect((await state.base.simulatedSiatRecord.findUniqueOrThrow({ where: { cuf } })).cancelledAt?.toISOString()).toBe('2026-11-12T12:00:00.000Z');
      expect(await returns(productId)).toBe(1);
      expect(await refunds(saleId)).toBe(1);
      // no new "start": the invoice was already in progress
      expect(await audits('invoicing.invoice.cancellation-start')).toHaveLength(0);
    });

    it('the crash happened before the SIAT call: the approval cancels it now', async () => {
      const { saleId, invoiceId, cuf } = await sellIssued();
      await askFromInvoice(invoiceId);
      await state.base.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLATION_PENDING' } });
      expect(await approve(saleId)).toEqual({ saleId, status: 'CANCELLED' });
      expect(await siatCancelled(cuf)).toBe(true);
      expect((await invoiceRow(invoiceId)).status).toBe('CANCELLED');
    });

    it('a resumed approval that finds the SIAT offline does not give the invoice back as valid, and finishes once it is online', async () => {
      const { saleId, invoiceId, productId, cuf } = await sellIssued();
      await askFromInvoice(invoiceId);
      await state.base.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLATION_PENDING' } });
      await state.base.simulatedSiatRecord.update({ where: { cuf }, data: { cancelledAt: new Date() } });
      await setSetting('invoicing.simulatorMode', 'OFFLINE');

      expect(await codeOf(approve(saleId))).toBe('SIAT_UNAVAILABLE');
      // the SIAT's real state is unknown from here: the marker stays, so nothing can withdraw a request the SIAT already acted on
      expect((await invoiceRow(invoiceId)).status).toBe('CANCELLATION_PENDING');
      expect(await returns(productId)).toBe(0);

      await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'invoicing.simulatorMode' } });
      expect(await approve(saleId)).toEqual({ saleId, status: 'CANCELLED' });
      expect((await invoiceRow(invoiceId)).status).toBe('CANCELLED');
      expect(await returns(productId)).toBe(1);
    });
  });

  describe('an invoice the SIAT never accepted', () => {
    it('is voided locally with no SIAT call, and a rejected one too', async () => {
      for (const status of ['PENDING', 'REJECTED'] as const) {
        const { saleId, invoiceId, productId } = await sellIssued({ known: false });
        await state.base.invoice.update({ where: { id: invoiceId }, data: { status, cuf: null, number: null } });
        await svc(state.cashier).cancellations.request(saleId, { reason: 'OTHER', comment: COMMENT });
        // the SIAT is offline: a local void must not care
        await setSetting('invoicing.simulatorMode', 'OFFLINE');
        expect(await approve(saleId)).toEqual({ saleId, status: 'CANCELLED' });
        expect((await invoiceRow(invoiceId)).status).toBe('CANCELLED');
        expect(await returns(productId)).toBe(1);
        await state.base.companySetting.deleteMany({ where: { companyId: state.companyId, key: 'invoicing.simulatorMode' } });
      }
    });
  });
});
