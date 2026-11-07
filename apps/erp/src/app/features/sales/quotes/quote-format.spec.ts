import { documentRangeLabel, editorTotals, formatDay, parseOrderStatus, parseQuoteStatus, stockHint, toOrderRow, toQuoteRow } from './quote-format';

describe('quote format', () => {
  it('reads only known statuses from the URL', () => {
    expect(parseQuoteStatus('SENT')).toBe('SENT');
    expect(parseQuoteStatus('nope')).toBeNull();
    expect(parseQuoteStatus(null)).toBeNull();
    expect(parseOrderStatus('OPEN')).toBe('OPEN');
    expect(parseOrderStatus('SENT')).toBeNull();
  });

  it('prints a day as dd/mm/aaaa', () => {
    expect(formatDay('2026-11-14')).toBe('14/11/2026');
  });

  it('turns a quote and an order into table rows with their Spanish pill', () => {
    const quote = toQuoteRow({
      id: 'q1',
      number: 'COT-000001',
      customerName: 'Ana',
      createdAt: '2026-11-07T15:00:00.000Z',
      validUntil: '2026-11-14',
      itemsCount: 6,
      total: '302.00',
      status: 'EXPIRED',
      orderNumber: null,
    });
    expect(quote.cells['status']).toMatchObject({ label: 'Vencida', status: 'warning' });
    expect(quote.cells['validUntil']).toBe('14/11/2026');
    const order = toOrderRow({
      id: 'o1',
      number: 'PED-000001',
      customerName: 'Ana',
      quoteNumber: null,
      warehouseName: 'Central',
      createdAt: '2026-11-07T15:00:00.000Z',
      total: '10.00',
      status: 'OPEN',
    });
    expect(order.cells['status']).toMatchObject({ label: 'Reservado' });
    expect(order.cells['quote']).toBe('—');
  });

  it('previews the total like the server: customer discount, then rounding', () => {
    const lines = [{ unitPrice: '33.33', quantity: 3 }];
    expect(editorTotals(lines, null, 'NONE')).toEqual({ subtotal: '99.99', discount: '0.00', rounding: '0.00', total: '99.99' });
    expect(editorTotals(lines, { type: 'PERCENT', value: '10.00' }, 'INTEGER')).toEqual({
      subtotal: '99.99',
      discount: '10.00',
      rounding: '0.01',
      total: '90.00',
    });
  });

  it('says what the stock allows', () => {
    expect(stockHint(0, 1)).toEqual({ text: 'Sin existencia', short: true });
    expect(stockHint(5, 6)).toEqual({ text: 'Disponible 5', short: true });
    expect(stockHint(5, 5)).toEqual({ text: 'Disponible 5', short: false });
  });

  it('labels the range of a page', () => {
    expect(documentRangeLabel(1, 0, 0, 'pedido', 'pedidos')).toBe('');
    expect(documentRangeLabel(2, 3, 13, 'pedido', 'pedidos')).toBe('11–13 de 13 pedidos');
    expect(documentRangeLabel(1, 1, 1, 'pedido', 'pedidos')).toBe('1–1 de 1 pedido');
  });
});
