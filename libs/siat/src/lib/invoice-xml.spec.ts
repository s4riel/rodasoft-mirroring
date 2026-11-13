import { buildInvoiceXml } from './invoice-xml';

const input = {
  issuerNit: '1020304050',
  issuerName: 'Rodalaser & Cia',
  branchCode: 0,
  pointOfSaleCode: 0,
  cuf: 'ABCD',
  number: 12,
  issuedAt: new Date('2026-11-12T15:30:00Z'),
  customer: { name: 'Juan <Perez>', documentType: 5, documentNumber: '123', complement: null },
  total: '150.00',
  lines: [{ code: 'RL-000001', description: 'Rodamiento "6205"', quantity: 2, unitPrice: '75.00', subtotal: '150.00' }],
  legend: 'Ley 453',
};

describe('buildInvoiceXml', () => {
  it('is marked provisional and carries number, CUF, date in La Paz time and total', () => {
    const xml = buildInvoiceXml(input);
    expect(xml).toContain('PROVISIONAL');
    expect(xml).toContain('<numeroFactura>12</numeroFactura>');
    expect(xml).toContain('<cuf>ABCD</cuf>');
    expect(xml).toContain('<montoTotal>150.00</montoTotal>');
    expect(xml).toContain('<fechaEmision>2026-11-12T11:30:00.000</fechaEmision>');
  });

  it('escapes the text of the customer, the issuer and the lines', () => {
    const xml = buildInvoiceXml(input);
    expect(xml).toContain('Juan &lt;Perez&gt;');
    expect(xml).toContain('Rodalaser &amp; Cia');
    expect(xml).toContain('Rodamiento &quot;6205&quot;');
    expect(xml).not.toContain('<complemento>');
  });
});
