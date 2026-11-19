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

  it('carries the SIN activity, product and unit when the product has them', () => {
    const xml = buildInvoiceXml({
      ...input,
      activityCode: '465900',
      lines: [{ ...input.lines[0], sinProductCode: '84821', sinActivityCode: '465900', sinUnitCode: 58 }],
    });
    expect(xml).toContain('<actividadEconomica>465900</actividadEconomica>');
    expect(xml).toContain('<codigoProductoSin>84821</codigoProductoSin>');
    expect(xml).toContain('<unidadMedida>58</unidadMedida>');
  });

  it('leaves the SIN tags out for a product without them', () => {
    const xml = buildInvoiceXml(input);
    expect(xml).not.toContain('codigoProductoSin');
    expect(xml).not.toContain('actividadEconomica');
  });
});
