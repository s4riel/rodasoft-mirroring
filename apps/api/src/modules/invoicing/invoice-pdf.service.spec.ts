import { InvoicePdfService, type InvoicePdfInput } from './invoice-pdf.service';

const input = (over: Partial<InvoicePdfInput> = {}): InvoicePdfInput => ({
  issuerName: 'Rodalaser S.R.L.',
  issuerNit: '1020304050',
  branchName: 'Sucursal central',
  pointOfSale: '0 · Caja 1',
  number: 12,
  cuf: 'ABCDEF0123456789SIM0',
  issuedAt: new Date('2026-11-12T14:24:00Z'),
  status: 'VALID',
  customerName: 'Industrias Demo S.A.',
  customerDocument: 'NIT 1234567',
  lines: [{ description: 'Rodamiento 6205', quantity: 2, unitPrice: '640.25', total: '1280.50' }],
  total: '1280.50',
  legend: 'Ley 453',
  verificationUrl: 'https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=1020304050&cuf=ABCDEF0123456789SIM0&numero=12&t=2',
  ...over,
});

const service = new InvoicePdfService();
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('InvoicePdfService (HU-FAC-05)', () => {
  it('produces a PDF with a header, a trailer and one page', async () => {
    const pdf = await service.render(input());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
    expect(pages(pdf)).toBe(1);
  });

  it('carries the invoice title and issuer in the document info', async () => {
    const text = (await service.render(input(), { compress: false })).toString('latin1');
    expect(text).toContain('/Title');
    expect(text).toContain('/Author');
  });

  it('flows a long invoice onto more pages', async () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ description: `Producto ${i}`, quantity: 1, unitPrice: '10.00', total: '10.00' }));
    expect(pages(await service.render(input({ lines, total: '800.00' })))).toBeGreaterThan(1);
  });

  it('draws the page with the number, CUF, NIT and total in words (readable when not compressed)', async () => {
    const raw = (await service.render(input(), { compress: false })).toString('latin1');
    // pdfkit writes text as hex strings of the font encoding; decode every <...> Tj / TJ operand back to text
    const decoded = [...raw.matchAll(/<([0-9a-f]+)>/gi)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('|');
    for (const expected of ['000012', 'ABCDEF0123456789SIM0', '1020304050', 'Mil doscientos ochenta 50/100 Bolivianos', 'Industrias Demo']) {
      expect(decoded.replace(/\|/g, '')).toContain(expected);
    }
  });

  it('marks a cancelled invoice', async () => {
    const raw = (await service.render(input({ status: 'CANCELLED' }), { compress: false })).toString('latin1');
    const decoded = [...raw.matchAll(/<([0-9a-f]+)>/gi)].map((m) => Buffer.from(m[1], 'hex').toString('latin1')).join('');
    expect(decoded).toContain('ANULADA');
  });
});
