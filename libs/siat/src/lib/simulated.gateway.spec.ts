import { SiatUnavailableError, type SiatInvoiceSubmission } from './gateway';
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
});
