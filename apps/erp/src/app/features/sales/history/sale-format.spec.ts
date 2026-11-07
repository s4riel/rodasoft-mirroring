import type { SaleListItem } from '@rodasoft/domain';
import {
  CANCELLATION_REASON_OPTIONS,
  cancellationDeadlineText,
  cancellationReasonLabel,
  cancelledSummary,
  elapsedText,
  historyLabel,
  impactSentence,
  invoiceLabel,
  parseMethod,
  parseStatus,
  rangeLabel,
  ROW_MENU,
  rowMenuFor,
  SALES_PAGE_SIZE,
  toCsv,
  toQuery,
  toRow,
  toTotals,
} from './sale-format';

const item = (over: Partial<SaleListItem> = {}): SaleListItem => ({
  id: 's1',
  number: 'V-000124',
  customerName: 'Industrias Demo S.A.',
  createdAt: '2026-10-14T14:24:00.000Z',
  itemsCount: 8,
  total: '1280.00',
  status: 'COMPLETED',
  invoiceStatus: 'PENDING',
  methods: ['CASH', 'QR'],
  ...over,
});

describe('sale format', () => {
  it('parses only known statuses and methods from the URL', () => {
    expect(parseStatus('CANCELLED')).toBe('CANCELLED');
    expect(parseStatus('nope')).toBeNull();
    expect(parseMethod('QR')).toBe('QR');
    expect(parseMethod(null)).toBeNull();
  });

  it('builds the API query leaving out empty filters', () => {
    const query = toQuery({ q: '', status: null, method: 'CASH', from: '2026-10-01', to: null, cashierId: null, page: 2 });
    expect(query).toEqual({ q: undefined, status: undefined, method: 'CASH', from: '2026-10-01', to: undefined, cashierId: undefined, page: 2, pageSize: SALES_PAGE_SIZE });
  });

  it('turns a sale into a table row with its Spanish status', () => {
    const row = toRow(item());
    expect(row.cells).toMatchObject({ number: 'V-000124', customer: 'Industrias Demo S.A.', date: '14/10/2026 10:24', items: 8, total: 'Bs 1.280,00' });
    expect(row.cells['status']).toMatchObject({ label: 'Pagada', status: 'success' });
  });

  it('totals the page: sales, units and amount', () => {
    const totals = toTotals([item(), item({ id: 's2', itemsCount: 2, total: '640.00' })]);
    expect(totals).toMatchObject({ customer: '2 ventas', items: 10, total: 'Bs 1.920,00' });
    expect(toTotals([item()])['customer']).toBe('1 venta');
  });

  it('writes the range of the page', () => {
    expect(rangeLabel(1, 3, 3)).toBe('1–3 de 3 ventas');
    expect(rangeLabel(2, 10, 23)).toBe('11–20 de 23 ventas');
    expect(rangeLabel(1, 0, 0)).toBe('');
  });

  it('exports a CSV with the methods and no costs', () => {
    const csv = toCsv([item({ customerName: 'Pérez; "Hnos"' })]);
    const [header, line] = csv.split('\r\n');
    expect(header).toBe('N.º;Cliente;Fecha;Ítems;Total;Formas de pago;Estado');
    expect(line).toBe('V-000124;"Pérez; ""Hnos""";14/10/2026 10:24;8;Bs 1.280,00;Efectivo + QR;Pagada');
    expect(csv.toLowerCase()).not.toContain('costo');
  });

  it('keeps a customer name that looks like a formula as text in the CSV', () => {
    const [, line] = toCsv([item({ customerName: '=HYPERLINK("x")' })]).split('\r\n');
    expect(line.split(';')[1]).toBe(`"'=HYPERLINK(""x"")"`);
    expect(toCsv([item({ customerName: '@cmd' })])).toContain(";'@cmd;");
  });

  it('offers only the actions that are built', () => {
    expect(ROW_MENU.map((m) => m.label)).toEqual(['Ver venta', 'Reimprimir']);
  });

  it('adds "Solicitar anulación" only for a paid sale and who may ask for it', () => {
    expect(rowMenuFor({ status: 'COMPLETED' }, true).map((m) => m.label)).toEqual(['Ver venta', 'Reimprimir', 'Solicitar anulación']);
    expect(rowMenuFor({ status: 'COMPLETED' }, false)).toBe(ROW_MENU);
    expect(rowMenuFor({ status: 'CANCELLATION_PENDING' }, true)).toBe(ROW_MENU);
    expect(rowMenuFor({ status: 'CANCELLED' }, true)).toBe(ROW_MENU);
  });

  it('names the four cancellation reasons in Spanish, in the order of the dialog', () => {
    expect(CANCELLATION_REASON_OPTIONS.map((o) => o.label)).toEqual([
      'Error en datos del cliente',
      'Error en productos o precios',
      'Venta no concretada',
      'Otro',
    ]);
    expect(cancellationReasonLabel('SALE_NOT_COMPLETED')).toBe('Venta no concretada');
    expect(cancellationReasonLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('says the cancellation deadline as the last La Paz day to ask, or that there is no limit', () => {
    expect(cancellationDeadlineText(null)).toBe('sin límite');
    // the window closes at the start of 17 Oct in La Paz, so the 16th is the last day
    expect(cancellationDeadlineText('2026-10-17T04:00:00.000Z')).toBe('16/10/2026');
  });

  it('says the history actions in Spanish', () => {
    expect(historyLabel({ action: 'sales.sale.complete', email: null })).toBe('Venta completada');
    expect(historyLabel({ action: 'sales.receipt.reprint', email: null })).toBe('Comprobante reimpreso');
    expect(historyLabel({ action: 'sales.receipt.email', email: 'a@b.com' })).toBe('Comprobante enviado a a@b.com');
    expect(historyLabel({ action: 'sales.sale.cancellation-request', email: null })).toBe('Anulación solicitada · esperando a Gerencia');
    expect(historyLabel({ action: 'sales.sale.cancellation-withdraw', email: null })).toBe('Solicitud de anulación retirada');
    expect(historyLabel({ action: 'sales.cancellation.approve', email: null })).toBe('Movimiento registrado');
  });

  it('says the invoice state', () => {
    expect(invoiceLabel('PENDING', null)).toBe('Pendiente de emisión SIAT');
    expect(invoiceLabel('VALID', 456)).toBe('Factura 456');
  });
});

describe('deciding a cancellation (HU-VEN-15)', () => {
  const place = { warehouseName: 'Huayna Kapac', registerName: 'Caja 1' };

  it('labels the decision in the history and the cancelled invoice', () => {
    expect(historyLabel({ action: 'sales.sale.cancellation-approve', email: null })).toBe('Anulación aprobada · factura anulada');
    expect(historyLabel({ action: 'sales.sale.cancellation-reject', email: null })).toBe('Anulación rechazada');
    expect(invoiceLabel('CANCELLED', 1528)).toBe('Factura 1528 anulada');
    expect(invoiceLabel('CANCELLED', null)).toBe('Factura anulada');
  });

  it('says how long ago the sale was made, rounded down', () => {
    const now = new Date('2026-10-14T15:15:00.000Z');
    expect(elapsedText('2026-10-14T14:24:00.000Z', now)).toBe('51 minutos');
    expect(elapsedText('2026-10-14T15:14:00.000Z', now)).toBe('1 minuto');
    expect(elapsedText('2026-10-14T12:00:00.000Z', now)).toBe('3 horas');
    expect(elapsedText('2026-10-14T14:00:00.000Z', now)).toBe('1 hora');
    expect(elapsedText('2026-10-12T12:00:00.000Z', now)).toBe('2 días');
    expect(elapsedText('2026-10-14T16:00:00.000Z', now)).toBe('0 minutos');
  });

  it('tells what an approval will do for a cash sale with a pending invoice', () => {
    const text = impactSentence({ invoiceAction: 'VOID', stockUnits: 8, cashRefund: '1280.00', manualRefunds: [], ...place });
    expect(text).toBe('Se anula la factura (todavía no se emitió en el SIAT), el stock (8 piezas) vuelve a Huayna Kapac y se registra el reembolso de Bs 1.280,00 en Caja 1.');
  });

  it('asks the SIAT to cancel a valid invoice and leaves the QR part to refund by hand', () => {
    const text = impactSentence({
      invoiceAction: 'REQUEST_SIAT_CANCELLATION',
      stockUnits: 1,
      cashRefund: '100.00',
      manualRefunds: [{ method: 'QR', amount: '50.00' }],
      ...place,
    });
    expect(text).toContain('Se anula la factura en el SIAT');
    expect(text).toContain('el stock (1 pieza)');
    expect(text).toContain('Reembolso de QR Bs 50,00 a gestionar manualmente.');
  });

  it('leaves the refund out when no cash was kept and says an invoice that cannot be cancelled', () => {
    const text = impactSentence({ invoiceAction: 'BLOCKED', stockUnits: 2, cashRefund: '0.00', manualRefunds: [{ method: 'CARD', amount: '90.00' }], ...place });
    expect(text).toBe('La factura no se puede anular en su estado actual, el stock (2 piezas) vuelve a Huayna Kapac. Reembolso de tarjeta Bs 90,00 a gestionar manualmente.');
  });

  it('summarizes a cancelled sale', () => {
    const sale = {
      invoice: { status: 'CANCELLED', number: 1528 },
      lines: [{ quantity: 4 }, { quantity: 4 }],
      payments: [{ method: 'CASH' as const, amount: '1280.00' }],
    };
    expect(cancelledSummary(sale, place)).toBe('Factura 1528 anulada · 8 piezas devueltas a Huayna Kapac · reembolso Bs 1.280,00 registrado en Caja 1');
    expect(cancelledSummary({ ...sale, invoice: { status: 'CANCELLED', number: null }, payments: [{ method: 'QR', amount: '1280.00' }] }, place)).toBe(
      'Factura anulada · 8 piezas devueltas a Huayna Kapac · reembolso de QR Bs 1.280,00 a gestionar manualmente',
    );
  });
});
