import type { SaleListItem } from '@rodasoft/domain';
import { historyLabel, invoiceLabel, parseMethod, parseStatus, rangeLabel, ROW_MENU, SALES_PAGE_SIZE, toCsv, toQuery, toRow, toTotals } from './sale-format';

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

  it('says the history actions in Spanish', () => {
    expect(historyLabel({ action: 'sales.sale.complete', email: null })).toBe('Venta completada');
    expect(historyLabel({ action: 'sales.receipt.reprint', email: null })).toBe('Comprobante reimpreso');
    expect(historyLabel({ action: 'sales.receipt.email', email: 'a@b.com' })).toBe('Comprobante enviado a a@b.com');
    expect(historyLabel({ action: 'sales.cancellation.approve', email: null })).toBe('Movimiento registrado');
  });

  it('says the invoice state', () => {
    expect(invoiceLabel('PENDING', null)).toBe('Pendiente de emisión SIAT');
    expect(invoiceLabel('VALID', 456)).toBe('Factura 456');
  });
});
