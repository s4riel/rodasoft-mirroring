/**
 * Integration test of closing VAT periods (HU-FAC-21) against the real Postgres: the list, what blocks a close and how it is shown,
 * the order of periods, file and reopen, what a closed period no longer lets through (NIT verification, cancellation request and
 * approval, the book export) and the two races: a close against a cancellation approval of the same period, and two closes.
 */
import { randomUUID } from 'node:crypto';
import { currentVatBookPeriod, previousVatPeriod } from '@rodasoft/domain';
import { codeOf, createPosFixture, detailsOf, type Caller } from '../sales/pos/pos.int-fixture';

const fx = createPosFixture('vatperiods');
const { state } = fx;

describe('Closing VAT periods (integration, real Postgres)', () => {
  let accountant: Caller;
  let viewer: Caller;
  let approver: Caller;
  let requester: Caller;
  let otherAccountant: Caller;
  const current = currentVatBookPeriod(new Date());
  const last = previousVatPeriod(current);
  const beforeLast = previousVatPeriod(last);

  beforeAll(async () => {
    await fx.setup();
    accountant = await fx.newMember('periodaccountant', state.companyId);
    fx.grant(accountant, 'sales.history.view-all', 'invoicing.invoices.view', 'invoicing.vat-books.view', 'invoicing.vat-books.close');
    viewer = await fx.newMember('periodviewer', state.companyId);
    fx.grant(viewer, 'invoicing.vat-books.view');
    approver = await fx.newMember('periodapprover', state.companyId);
    fx.grant(approver, 'sales.history.view-all', 'sales.cancellations.approve');
    requester = await fx.newMember('periodrequester', state.companyId);
    fx.grant(requester, 'sales.history.view-all', 'invoicing.invoices.view', 'sales.cancellations.request');
    otherAccountant = await fx.newMember('periodother', state.otherCompanyId);
    fx.grant(otherAccountant, 'invoicing.vat-books.view', 'invoicing.vat-books.close');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    const where = { companyId: state.companyId };
    await state.base.vatPeriod.deleteMany({ where: { companyId: { in: [state.companyId, state.otherCompanyId] } } });
    await state.base.purchaseBookEntry.deleteMany({ where });
    await state.base.creditNote.deleteMany({ where });
    await state.base.approvalRequest.deleteMany({ where });
    await state.base.invoiceDocument.deleteMany({ where });
    await state.base.invoice.deleteMany({ where });
    await state.base.simulatedSiatRecord.deleteMany({ where });
    await state.base.sale.deleteMany({ where });
    await state.base.cashMovement.deleteMany({ where });
    await state.base.posCheckoutItem.deleteMany({ where });
    await state.base.posCheckout.deleteMany({ where });
    await state.base.outboxEvent.deleteMany({ where });
    await state.base.auditLog.deleteMany({ where });
  });

  const svc = (caller: Caller = accountant) => fx.as(caller);
  let counter = 0;
  /** A day in the middle of a period, in UTC noon (La Paz is UTC-4: the same day). */
  const midMonth = (period: string) => new Date(`${period}-15T16:00:00Z`);

  /** A cash sale whose invoice the SIAT accepted in `period` (and whose SIN record exists). */
  async function issuedIn(period: string, total = '100.00') {
    const product = await fx.newProduct({ price: total, stock: { [state.centralId]: 50 } });
    await svc(state.cashier).checkout.addItem({ productId: product.id, quantity: 1 });
    const paid = await svc(state.cashier).payment.pay();
    const done = await svc(state.cashier).payment.complete({ payments: [{ method: 'CASH', received: paid.total }], expectedTotal: paid.total, idempotencyKey: randomUUID() });
    counter += 1;
    const cuf = `PERCUF${counter}${randomUUID().slice(0, 8).toUpperCase()}`;
    const invoice = await state.base.invoice.update({
      where: { saleId: done.sale.saleId },
      data: { status: 'VALID', number: counter, cuf, issuedAt: midMonth(period), createdAt: midMonth(period), siatReceptionCode: 'SIM-1' },
    });
    await state.base.simulatedSiatRecord.create({ data: { cuf, companyId: state.companyId, receptionCode: 'SIM-1' } });
    return { saleId: done.sale.saleId, invoiceId: invoice.id, cuf };
  }

  /** An invoice the SIAT has not issued, created in `period`. */
  async function pendingIn(period: string) {
    const issued = await issuedIn(period);
    return state.base.invoice.update({ where: { id: issued.invoiceId }, data: { status: 'PENDING', number: null, cuf: null, issuedAt: null } });
  }

  const purchase = (period: string, over: { status?: 'VALID' | 'OBSERVED'; total?: string; vatCredit?: string } = {}) =>
    state.base.purchaseBookEntry.create({
      data: {
        companyId: state.companyId,
        period,
        date: new Date(`${period}-10T00:00:00Z`),
        supplierNit: '1020304050',
        supplierName: 'Proveedor SA',
        authorizationCode: 'A1',
        invoiceNumber: String((counter += 1)),
        total: over.total ?? '500.00',
        vatCredit: over.vatCredit ?? '65.00',
        status: over.status ?? 'VALID',
        source: 'SEED',
      },
    });
  const periodRow = (period: string) => state.base.vatPeriod.findFirst({ where: { companyId: state.companyId, period } });
  const audits = (action: string) => state.base.auditLog.count({ where: { companyId: state.companyId, action } });

  describe('the list', () => {
    it('is one row per month from the first document to today, newest first, with the live totals of an open period', async () => {
      await issuedIn(beforeLast, '1000.00');
      await issuedIn(last, '200.00');
      await purchase(last, { total: '500.00', vatCredit: '65.00' });
      await purchase(last, { status: 'OBSERVED', total: '999.00', vatCredit: '129.87' });
      const response = await svc().vatPeriods.list();
      expect(response.items.map((i) => i.period)).toEqual([current, last, beforeLast]);
      expect(response.items.find((i) => i.period === beforeLast)).toMatchObject({ status: 'OPEN', salesTotal: '1000.00', fiscalDebit: '130.00', purchasesTotal: '0.00', vatCredit: '0.00', closedAt: null });
      // an observed purchase adds nothing
      expect(response.items.find((i) => i.period === last)).toMatchObject({ salesTotal: '200.00', fiscalDebit: '26.00', purchasesTotal: '500.00', vatCredit: '65.00' });
      expect(response.items[0].actions).toEqual(['VIEW_BOOKS', 'CLOSE']);
      expect(response.kpis).toEqual({ current, lastClosed: null, filed: 0, total: 3 });
    });

    it('matches the totals of the books it summarises', async () => {
      await issuedIn(last, '1000.00');
      await issuedIn(last, '300.00');
      const book = await svc().vatBooks.sales({ period: last });
      const row = (await svc().vatPeriods.list()).items.find((i) => i.period === last);
      expect(row).toMatchObject({ salesTotal: book.totals.netAmount, fiscalDebit: book.totals.fiscalDebit });
    });

    it('shows only the current month for a company without documents, and offers only what the permissions allow', async () => {
      const response = await svc(viewer).vatPeriods.list();
      expect(response.items.map((i) => i.period)).toEqual([current]);
      expect(response.items[0].actions).toEqual(['VIEW_BOOKS']);
    });

    it('never shows the periods of another company', async () => {
      await issuedIn(last);
      fx.useCompany(state.otherCompanyId);
      expect((await svc(otherAccountant).vatPeriods.list()).items.map((i) => i.period)).toEqual([current]);
      expect((await svc(otherAccountant).vatPeriods.blockers(last)).blockers).toEqual([]);
      expect(await periodRow(last)).toBeNull();
    });
  });

  describe('closing', () => {
    it('refuses a period whose month has not ended, and an invalid period', async () => {
      expect(await codeOf(svc().vatPeriods.close(current))).toBe('PERIOD_NOT_ENDED');
      expect(await detailsOf(svc().vatPeriods.close('2026-13'))).toEqual([{ field: 'period', error: 'PERIOD_INVALID' }]);
      expect(await periodRow(current)).toBeNull();
    });

    it('is blocked by documents the SIAT has not issued and by observed purchases, and says which', async () => {
      const pending = await pendingIn(last);
      const observed = await purchase(last, { status: 'OBSERVED' });
      const blockers = await svc().vatPeriods.blockers(last);
      expect(blockers.error).toBeNull();
      expect(blockers.blockers).toEqual([
        { code: 'INVOICES_NOT_ISSUED', count: 1 },
        { code: 'PURCHASES_OBSERVED', count: 1 },
      ]);
      expect(blockers.documents.map((d) => d.id)).toEqual([pending.id]);
      expect(blockers.purchases.map((p) => p.id)).toEqual([observed.id]);

      expect(await codeOf(svc().vatPeriods.close(last))).toBe('PERIOD_HAS_PENDING');
      const details = (await detailsOf(svc().vatPeriods.close(last))) as unknown as { blockers: unknown[]; documents: { id: string }[]; purchases: { id: string }[] };
      expect(details.blockers).toHaveLength(2);
      expect(details.documents[0].id).toBe(pending.id);
      expect(await periodRow(last)).toBeNull();
    });

    it('is blocked by a cancellation that is still under way in the SIAT', async () => {
      const { invoiceId } = await issuedIn(last);
      await state.base.invoice.update({ where: { id: invoiceId }, data: { status: 'CANCELLATION_PENDING' } });
      expect((await svc().vatPeriods.blockers(last)).blockers).toEqual([{ code: 'CANCELLATIONS_IN_PROGRESS', count: 1 }]);
      expect(await codeOf(svc().vatPeriods.close(last))).toBe('PERIOD_HAS_PENDING');
    });

    it('counts the cancellation requests waiting for a decision as a warning, not as a blocker', async () => {
      const { saleId } = await issuedIn(last);
      await state.base.sale.update({ where: { id: saleId }, data: { status: 'CANCELLATION_PENDING' } });
      const blockers = await svc().vatPeriods.blockers(last);
      expect(blockers.cancellationRequests).toBe(1);
      expect(blockers.blockers).toEqual([]);
      expect((await svc().vatPeriods.close(last)).status).toBe('CLOSED');
    });

    it('closes once everything is issued and verified, with a snapshot of the totals and an audit row', async () => {
      await issuedIn(last, '1000.00');
      await purchase(last, { total: '500.00', vatCredit: '65.00' });
      const closed = await svc().vatPeriods.close(last);
      expect(closed).toMatchObject({ period: last, status: 'CLOSED', salesTotal: '1000.00', fiscalDebit: '130.00', purchasesTotal: '500.00', vatCredit: '65.00' });
      expect(closed.closedAt).not.toBeNull();
      expect(closed.actions).toEqual(['VIEW_BOOKS', 'FILE', 'REOPEN']);
      expect(await periodRow(last)).toMatchObject({ status: 'CLOSED', closedById: accountant.userId });
      expect(Number((await periodRow(last))?.salesTotal)).toBe(1000);
      expect(await audits('invoicing.period.close')).toBe(1);

      // the snapshot is what the list shows even when the books change afterwards
      await state.base.purchaseBookEntry.updateMany({ where: { companyId: state.companyId, period: last }, data: { total: '1.00', vatCredit: '0.13' } });
      expect((await svc().vatPeriods.list()).items.find((i) => i.period === last)).toMatchObject({ status: 'CLOSED', purchasesTotal: '500.00', vatCredit: '65.00' });
      expect((await svc().vatPeriods.list()).kpis).toMatchObject({ lastClosed: last });
    });

    it('closes periods in order: the earlier one first', async () => {
      await issuedIn(beforeLast);
      await issuedIn(last);
      expect(await codeOf(svc().vatPeriods.close(last))).toBe('PREVIOUS_PERIOD_OPEN');
      expect((await svc().vatPeriods.blockers(last)).error).toBe('PREVIOUS_PERIOD_OPEN');
      await svc().vatPeriods.close(beforeLast);
      await svc().vatPeriods.close(last);
      expect(await codeOf(svc().vatPeriods.close(last))).toBe('PERIOD_ALREADY_CLOSED');
    });
  });

  describe('file and reopen', () => {
    it('files only a closed period, and a filed period is final', async () => {
      await issuedIn(last);
      expect(await codeOf(svc().vatPeriods.file(last))).toBe('PERIOD_NOT_CLOSED');
      await svc().vatPeriods.close(last);
      const filed = await svc().vatPeriods.file(last);
      expect(filed).toMatchObject({ status: 'FILED', actions: ['VIEW_BOOKS'] });
      expect(filed.filedAt).not.toBeNull();
      expect(await codeOf(svc().vatPeriods.file(last))).toBe('PERIOD_FILED');
      expect(await codeOf(svc().vatPeriods.reopen(last, 'Hay que corregir una compra'))).toBe('PERIOD_FILED');
      expect(await audits('invoicing.period.file')).toBe(1);
      expect((await svc().vatPeriods.list()).kpis).toMatchObject({ filed: 1 });
    });

    it('reopens a closed period only with a reason, and audits it', async () => {
      await issuedIn(last);
      await svc().vatPeriods.close(last);
      expect(await detailsOf(svc().vatPeriods.reopen(last, '  '))).toEqual([{ field: 'reason', error: 'REASON_REQUIRED' }]);
      expect(await detailsOf(svc().vatPeriods.reopen(last, 'corto'))).toEqual([{ field: 'reason', error: 'REASON_TOO_SHORT' }]);
      const reopened = await svc().vatPeriods.reopen(last, 'Falta registrar una factura de compra');
      expect(reopened).toMatchObject({ status: 'OPEN', closedAt: null });
      expect(await periodRow(last)).toMatchObject({ status: 'OPEN', closedAt: null, salesTotal: null, reopenReason: 'Falta registrar una factura de compra', reopenedById: accountant.userId });
      expect(await audits('invoicing.period.reopen')).toBe(1);
      // an open period cannot be reopened, and it can be closed again
      expect(await codeOf(svc().vatPeriods.reopen(last, 'Falta registrar una factura de compra'))).toBe('PERIOD_NOT_CLOSED');
      expect((await svc().vatPeriods.close(last)).status).toBe('CLOSED');
    });

    it('refuses to reopen a period while a later one is closed', async () => {
      await issuedIn(beforeLast);
      await issuedIn(last);
      await svc().vatPeriods.close(beforeLast);
      await svc().vatPeriods.close(last);
      expect(await codeOf(svc().vatPeriods.reopen(beforeLast, 'Necesito corregir un dato'))).toBe('LATER_PERIOD_CLOSED');
      await svc().vatPeriods.reopen(last, 'Necesito corregir un dato');
      expect((await svc().vatPeriods.reopen(beforeLast, 'Necesito corregir un dato')).status).toBe('OPEN');
    });
  });

  describe('what a closed period no longer allows', () => {
    it('refuses to verify the NIT of a purchase of the period, and nothing changes', async () => {
      const entry = await purchase(last, { status: 'VALID' });
      await svc().vatPeriods.close(last);
      expect(await codeOf(svc().vatBooks.verifyPurchaseNit(entry.id))).toBe('PERIOD_CLOSED');
      expect((await state.base.purchaseBookEntry.findUniqueOrThrow({ where: { id: entry.id } })).nitVerifiedAt).toBeNull();
      expect(await state.base.auditLog.count({ where: { companyId: state.companyId, action: 'invoicing.purchase.verify-nit' } })).toBe(0);
      // reopening lets it through again
      await svc().vatPeriods.reopen(last, 'Hay que verificar una compra');
      expect((await svc().vatBooks.verifyPurchaseNit(entry.id)).valid).toBe(true);
    });

    it('refuses to ask for or approve the cancellation of an invoice issued in it, and moves nothing', async () => {
      const asked = await issuedIn(last);
      const toApprove = await issuedIn(last);
      // one request is made while the period is open, the other after the close
      await svc(requester).invoiceCancellations.request(toApprove.invoiceId, { reasonCode: 3, comment: 'Datos de otra empresa' });
      await svc().vatPeriods.close(last);

      expect(await codeOf(svc(requester).invoiceCancellations.request(asked.invoiceId, { reasonCode: 3, comment: 'Datos de otra empresa' }))).toBe('PERIOD_CLOSED');
      expect((await state.base.sale.findUniqueOrThrow({ where: { id: asked.saleId } })).status).toBe('COMPLETED');

      expect(await codeOf(svc(approver).cancellations.approve(toApprove.saleId, { comment: 'Aprobado' }))).toBe('PERIOD_CLOSED');
      expect((await state.base.invoice.findUniqueOrThrow({ where: { id: toApprove.invoiceId } })).status).toBe('VALID');
      expect((await state.base.sale.findUniqueOrThrow({ where: { id: toApprove.saleId } })).status).toBe('CANCELLATION_PENDING');
      expect((await state.base.simulatedSiatRecord.findUniqueOrThrow({ where: { cuf: toApprove.cuf } })).cancelledAt).toBeNull();
      expect(await state.base.cashMovement.count({ where: { refId: toApprove.saleId, type: 'REFUND' } })).toBe(0);

      // after reopening, the approval goes through
      await svc().vatPeriods.reopen(last, 'Hay que anular una factura');
      await svc(approver).cancellations.approve(toApprove.saleId, { comment: 'Aprobado' });
      expect((await state.base.invoice.findUniqueOrThrow({ where: { id: toApprove.invoiceId } })).status).toBe('CANCELLED');
    });

    it('does not touch an invoice of another, open period', async () => {
      const inLast = await issuedIn(last);
      const inCurrent = await issuedIn(current);
      await svc(requester).invoiceCancellations.request(inCurrent.invoiceId, { reasonCode: 3, comment: 'Datos de otra empresa' });
      await svc().vatPeriods.close(last);
      await svc(approver).cancellations.approve(inCurrent.saleId, { comment: 'Aprobado' });
      expect((await state.base.invoice.findUniqueOrThrow({ where: { id: inCurrent.invoiceId } })).status).toBe('CANCELLED');
      expect(inLast.invoiceId).toBeDefined();
    });

    it('exports a closed period as final and an open one as a draft', async () => {
      await issuedIn(last);
      await issuedIn(beforeLast);
      const draft = await svc().vatBookExport.export({ book: 'SALES', period: last, format: 'CSV' });
      expect(draft).toMatchObject({ draft: true, filename: `libro-ventas-${last}-BORRADOR.csv` });
      await svc().vatPeriods.close(beforeLast);
      await svc().vatPeriods.close(last);
      const final = await svc().vatBookExport.export({ book: 'SALES', period: last, format: 'CSV' });
      expect(final).toMatchObject({ draft: false, filename: `libro-ventas-${last}.csv` });
      expect(final.content.toString('utf8')).not.toContain('BORRADOR');
      expect((await svc().vatBooks.sales({ period: last })).draft).toBe(false);
      await svc().vatPeriods.reopen(last, 'Hay que corregir el libro');
      expect((await svc().vatBooks.sales({ period: last })).draft).toBe(true);
    });
  });

  describe('races', () => {
    it('a close and the approval of a cancellation of the same period: exactly one wins', async () => {
      for (let round = 0; round < 3; round++) {
        const { invoiceId, saleId } = await issuedIn(last);
        await svc(requester).invoiceCancellations.request(invoiceId, { reasonCode: 3, comment: 'Datos de otra empresa' });
        const [closing, approving] = await Promise.allSettled([svc().vatPeriods.close(last), svc(approver).cancellations.approve(saleId, { comment: 'Aprobado' })]);
        const invoice = await state.base.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
        const row = await periodRow(last);
        const codeOfFailure = (result: PromiseSettledResult<unknown>) => (result.status === 'rejected' ? (result.reason as { getResponse(): { code: string } }).getResponse().code : null);
        if (closing.status === 'fulfilled' && approving.status === 'rejected') {
          // the period closed first: the approval was refused and nothing moved
          expect(codeOfFailure(approving)).toBe('PERIOD_CLOSED');
          expect(invoice.status).toBe('VALID');
          expect(row?.status).toBe('CLOSED');
        } else if (closing.status === 'rejected' && approving.status === 'fulfilled') {
          // the approval started first: the close was blocked by the cancellation under way
          expect(codeOfFailure(closing)).toBe('PERIOD_HAS_PENDING');
          expect(invoice.status).toBe('CANCELLED');
          expect(row?.status ?? 'OPEN').toBe('OPEN');
        } else {
          // the approval finished before the close took its lock: the cancellation is older than the close
          expect(closing.status).toBe('fulfilled');
          expect(approving.status).toBe('fulfilled');
          expect(invoice.status).toBe('CANCELLED');
          expect((invoice.cancelledAt as Date).getTime()).toBeLessThanOrEqual((row?.closedAt as Date).getTime());
        }
        // clean for the next round
        await state.base.vatPeriod.deleteMany({ where: { companyId: state.companyId } });
        await state.base.approvalRequest.deleteMany({ where: { companyId: state.companyId } });
        await state.base.invoice.deleteMany({ where: { companyId: state.companyId } });
        await state.base.simulatedSiatRecord.deleteMany({ where: { companyId: state.companyId } });
        await state.base.sale.deleteMany({ where: { companyId: state.companyId } });
        await state.base.cashMovement.deleteMany({ where: { companyId: state.companyId } });
      }
    }, 60_000);

    it('two closes of the same period at once: one closes it, the other gets PERIOD_ALREADY_CLOSED', async () => {
      await issuedIn(last);
      const results = await Promise.allSettled([svc().vatPeriods.close(last), svc().vatPeriods.close(last)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect((failed.reason as { getResponse(): { code: string } }).getResponse().code).toBe('PERIOD_ALREADY_CLOSED');
      expect(await audits('invoicing.period.close')).toBe(1);
    });

    it('closing a period while the one before it is reopened never leaves a closed period after an open one', async () => {
      await issuedIn(beforeLast);
      await issuedIn(last);
      await svc().vatPeriods.close(beforeLast);
      const results = await Promise.allSettled([svc().vatPeriods.reopen(beforeLast, 'Hay que corregir un dato'), svc().vatPeriods.close(last)]);
      const first = await periodRow(beforeLast);
      const second = await periodRow(last);
      // either the reopen came first (then closing is refused: the earlier period is open) or the close did (then the reopen is refused)
      expect(!(first?.status === 'OPEN' && second?.status === 'CLOSED')).toBe(true);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    });
  });
});
