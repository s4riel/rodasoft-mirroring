import { SiatUnavailableError, type SiatCreditNoteSubmission, type SiatInvoiceSubmission } from './gateway';
import { InMemorySiatStore, SimulatedSiatGateway, type SimulatorMode } from './simulated.gateway';

const invoice = (nit: string, nitException = false): SiatInvoiceSubmission => ({
  cuf: 'ABCDEF1234567890ABCDEF',
  number: 1,
  issuedAt: new Date('2026-11-12T15:00:00Z'),
  issuerNit: '1020304050',
  customer: { name: 'Cliente', documentType: 5, documentNumber: nit, complement: null },
  total: '100.00',
  xml: '<x/>',
  nitException,
});

describe('SimulatedSiatGateway', () => {
  let mode: SimulatorMode;
  let gateway: SimulatedSiatGateway;
  beforeEach(() => {
    mode = 'ONLINE';
    gateway = new SimulatedSiatGateway(() => mode, new InMemorySiatStore());
  });

  it('accepts an invoice and remembers it for the status query', async () => {
    const result = await gateway.sendInvoice(invoice('1234567'));
    expect(result.status).toBe('ACCEPTED');
    expect((await gateway.invoiceStatus(invoice('1234567').cuf)).status).toBe('ACCEPTED');
    expect((await gateway.invoiceStatus('NOPE')).status).toBe('UNKNOWN');
  });

  it('rejects an unknown NIT unless the invoice carries the approved exception', async () => {
    expect(await gateway.sendInvoice(invoice('9991234'))).toMatchObject({ status: 'REJECTED', code: 1037 });
    expect((await gateway.sendInvoice(invoice('9991234', true))).status).toBe('ACCEPTED');
    expect((await gateway.verifyNit('9991234')).valid).toBe(false);
    expect((await gateway.verifyNit('1234567')).valid).toBe(true);
  });

  it('throws SiatUnavailableError for every call while offline, but reports the failed communication', async () => {
    mode = 'OFFLINE';
    await expect(gateway.sendInvoice(invoice('1234567'))).rejects.toBeInstanceOf(SiatUnavailableError);
    await expect(gateway.verifyNit('1234567')).rejects.toBeInstanceOf(SiatUnavailableError);
    await expect(gateway.cancelInvoice('X', 1)).rejects.toBeInstanceOf(SiatUnavailableError);
    expect(await gateway.verifyCommunication()).toEqual({ success: false });
  });

  it('cancels an accepted invoice once and again without error, and refuses an unknown one or a bad reason', async () => {
    const { cuf } = invoice('1234567');
    await gateway.sendInvoice(invoice('1234567'));
    expect(await gateway.cancelInvoice(cuf, 1)).toEqual({ cancelled: true });
    expect(await gateway.cancelInvoice(cuf, 1)).toEqual({ cancelled: true });
    expect((await gateway.invoiceStatus(cuf)).status).toBe('CANCELLED');
    expect((await gateway.cancelInvoice('UNKNOWN', 1)).cancelled).toBe(false);
    await gateway.sendInvoice({ ...invoice('1234567'), cuf: 'OTHER' });
    expect((await gateway.cancelInvoice('OTHER', 9)).cancelled).toBe(false);
  });

  describe('credit notes (HU-FAC-12)', () => {
    const note = (nit: string, nitException = false): SiatCreditNoteSubmission => ({
      cuf: 'NOTE1234567890ABCDEF',
      number: 1,
      issuedAt: new Date('2026-11-16T15:00:00Z'),
      issuerNit: '1020304050',
      customer: { name: 'Cliente', documentType: 5, documentNumber: nit, complement: null },
      total: '50.00',
      invoiceCuf: invoice(nit).cuf,
      reasonCode: 1,
      xml: '<x/>',
      nitException,
    });

    it('accepts the note of a valid invoice and answers for its CUF afterwards', async () => {
      await gateway.sendInvoice(invoice('1234567'));
      const result = await gateway.sendCreditNote(note('1234567'));
      expect(result).toMatchObject({ status: 'ACCEPTED', receptionCode: 'SIM-NC-NOTE12345678' });
      expect((await gateway.invoiceStatus(note('1234567').cuf)).status).toBe('ACCEPTED');
    });

    it('rejects the note of an invoice it does not hold, or of a cancelled one', async () => {
      expect(await gateway.sendCreditNote(note('1234567'))).toMatchObject({ status: 'REJECTED', code: 906 });
      await gateway.sendInvoice(invoice('1234567'));
      await gateway.cancelInvoice(invoice('1234567').cuf, 1);
      expect(await gateway.sendCreditNote(note('1234567'))).toMatchObject({ status: 'REJECTED', code: 906 });
    });

    it('applies the unknown NIT rule, with the exception of the invoice', async () => {
      await gateway.sendInvoice(invoice('9991234', true));
      expect(await gateway.sendCreditNote(note('9991234'))).toMatchObject({ status: 'REJECTED', code: 1037 });
      expect((await gateway.sendCreditNote(note('9991234', true))).status).toBe('ACCEPTED');
    });

    it('is unavailable while offline', async () => {
      mode = 'OFFLINE';
      await expect(gateway.sendCreditNote(note('1234567'))).rejects.toBeInstanceOf(SiatUnavailableError);
    });
  });

  describe('codes (HU-FAC-13)', () => {
    const point = { branchCode: 0, pointOfSaleCode: 1 };

    it('hands out a new CUFD valid for 24 hours every time, and a stable CUIS valid for a year', async () => {
      let now = new Date('2026-11-16T10:00:00Z');
      const clocked = new SimulatedSiatGateway(() => mode, new InMemorySiatStore(), () => now);
      const first = await clocked.requestCufd(point);
      expect(first.expiresAt).toEqual(new Date('2026-11-17T10:00:00Z'));
      expect(first.code).toContain('SIMCUFD-0-1-');
      expect(first.controlCode).toMatch(/^SIM/);
      now = new Date('2026-11-16T10:00:01Z');
      const second = await clocked.requestCufd(point);
      expect(second.code).not.toBe(first.code);
      const cuis = await clocked.requestCuis(point);
      expect(cuis).toEqual({ code: 'SIMCUIS-0-1', expiresAt: new Date('2027-11-16T10:00:01Z') });
    });

    it('cannot renew codes while offline', async () => {
      mode = 'OFFLINE';
      await expect(gateway.requestCufd(point)).rejects.toBeInstanceOf(SiatUnavailableError);
      await expect(gateway.requestCuis(point)).rejects.toBeInstanceOf(SiatUnavailableError);
    });
  });

  describe('points of sale and catalogues (HU-FAC-24, HU-FAC-25)', () => {
    const registration = (name: string, knownCodes: number[] = []) => ({ branchCode: 0, name, typeCode: 5, knownCodes });

    it('hands out consecutive codes per branch above the ones the company already holds', async () => {
      expect(await gateway.registerPointOfSale(registration('Caja 1', [0, 1]))).toEqual({ code: 2 });
      expect(await gateway.registerPointOfSale(registration('Caja 2', [0, 1]))).toEqual({ code: 3 });
      expect(await gateway.registerPointOfSale({ ...registration('Caja 1'), branchCode: 1 })).toEqual({ code: 1 });
    });

    it('registering the same branch and name again returns the same code', async () => {
      const first = await gateway.registerPointOfSale(registration('Caja 1'));
      expect(await gateway.registerPointOfSale(registration(' caja 1 '))).toEqual(first);
    });

    it('syncs the catalogues and closes a point of sale, but not while offline', async () => {
      const catalogs = await gateway.syncCatalogs({ branchCode: 0, pointOfSaleCode: 0 });
      expect(catalogs.ACTIVITY.length).toBeGreaterThan(0);
      expect(catalogs.CANCELLATION_REASON.map((row) => row.code)).toEqual(['1', '2', '3', '4']);
      await expect(gateway.closePointOfSale({ branchCode: 0, pointOfSaleCode: 1 })).resolves.toBeUndefined();
      mode = 'OFFLINE';
      await expect(gateway.registerPointOfSale(registration('Caja 9'))).rejects.toBeInstanceOf(SiatUnavailableError);
      await expect(gateway.syncCatalogs({ branchCode: 0, pointOfSaleCode: 0 })).rejects.toBeInstanceOf(SiatUnavailableError);
      await expect(gateway.closePointOfSale({ branchCode: 0, pointOfSaleCode: 1 })).rejects.toBeInstanceOf(SiatUnavailableError);
    });
  });
});
