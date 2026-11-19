/**
 * Integration test of the fiscal configuration (HU-FAC-22…27) against the real Postgres: the summary and its checklist, the
 * signature and credentials (stored encrypted, never returned or audited), points of sale, catalogue sync, homologation by hand and
 * by Excel, and the switch to production.
 */
import { randomUUID } from 'node:crypto';
import ExcelJS from 'exceljs';
import { PRODUCTION_CONFIRMATION } from '@rodasoft/domain';
import { codeOf, createPosFixture, detailsOf, type Caller } from '../sales/pos/pos.int-fixture';
import { buildTestP12 } from './test-p12';

const fx = createPosFixture('fiscal');
const { state } = fx;
const DAY = 86_400_000;

describe('Fiscal configuration (integration, real Postgres)', () => {
  let manager: Caller;
  let director: Caller;
  let otherManager: Caller;
  const where = () => ({ companyId: state.companyId });

  beforeAll(async () => {
    await fx.setup();
    manager = await fx.newMember('fiscalmanager', state.companyId);
    fx.grant(manager, 'invoicing.invoices.view', 'invoicing.settings.manage');
    director = await fx.newMember('fiscaldirector', state.companyId);
    fx.grant(director, 'invoicing.invoices.view', 'invoicing.settings.manage', 'invoicing.production.enable');
    otherManager = await fx.newMember('fiscalother', state.otherCompanyId);
    fx.grant(otherManager, 'invoicing.invoices.view', 'invoicing.settings.manage');
  }, 60_000);
  afterAll(() => fx.teardown());
  beforeEach(() => fx.useCompany(state.companyId));

  afterEach(async () => {
    fx.useCompany(state.companyId);
    delete process.env['SIAT_ALLOW_SIMULATOR'];
    await state.base.siatCatalogEntry.deleteMany({ where: { companyId: { in: [state.companyId, state.otherCompanyId] } } });
    await state.base.siatCatalogSync.deleteMany({ where: { companyId: { in: [state.companyId, state.otherCompanyId] } } });
    await state.base.siatSettings.deleteMany({ where: { companyId: { in: [state.companyId, state.otherCompanyId] } } });
    await state.base.simulatedSiatRecord.deleteMany({ where: where() });
    await state.base.companySetting.deleteMany({ where: { ...where(), key: { startsWith: 'invoicing.' } } });
    await state.base.product.updateMany({ where: where(), data: { sinProductCode: null, sinActivityCode: null, sinUnitCode: null } });
    await state.base.auditLog.deleteMany({ where: where() });
  });

  const svc = (caller: Caller = manager) => fx.as(caller);
  const setSetting = (key: string, value: unknown) =>
    state.base.companySetting.upsert({
      where: { companyId_key: { companyId: state.companyId, key } },
      create: { companyId: state.companyId, key, value: value as never },
      update: { value: value as never },
    });
  const file = (buffer: Buffer, name = 'firma.p12') => ({ buffer, size: buffer.length, originalname: name });
  const settingsRow = () => state.base.siatSettings.findUnique({ where: { companyId: state.companyId } });
  /** The audit rows of an action, as plain JSON (the row id is a BigInt). */
  const audits = async (action: string) => (await state.base.auditLog.findMany({ where: { companyId: state.companyId, action } })).map((row) => ({ action: row.action, before: row.before, after: row.after }));

  async function sheet(rows: string[][]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('H');
    ws.addRow(['SKU', 'CODIGO_SIN', 'UNIDAD']);
    rows.forEach((row) => ws.addRow(row));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  describe('summary, signature and credentials (HU-FAC-22, HU-FAC-23)', () => {
    it('starts with every section pending and never carries a secret', async () => {
      const summary = await svc().fiscalSettings.summary();
      expect(summary).toMatchObject({ environment: 'TEST', gateway: 'SIMULATED', warnDays: 30, signature: { present: false }, credentials: { tokenPresent: false } });
      expect(summary.checklist.map((row) => row.key)).toEqual(['SIGNATURE', 'CREDENTIALS', 'CONNECTION', 'POINTS_OF_SALE', 'CATALOGS', 'ACTIVITY', 'HOMOLOGATION']);
      expect(summary.checklist.find((row) => row.key === 'SIGNATURE')?.status).toBe('PENDING');
      expect(summary.production.ready).toBe(false);
    });

    it('reads the .p12 for holder and expiry, stores it encrypted and returns no secret', async () => {
      const p12 = buildTestP12('clave-123', new Date(Date.now() + 400 * DAY), 'Rodalaser SRL');
      const signature = await svc().fiscalSettings.saveSignature(file(p12), 'clave-123');
      expect(signature).toMatchObject({ present: true, holder: 'Rodalaser SRL', fileName: 'firma.p12', health: 'OK' });
      const row = await settingsRow();
      expect(row?.signatureP12Encrypted).toMatch(/^v1\./);
      expect(row?.signatureP12Encrypted).not.toContain(p12.toString('base64'));
      expect(row?.signaturePasswordEncrypted).toMatch(/^v1\./);
      const [entry] = await audits('invoicing.signature.update');
      expect(JSON.stringify(entry)).not.toContain('clave-123');
      expect(JSON.stringify(entry)).not.toContain(p12.toString('base64').slice(0, 40));
      const summary = JSON.stringify(await svc().fiscalSettings.summary());
      expect(summary).not.toContain('clave-123');
      expect(summary).not.toContain('v1.');
    });

    it('refuses a wrong password or a file that is not a .p12 (SIGNATURE_INVALID) and an expired one (SIGNATURE_EXPIRED)', async () => {
      const p12 = buildTestP12('clave-123', new Date(Date.now() + 400 * DAY));
      expect(await codeOf(svc().fiscalSettings.saveSignature(file(p12), 'otra'))).toBe('SIGNATURE_INVALID');
      expect(await codeOf(svc().fiscalSettings.saveSignature(file(Buffer.from('no es un p12')), 'x'))).toBe('SIGNATURE_INVALID');
      const expired = buildTestP12('clave-123', new Date(Date.now() - DAY));
      expect(await codeOf(svc().fiscalSettings.saveSignature(file(expired), 'clave-123'))).toBe('SIGNATURE_EXPIRED');
      expect(await settingsRow()).toBeNull();
    });

    it('warns inside invoicing.signatureWarnDays for the signature and the token', async () => {
      await svc().fiscalSettings.saveSignature(file(buildTestP12('c', new Date(Date.now() + 20 * DAY))), 'c');
      await svc().fiscalSettings.saveCredentials({ systemCode: 'SYS1', token: 'tok-secret', tokenExpiresAt: new Date(Date.now() + 10 * DAY).toISOString() });
      const summary = await svc().fiscalSettings.summary();
      expect(summary.signature.health).toBe('EXPIRING');
      expect(summary.credentials).toMatchObject({ tokenPresent: true, tokenHealth: 'EXPIRING', systemCode: 'SYS1' });
      expect(summary.checklist.find((row) => row.key === 'SIGNATURE')?.status).toBe('WARNING');
      await setSetting('invoicing.signatureWarnDays', 5);
      expect((await svc().fiscalSettings.summary()).signature.health).toBe('OK');
    });

    it('stores the token encrypted and keeps it out of the audit log', async () => {
      await svc().fiscalSettings.saveCredentials({ systemCode: 'SYS1', token: 'tok-secret', tokenExpiresAt: new Date(Date.now() + 100 * DAY).toISOString() });
      expect((await settingsRow())?.tokenEncrypted).toMatch(/^v1\./);
      expect(JSON.stringify(await audits('invoicing.credentials.update'))).not.toContain('tok-secret');
      expect(JSON.stringify(await svc().fiscalSettings.summary())).not.toContain('tok-secret');
    });

    it('tests the connection through the existing endpoint and shows it in the summary', async () => {
      await svc().siatSystemStatus.testConnection();
      expect((await svc().fiscalSettings.summary()).connection.status).toBe('ONLINE');
    });

    it('never shows another company its settings', async () => {
      await svc().fiscalSettings.saveCredentials({ systemCode: 'SYS1', token: 't', tokenExpiresAt: new Date(Date.now() + 100 * DAY).toISOString() });
      fx.useCompany(state.otherCompanyId);
      expect((await svc(otherManager).fiscalSettings.summary()).credentials.systemCode).toBeNull();
    });
  });

  describe('points of sale (HU-FAC-24)', () => {
    const input = () => ({ branchId: state.branchId, name: `Caja ${randomUUID().slice(0, 6)}`, typeCode: 5, warehouseId: state.centralId });

    it('lists branch, register, last invoice and CUIS health with its indicators', async () => {
      const created = await svc().pointsOfSale.create(input());
      const list = await svc().pointsOfSale.list();
      expect(list.items.find((item) => item.id === created.id)).toMatchObject({ branchName: 'Sucursal central', cuisHealth: 'OK', status: 'ACTIVE', lastInvoiceNumber: null });
      expect(list.kpis.total).toBe(list.items.length);
      expect(list.types.map((type) => type.code)).toEqual([1, 5]);
    });

    it('registers a new point online with its code, CUIS and cash register, and audits it without the CUIS', async () => {
      const created = await svc().pointsOfSale.create(input());
      const point = await state.base.siatPointOfSale.findUniqueOrThrow({ where: { id: created.id }, include: { cashRegister: true } });
      expect(point.cuis).toMatch(/^SIMCUIS-/);
      expect(point.typeCode).toBe(5);
      expect(point.cashRegister).toMatchObject({ warehouseId: state.centralId, status: 'ACTIVE' });
      const [entry] = await audits('invoicing.point-of-sale.create');
      expect(JSON.stringify(entry)).not.toContain('SIMCUIS');
    });

    it('offline: 503 and nothing is saved', async () => {
      await setSetting('invoicing.simulatorMode', 'OFFLINE');
      const before = await state.base.siatPointOfSale.count({ where: where() });
      const registers = await state.base.cashRegister.count({ where: where() });
      expect(await codeOf(svc().pointsOfSale.create(input()))).toBe('SIAT_UNAVAILABLE');
      expect(await state.base.siatPointOfSale.count({ where: where() })).toBe(before);
      expect(await state.base.cashRegister.count({ where: where() })).toBe(registers);
    });

    it('two concurrent creations get distinct codes', async () => {
      const results = await Promise.all([svc().pointsOfSale.create(input()), svc().pointsOfSale.create(input()), svc().pointsOfSale.create(input())]);
      const codes = results.map((item) => item.code);
      expect(new Set(codes).size).toBe(3);
    });

    it('refuses an unknown branch, a warehouse of another branch and an unknown type', async () => {
      expect(await codeOf(svc().pointsOfSale.create({ ...input(), branchId: randomUUID() }))).toBe('BRANCH_NOT_FOUND');
      expect(await codeOf(svc().pointsOfSale.create({ ...input(), warehouseId: randomUUID() }))).toBe('WAREHOUSE_NOT_FOUND');
      expect(await detailsOf(svc().pointsOfSale.create({ ...input(), typeCode: 77 }))).toEqual([{ field: 'typeCode', error: 'TYPE_INVALID' }]);
    });

    it('deactivates a point (and its register) but not one with an open shift', async () => {
      const busy = await state.base.cashShift.findFirstOrThrow({ where: { companyId: state.companyId, status: 'OPEN' }, include: { register: true } });
      expect(await codeOf(svc().pointsOfSale.deactivate(busy.register.pointOfSaleId))).toBe('POINT_OF_SALE_IN_USE');
      const created = await svc().pointsOfSale.create(input());
      const done = await svc().pointsOfSale.deactivate(created.id);
      expect(done.status).toBe('INACTIVE');
      expect((await state.base.cashRegister.findUniqueOrThrow({ where: { pointOfSaleId: created.id } })).status).toBe('INACTIVE');
      expect(await codeOf(svc().pointsOfSale.deactivate(created.id))).toBe('POINT_OF_SALE_INACTIVE');
    });
  });

  describe('catalogues and homologation (HU-FAC-25, HU-FAC-26)', () => {
    it('syncs online: rows with their date; a second sync keeps them and a vanished row becomes inactive', async () => {
      expect((await svc().catalogs.summary()).synced).toBe(false);
      const summary = await svc().catalogs.sync();
      expect(summary.synced).toBe(true);
      expect(summary.syncedAt).not.toBeNull();
      expect(summary.catalogs.find((row) => row.catalog === 'ACTIVITY')?.entries).toBe(3);
      // a row the SIN no longer sends stays, inactive
      await state.base.siatCatalogEntry.create({ data: { companyId: state.companyId, catalog: 'UNIT_OF_MEASURE', code: '999', description: 'VIEJA', active: true, syncedAt: new Date() } });
      await svc().catalogs.sync();
      expect((await state.base.siatCatalogEntry.findFirstOrThrow({ where: { companyId: state.companyId, code: '999' } })).active).toBe(false);
      expect((await svc().catalogs.entries('LEGEND', {})).items.length).toBeGreaterThan(0);
      expect(await codeOf(svc().catalogs.entries('NOPE', {}))).toBe('CATALOG_NOT_FOUND');
      expect(await audits('invoicing.catalogs.sync')).toHaveLength(2);
    });

    it('offline: 503 and the old rows stay; without a point of sale: POINT_OF_SALE_MISSING', async () => {
      await svc().catalogs.sync();
      const before = await state.base.siatCatalogEntry.count({ where: where() });
      await setSetting('invoicing.simulatorMode', 'OFFLINE');
      expect(await codeOf(svc().catalogs.sync())).toBe('SIAT_UNAVAILABLE');
      expect(await state.base.siatCatalogEntry.count({ where: where() })).toBe(before);
      await setSetting('invoicing.simulatorMode', 'ONLINE');
      await state.base.siatPointOfSale.updateMany({ where: where(), data: { status: 'INACTIVE' } });
      expect(await codeOf(svc().catalogs.sync())).toBe('POINT_OF_SALE_MISSING');
      await state.base.siatPointOfSale.updateMany({ where: where(), data: { status: 'ACTIVE' } });
    });

    it('serves the reasons from the synced catalogue, and the built-in ones before the first sync', async () => {
      expect((await svc().catalogs.reasons()).cancellation.map((r) => r.code)).toEqual([1, 2, 3, 4]);
      await svc().catalogs.sync();
      await state.base.siatCatalogEntry.updateMany({ where: { ...where(), catalog: 'CANCELLATION_REASON', code: '4' }, data: { active: false } });
      expect((await svc().catalogs.reasons()).cancellation.map((r) => r.code)).toEqual([1, 2, 3]);
    });

    it('homologation: progress equals the rows, status filter, unknown code refused', async () => {
      const a = await fx.newProduct();
      const b = await fx.newProduct();
      expect(await codeOf(svc().homologation.update(a.id, { sinProductCode: '84821' }))).toBe('CATALOGS_NOT_SYNCED');
      await svc().catalogs.sync();
      const before = await svc().homologation.list({});
      await svc().homologation.update(a.id, { sinProductCode: '84821', sinUnitCode: 58 });
      const after = await svc().homologation.list({});
      expect(after.progress.done).toBe(before.progress.done + 1);
      expect(after.progress.pending).toBe(before.progress.pending - 1);
      expect(after.progress.done + after.progress.pending).toBe(after.progress.total);
      expect((await svc().homologation.list({ status: 'DONE' })).items.map((row) => row.id)).toContain(a.id);
      expect((await svc().homologation.list({ status: 'PENDING' })).items.map((row) => row.id)).toContain(b.id);
      expect((await svc().homologation.list({ status: 'DONE' })).total).toBe(after.progress.done);
      const saved = await state.base.product.findUniqueOrThrow({ where: { id: a.id } });
      expect(saved).toMatchObject({ sinProductCode: '84821', sinActivityCode: '465900', sinUnitCode: 58 });
      expect(await codeOf(svc().homologation.update(a.id, { sinProductCode: '00000' }))).toBe('SIN_CODE_UNKNOWN');
      expect(await codeOf(svc().homologation.update(a.id, { sinProductCode: '84821', sinUnitCode: 999 }))).toBe('SIN_CODE_UNKNOWN');
      expect(await codeOf(svc().homologation.update(randomUUID(), { sinProductCode: '84821' }))).toBe('PRODUCT_NOT_FOUND');
      expect(await audits('invoicing.product.homologate')).toHaveLength(1);
    });

    it('import: the preview reports row errors and saves nothing; apply is all or nothing and audited', async () => {
      const a = await fx.newProduct();
      const b = await fx.newProduct();
      await svc().catalogs.sync();
      const bad = file(await sheet([[a.sku, '84821', '58'], ['NO-EXISTE', '84821', ''], [b.sku, '00000', '']]), 'h.xlsx');
      const preview = await svc().homologation.preview(bad);
      expect(preview).toMatchObject({ total: 3, valid: 1, withErrors: 2 });
      expect(preview.rows.map((row) => row.errors)).toEqual([[], ['SKU_UNKNOWN'], ['SIN_CODE_UNKNOWN']]);
      expect(await codeOf(svc().homologation.apply(bad))).toBe('IMPORT_HAS_ERRORS');
      expect((await state.base.product.findUniqueOrThrow({ where: { id: a.id } })).sinProductCode).toBeNull();

      const good = file(await sheet([[a.sku, '84821', '58'], [b.sku, '40169', '']]), 'h.xlsx');
      expect(await svc().homologation.apply(good)).toEqual({ updated: 2 });
      expect(await state.base.product.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ sinProductCode: '40169', sinActivityCode: '466900', sinUnitCode: null });
      expect(await audits('invoicing.homologation.import')).toHaveLength(1);
      const template = new ExcelJS.Workbook();
      await template.xlsx.load((await svc().homologation.template()) as never);
      expect(template.worksheets[0].getRow(1).getCell(2).value).toBe('CODIGO_SIN');
    });

    it('the activity must come from the synced catalogue', async () => {
      expect(await codeOf(svc().fiscalSettings.saveActivity({ mainActivityCode: '465900' }))).toBe('CATALOGS_NOT_SYNCED');
      await svc().catalogs.sync();
      expect(await codeOf(svc().fiscalSettings.saveActivity({ mainActivityCode: '000000' }))).toBe('SIN_CODE_UNKNOWN');
      expect(await codeOf(svc().fiscalSettings.saveActivity({ mainActivityCode: '465900', defaultProductCode: '00000' }))).toBe('SIN_CODE_UNKNOWN');
      expect(await svc().fiscalSettings.saveActivity({ mainActivityCode: '465900', defaultProductCode: '99100' })).toEqual({ mainActivityCode: '465900', defaultProductCode: '99100' });
    });
  });

  describe('production (HU-FAC-27)', () => {
    async function makeReady() {
      process.env['SIAT_ALLOW_SIMULATOR'] = 'true';
      await svc().fiscalSettings.saveSignature(file(buildTestP12('c', new Date(Date.now() + 400 * DAY))), 'c');
      await svc().fiscalSettings.saveCredentials({ systemCode: 'SYS1', token: 't', tokenExpiresAt: new Date(Date.now() + 200 * DAY).toISOString() });
      await svc().siatSystemStatus.testConnection();
      await svc().catalogs.sync();
      await svc().fiscalSettings.saveActivity({ mainActivityCode: '465900' });
      const point = await svc().pointsOfSale.create({ branchId: state.branchId, name: 'Caja prod', typeCode: 5, warehouseId: state.centralId });
      expect(point.cuisHealth).toBe('OK');
      // every active product of the company needs its SIN code
      await state.base.product.updateMany({ where: { companyId: state.companyId, status: 'ACTIVE' }, data: { sinProductCode: '84821' } });
    }

    it('is refused with the list of what is missing', async () => {
      const summary = await svc(director).fiscalSettings.summary();
      expect(summary.production.ready).toBe(false);
      expect(summary.production.requirements).toContain('SIGNATURE_MISSING');
      expect(summary.production.requirements).toContain('GATEWAY_SIMULATED');
      expect(await codeOf(svc(director).fiscalSettings.enableProduction(PRODUCTION_CONFIRMATION))).toBe('PRODUCTION_REQUIREMENTS_MISSING');
      const details = (await detailsOf(svc(director).fiscalSettings.enableProduction(PRODUCTION_CONFIRMATION))) as { requirements: string[] };
      expect(details.requirements).toContain('CATALOGS_NOT_SYNCED');
      expect((await settingsRow())?.environment ?? 'TEST').toBe('TEST');
    });

    it('needs the exact word; then switches once, audited, and refuses a second time', async () => {
      await makeReady();
      expect((await svc(director).fiscalSettings.summary()).production).toEqual({ ready: true, requirements: [] });
      expect(await codeOf(svc(director).fiscalSettings.enableProduction('produccion'))).toBe('CONFIRMATION_MISMATCH');
      expect((await settingsRow())?.environment).toBe('TEST');
      const done = await svc(director).fiscalSettings.enableProduction(PRODUCTION_CONFIRMATION);
      expect(done.environment).toBe('PRODUCTION');
      expect(await settingsRow()).toMatchObject({ environment: 'PRODUCTION', productionEnabledById: director.userId });
      expect(await audits('invoicing.production.enable')).toHaveLength(1);
      expect(await codeOf(svc(director).fiscalSettings.enableProduction(PRODUCTION_CONFIRMATION))).toBe('ALREADY_PRODUCTION');
    }, 60_000);

    it('two simultaneous switches: one wins, the other gets ALREADY_PRODUCTION', async () => {
      await makeReady();
      const results = await Promise.allSettled([svc(director).fiscalSettings.enableProduction(PRODUCTION_CONFIRMATION), svc(director).fiscalSettings.enableProduction(PRODUCTION_CONFIRMATION)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await audits('invoicing.production.enable')).toHaveLength(1);
    }, 60_000);
  });
});
