/**
 * Integration test of the SIAT system status (HU-FAC-13) and the VAT books (HU-FAC-18, 19, 20) against the real Postgres:
 * codes by branch, renewing a CUFD and testing the connection online and offline, the sales book totals against the documents
 * (valid, cancelled, credited), the purchases book (observed entries add nothing until verified) and the export with its draft flag.
 */
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { currentVatBookPeriod, laPazToday } from '@rodasoft/domain';
import { codeOf, createPosFixture, type Caller } from '../sales/pos/pos.int-fixture';

const fx = createPosFixture('siatbooks');
const { state } = fx;

describe('SIAT status and VAT books (integration, real Postgres)', () => {
  let manager: Caller;
  let otherManager: Caller;
  const period = currentVatBookPeriod(new Date());
  const pastPeriod = '2025-03';

  beforeAll(async () => {
    await fx.setup();
    manager = await fx.newMember('bookmanager', state.companyId);
    fx.grant(manager, 'sales.history.view-all', 'invoicing.invoices.view', 'invoicing.settings.manage', 'invoicing.vat-books.view');
    otherManager = await fx.newMember('bookother', state.otherCompanyId);
    fx.grant(otherManager, 'invoicing.invoices.view', 'invoicing.settings.manage', 'invoicing.vat-books.view');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    const where = { companyId: state.companyId };
    await state.base.companySetting.deleteMany({ where: { ...where, key: { startsWith: 'invoicing.' } } });
    await state.base.purchaseBookEntry.deleteMany({ where });
    await state.base.vatPeriod.deleteMany({ where });
    await state.base.creditNote.deleteMany({ where });
    await state.base.invoiceDocument.deleteMany({ where });
    await state.base.invoice.deleteMany({ where });
    await state.base.sale.deleteMany({ where });
    await state.base.cashMovement.deleteMany({ where });
    await state.base.posCheckoutItem.deleteMany({ where });
    await state.base.posCheckout.deleteMany({ where });
    await state.base.siatSettings.deleteMany({ where: { companyId: state.companyId } });
    await state.base.siatPointOfSale.updateMany({ where, data: { cuis: null, cuisExpiresAt: null, cufd: null, cufdControlCode: null, cufdExpiresAt: null, lastSyncedAt: null } });
    await state.base.auditLog.deleteMany({ where });
  });

  const svc = (caller: Caller = manager) => fx.as(caller);
  const setSetting = (key: string, value: unknown) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key } },
      create: { companyId: state.companyId, key, value: value as never },
      update: { value: value as never },
    });
  const point = () => state.base.siatPointOfSale.findFirstOrThrow({ where: { companyId: state.companyId }, orderBy: { code: 'asc' } });

  describe('system status (HU-FAC-13)', () => {
    it('lists the points of sale by branch with the health of their codes and what is not issued', async () => {
      const p = await point();
      const hour = 3_600_000;
      // the summary is the worst of the company's points: give every point codes, and the first one a CUFD about to expire
      await state.base.siatPointOfSale.updateMany({
        where: { companyId: state.companyId },
        data: { cuis: 'X', cuisExpiresAt: new Date(Date.now() + 200 * 24 * hour), cufd: 'Y', cufdExpiresAt: new Date(Date.now() + 100 * hour), lastSyncedAt: new Date() },
      });
      await state.base.siatPointOfSale.update({ where: { id: p.id }, data: { cufdExpiresAt: new Date(Date.now() + 2 * hour) } });
      const status = await svc().siatSystemStatus.status();
      expect(status).toMatchObject({ connection: 'UNKNOWN', checkedAt: null, cuis: 'OK', cufd: 'EXPIRING', warnHours: 6, notIssued: 0 });
      const mine = status.branches.flatMap((b) => b.pointsOfSale).find((x) => x.id === p.id);
      expect(mine).toMatchObject({ cuis: { present: true, health: 'OK' }, cufd: { present: true, health: 'EXPIRING' }, issuedToday: 0 });
      // the codes themselves never leave the API
      expect(JSON.stringify(status)).not.toContain('"cufd":"Y"');
      expect(status.lastSyncedAt).not.toBeNull();
    });

    it('a point of sale without codes is expired, and the warning window is a company setting', async () => {
      expect((await svc().siatSystemStatus.status()).cufd).toBe('EXPIRED');
      await state.base.siatPointOfSale.updateMany({ where: { companyId: state.companyId }, data: { cuis: 'X', cuisExpiresAt: new Date(Date.now() + 1000 * 3_600_000), cufd: 'Y', cufdExpiresAt: new Date(Date.now() + 10 * 3_600_000) } });
      expect((await svc().siatSystemStatus.status()).cufd).toBe('OK');
      await setSetting('invoicing.cufdWarnHours', 12);
      expect((await svc().siatSystemStatus.status()).cufd).toBe('EXPIRING');
    });

    it('renews the CUFD online (new code, expiry and CUIS), and keeps the old one when the SIAT is offline', async () => {
      const p = await point();
      const renewed = await svc().siatSystemStatus.renewCufd(p.id);
      expect(renewed).toMatchObject({ id: p.id, cufd: { present: true, health: 'OK' }, cuis: { present: true } });
      const saved = await point();
      expect(saved.cufd).toMatch(/^SIMCUFD-/);
      expect(saved.cufdControlCode).toMatch(/^SIM/);
      expect(saved.cufdExpiresAt && saved.cufdExpiresAt.getTime()).toBeGreaterThan(Date.now() + 20 * 3_600_000);
      expect(await state.base.auditLog.count({ where: { action: 'invoicing.cufd.renew', entityId: p.id } })).toBe(1);

      await setSetting('invoicing.simulatorMode', 'OFFLINE');
      expect(await codeOf(svc().siatSystemStatus.renewCufd(p.id))).toBe('SIAT_UNAVAILABLE');
      expect((await point()).cufd).toBe(saved.cufd);
    });

    it('answers POINT_OF_SALE_NOT_FOUND for an unknown point and for one of another company', async () => {
      expect(await codeOf(svc().siatSystemStatus.renewCufd(randomUUID()))).toBe('POINT_OF_SALE_NOT_FOUND');
      const p = await point();
      fx.useCompany(state.otherCompanyId);
      expect(await codeOf(svc(otherManager).siatSystemStatus.renewCufd(p.id))).toBe('POINT_OF_SALE_NOT_FOUND');
    });

    it('tests the connection and records it, offline included', async () => {
      const online = await svc().siatSystemStatus.testConnection();
      expect(online.connection).toBe('ONLINE');
      expect((await svc().siatSystemStatus.status()).connection).toBe('ONLINE');
      await setSetting('invoicing.simulatorMode', 'OFFLINE');
      expect(await codeOf(svc().siatSystemStatus.testConnection())).toBe('SIAT_UNAVAILABLE');
      const status = await svc().siatSystemStatus.status();
      expect(status.connection).toBe('OFFLINE');
      expect(status.checkedAt).not.toBeNull();
      expect(await state.base.auditLog.count({ where: { companyId: state.companyId, action: 'invoicing.connection.test' } })).toBe(2);
    });
  });

  describe('sales book (HU-FAC-18)', () => {
    /** An invoice the SIAT validated now, with one credit note of part of it. */
    async function document(total: string, status: 'VALID' | 'CANCELLED' = 'VALID', note?: string) {
      const product = await fx.newProduct({ price: total, stock: { [state.centralId]: 50 } });
      await svc(state.cashier).checkout.addItem({ productId: product.id, quantity: 1 });
      const paid = await svc(state.cashier).payment.pay();
      const done = await svc(state.cashier).payment.complete({ payments: [{ method: 'CASH', received: paid.total }], expectedTotal: paid.total, idempotencyKey: randomUUID() });
      const number = Math.floor(Math.random() * 1e6);
      const invoice = await state.base.invoice.update({ where: { saleId: done.sale.saleId }, data: { status, number, cuf: `CUF${number}`, issuedAt: new Date() } });
      if (note) {
        const item = await state.base.saleItem.findFirstOrThrow({ where: { saleId: done.sale.saleId } });
        await state.base.creditNote.create({
          data: {
            companyId: state.companyId, invoiceId: invoice.id, branchId: invoice.branchId, pointOfSaleId: invoice.pointOfSaleId, status: 'VALID', number: 1, cuf: `NCUF${number}`, issuedAt: new Date(),
            total: note, vatAdjusted: (Number(note) * 0.13).toFixed(2), reasonCode: 1, customerTaxName: 'C', customerDocumentType: 1, customerDocumentNumber: '1',
            items: { create: [{ companyId: state.companyId, saleItemId: item.id, description: 'x', quantity: 1, unitPrice: total, amount: note }] },
          },
        });
      }
      return invoice;
    }

    it('adds valid invoices, lists cancelled ones with 0 and lets credit notes reduce the debit', async () => {
      await document('1000.00', 'VALID', '200.00');
      await document('300.00');
      const cancelled = await document('450.00', 'CANCELLED');
      // a pending invoice is not in the book
      const pending = await document('50.00');
      await state.base.invoice.update({ where: { id: pending.id }, data: { status: 'PENDING', issuedAt: null, cuf: null, number: null } });

      const book = await svc().vatBooks.sales({ period });
      expect(book).toMatchObject({ period, draft: true, format: 'SIN_LCV', exportFormats: ['XLSX', 'CSV'] });
      expect(book.rows).toHaveLength(4);
      expect(book.rows.find((r) => r.id === cancelled.id)).toMatchObject({ status: 'CANCELLED', total: '0.00', fiscalDebit: '0.00' });
      // 13 % of 1000.00 + 300.00 = 169.00, less the 26.00 the note takes back
      expect(book.totals).toEqual({ invoices: 2, cancelled: 1, creditNotes: 1, invoicedAmount: '1300.00', creditedAmount: '200.00', netAmount: '1100.00', fiscalDebit: '143.00' });
    });

    it('takes a document into the La Paz month of its issue and filters by branch', async () => {
      await document('100.00');
      expect((await svc().vatBooks.sales({ period: pastPeriod })).rows).toHaveLength(0);
      expect((await svc().vatBooks.sales({ period, branchId: randomUUID() })).rows).toHaveLength(0);
      expect((await svc().vatBooks.sales({ period, branchId: state.branchId })).rows).toHaveLength(1);
      // the first instant of next month is not this month's
      const next = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5)), 1, 4, 0, 0));
      await state.base.invoice.updateMany({ where: { companyId: state.companyId }, data: { issuedAt: next } });
      expect((await svc().vatBooks.sales({ period })).rows).toHaveLength(0);
    });

    it('rejects a malformed period, and shows nothing of another company', async () => {
      await document('100.00');
      expect(await codeOf(svc().vatBooks.sales({ period: '2026-13' }))).toBe('VALIDATION_FAILED');
      fx.useCompany(state.otherCompanyId);
      expect((await svc(otherManager).vatBooks.sales({ period })).rows).toHaveLength(0);
    });
  });

  describe('purchases book (HU-FAC-19)', () => {
    const entry = (over: Record<string, unknown> = {}) =>
      state.base.purchaseBookEntry.create({
        data: {
          companyId: state.companyId, period, date: new Date(`${laPazToday(new Date())}T00:00:00Z`), supplierNit: '1020304050', supplierName: 'Proveedor', authorizationCode: 'A1',
          invoiceNumber: String(Math.floor(Math.random() * 1e6)), total: '1000.00', vatCredit: '130.00', status: 'VALID', source: 'SEED', ...over,
        },
      });

    it('lists the period, and an observed purchase does not add to the totals', async () => {
      await entry();
      await entry({ supplierNit: '9991234', status: 'OBSERVED', observation: 'NIT INVALIDO', total: '1200.00', vatCredit: '156.00' });
      await entry({ period: pastPeriod });
      const book = await svc().vatBooks.purchases({ period });
      expect(book.rows).toHaveLength(2);
      expect(book.totals).toEqual({ entries: 2, observed: 1, totalAmount: '1000.00', vatCredit: '130.00', observedAmount: '1200.00', observedVatCredit: '156.00' });
    });

    it('verifying the NIT validates the entry so it adds; an unknown NIT stays observed; a corrected NIT is stored', async () => {
      const bad = await entry({ supplierNit: '9991234', status: 'OBSERVED', total: '1200.00', vatCredit: '156.00' });
      const still = await svc().vatBooks.verifyPurchaseNit(bad.id);
      expect(still).toMatchObject({ valid: false, entry: { status: 'OBSERVED' } });
      expect((await svc().vatBooks.purchases({ period })).totals.vatCredit).toBe('0.00');

      const fixed = await svc().vatBooks.verifyPurchaseNit(bad.id, { supplierNit: '1020304132' });
      expect(fixed).toMatchObject({ valid: true, entry: { status: 'VALID', supplierNit: '1020304132', observation: null } });
      expect(fixed.entry.nitVerifiedAt).not.toBeNull();
      expect((await svc().vatBooks.purchases({ period })).totals).toMatchObject({ observed: 0, vatCredit: '156.00' });
      expect(await state.base.auditLog.count({ where: { action: 'invoicing.purchase.verify-nit', entityId: bad.id } })).toBe(2);
    });

    it('a valid entry is never demoted by a later negative answer', async () => {
      const valid = await entry({ supplierNit: '9991234', status: 'VALID' });
      const result = await svc().vatBooks.verifyPurchaseNit(valid.id);
      expect(result).toMatchObject({ valid: false, entry: { status: 'VALID' } });
      expect((await svc().vatBooks.purchases({ period })).totals.vatCredit).toBe('130.00');
    });

    it('offline: 503 and nothing changes; a malformed NIT or unknown entry is refused', async () => {
      const bad = await entry({ status: 'OBSERVED' });
      await setSetting('invoicing.simulatorMode', 'OFFLINE');
      expect(await codeOf(svc().vatBooks.verifyPurchaseNit(bad.id))).toBe('SIAT_UNAVAILABLE');
      expect((await state.base.purchaseBookEntry.findUniqueOrThrow({ where: { id: bad.id } })).status).toBe('OBSERVED');
      expect(await codeOf(svc().vatBooks.verifyPurchaseNit(bad.id, { supplierNit: 'abc' }))).toBe('VALIDATION_FAILED');
      expect(await codeOf(svc().vatBooks.verifyPurchaseNit(randomUUID()))).toBe('PURCHASE_ENTRY_NOT_FOUND');
    });

    it('never shows or verifies an entry of another company', async () => {
      const mine = await entry();
      fx.useCompany(state.otherCompanyId);
      expect((await svc(otherManager).vatBooks.purchases({ period })).rows).toHaveLength(0);
      expect(await codeOf(svc(otherManager).vatBooks.verifyPurchaseNit(mine.id))).toBe('PURCHASE_ENTRY_NOT_FOUND');
    });
  });

  describe('export (HU-FAC-20)', () => {
    it('an open period is a draft in the title and the file name; a closed one is not', async () => {
      await state.base.vatPeriod.create({ data: { companyId: state.companyId, period: pastPeriod, status: 'CLOSED', closedAt: new Date(), salesTotal: '0.00', fiscalDebit: '0.00', purchasesTotal: '500.00', vatCredit: '65.00' } });
      await state.base.purchaseBookEntry.create({
        data: { companyId: state.companyId, period: pastPeriod, date: new Date('2025-03-10T00:00:00Z'), supplierNit: '1020304050', supplierName: '=HYPERLINK("x")', authorizationCode: 'A', invoiceNumber: '7', total: '500.00', vatCredit: '65.00', status: 'VALID', source: 'SEED' },
      });
      const closed = await svc().vatBookExport.export({ book: 'PURCHASES', period: pastPeriod, format: 'CSV' });
      expect(closed).toMatchObject({ filename: 'libro-compras-2025-03.csv', draft: false });
      const csv = closed.content.toString('utf8');
      expect(csv).not.toContain('BORRADOR');
      expect(csv).toContain("'=HYPERLINK");
      expect(csv).toContain('500.00');

      const open = await svc().vatBookExport.export({ book: 'SALES', period, format: 'XLSX' });
      expect(open).toMatchObject({ filename: `libro-ventas-${period}-BORRADOR.xlsx`, draft: true });
      expect(open.contentType).toContain('spreadsheetml');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(open.content as never);
      expect(String(workbook.worksheets[0].getRow(1).getCell(1).value)).toContain('BORRADOR');
      expect(await state.base.auditLog.count({ where: { companyId: state.companyId, action: 'invoicing.book.export' } })).toBe(2);
    });

    it('the sales file has one row per document and a totals row equal to the book', async () => {
      const product = await fx.newProduct({ price: '100.00', stock: { [state.centralId]: 5 } });
      await svc(state.cashier).checkout.addItem({ productId: product.id, quantity: 1 });
      const paid = await svc(state.cashier).payment.pay();
      const done = await svc(state.cashier).payment.complete({ payments: [{ method: 'CASH', received: paid.total }], expectedTotal: paid.total, idempotencyKey: randomUUID() });
      await state.base.invoice.update({ where: { saleId: done.sale.saleId }, data: { status: 'VALID', number: 5, cuf: 'CUF5', issuedAt: new Date() } });
      const csv = (await svc().vatBookExport.export({ book: 'SALES', period, format: 'CSV' })).content.toString('utf8').split('\r\n');
      expect(csv.some((line) => line.includes('000005') && line.includes('100.00') && line.includes('13.00'))).toBe(true);
      expect(csv.some((line) => line.includes('TOTAL') && line.includes('100.00') && line.includes('13.00'))).toBe(true);
    });

    it('refuses an unknown book, format or period, and a format the company does not offer', async () => {
      expect(await codeOf(svc().vatBookExport.export({ book: 'X', period, format: 'CSV' }))).toBe('VALIDATION_FAILED');
      expect(await codeOf(svc().vatBookExport.export({ book: 'SALES', period, format: 'PDF' }))).toBe('VALIDATION_FAILED');
      expect(await codeOf(svc().vatBookExport.export({ book: 'SALES', period: '2026-99', format: 'CSV' }))).toBe('VALIDATION_FAILED');
      await setSetting('invoicing.vatBookExportFormats', ['CSV']);
      expect(await codeOf(svc().vatBookExport.export({ book: 'SALES', period, format: 'XLSX' }))).toBe('VALIDATION_FAILED');
    });
  });
});
