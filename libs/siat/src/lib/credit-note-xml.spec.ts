import { buildCreditNoteXml } from './credit-note-xml';

const input = {
  issuerNit: '1020304050',
  issuerName: 'Rodalaser & Cia',
  branchCode: 0,
  pointOfSaleCode: 1,
  cuf: 'NOTECUF',
  number: 45,
  issuedAt: new Date('2026-11-16T16:06:00Z'),
  customer: { name: 'Industrias <Demo>', documentType: 5, documentNumber: '123', complement: 'A1' },
  invoiceNumber: 1528,
  invoiceCuf: 'INVOICECUF',
  invoiceIssuedAt: new Date('2026-11-14T14:24:00Z'),
  invoiceTotal: '1280.00',
  reasonCode: 2,
  total: '245.00',
  vatAdjusted: '31.85',
  lines: [{ code: 'RL-000001', description: 'Rodamiento "6205"', quantity: 1, unitPrice: '245.00', amount: '245.00' }],
  legend: 'Ley 453',
};

describe('buildCreditNoteXml', () => {
  it('is marked provisional and carries the note, the invoice it corrects, the reason and the amounts', () => {
    const xml = buildCreditNoteXml(input);
    expect(xml).toContain('PROVISIONAL');
    expect(xml).toContain('<numeroNotaCreditoDebito>45</numeroNotaCreditoDebito>');
    expect(xml).toContain('<cuf>NOTECUF</cuf>');
    expect(xml).toContain('<codigoPuntoVenta>1</codigoPuntoVenta>');
    expect(xml).toContain('<fechaEmision>2026-11-16T12:06:00.000</fechaEmision>');
    expect(xml).toContain('<numeroFactura>1528</numeroFactura>');
    expect(xml).toContain('<numeroAutorizacionCuf>INVOICECUF</numeroAutorizacionCuf>');
    expect(xml).toContain('<fechaEmisionFactura>2026-11-14T10:24:00.000</fechaEmisionFactura>');
    expect(xml).toContain('<montoTotalOriginal>1280.00</montoTotalOriginal>');
    expect(xml).toContain('<montoTotalDevuelto>245.00</montoTotalDevuelto>');
    expect(xml).toContain('<montoEfectivoCreditoDebito>31.85</montoEfectivoCreditoDebito>');
    expect(xml).toContain('<codigoMotivo>2</codigoMotivo>');
    expect(xml).toContain('<cantidad>1</cantidad><precioUnitario>245.00</precioUnitario><subTotal>245.00</subTotal>');
  });

  it('escapes the text and leaves the complement out when there is none', () => {
    const xml = buildCreditNoteXml(input);
    expect(xml).toContain('Industrias &lt;Demo&gt;');
    expect(xml).toContain('Rodalaser &amp; Cia');
    expect(xml).toContain('Rodamiento &quot;6205&quot;');
    expect(xml).toContain('<complemento>A1</complemento>');
    expect(buildCreditNoteXml({ ...input, customer: { ...input.customer, complement: null } })).not.toContain('<complemento>');
  });
});
