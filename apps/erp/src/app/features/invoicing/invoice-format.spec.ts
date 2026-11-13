import type { InvoiceListItem } from '@rodasoft/domain';
import { historyLabel, INVOICE_STATUS_PILLS, invoiceMenuFor, invoiceNumberLabel, invoiceRangeLabel, parseInvoiceStatus, toInvoiceQuery, toInvoiceRow } from './invoice-format';

const item = (over: Partial<InvoiceListItem> = {}): InvoiceListItem => ({
  id: 'i1',
  number: 12,
  status: 'VALID',
  saleId: 's1',
  saleNumber: 'V-000124',
  customerName: 'Industrias Demo S.A.',
  customerDocumentNumber: '1234567',
  total: '1280.00',
  issuedAt: '2026-11-12T14:24:00.000Z',
  createdAt: '2026-11-12T14:20:00.000Z',
  branchId: 'b1',
  rejectionMessage: null,
  actions: ['VIEW_DETAIL'],
  ...over,
});

describe('invoice format', () => {
  it('names each status in Spanish and has no contingency', () => {
    expect(Object.values(INVOICE_STATUS_PILLS).map((p) => p.label)).toEqual([
      'No facturada en SIAT',
      'Enviando',
      'Válida',
      'Rechazada',
      'Anulación en curso',
      'Anulada',
    ]);
    expect(INVOICE_STATUS_PILLS.PENDING.status).toBe('warning');
    expect(INVOICE_STATUS_PILLS.REJECTED.status).toBe('danger');
  });

  it('parses a status of the URL and ignores anything else', () => {
    expect(parseInvoiceStatus('REJECTED')).toBe('REJECTED');
    expect(parseInvoiceStatus('CONTINGENCY')).toBeNull();
    expect(parseInvoiceStatus(null)).toBeNull();
  });

  it('turns the URL filters into the API query, leaving out the empty ones', () => {
    expect(toInvoiceQuery({ q: '', status: null, from: null, to: null, branchId: null, page: 1 })).toEqual({ page: 1, pageSize: 10 });
    expect(toInvoiceQuery({ q: 'Demo', status: 'PENDING', from: '2026-11-01', to: '2026-11-12', branchId: 'b1', page: 2 })).toMatchObject({ q: 'Demo', status: 'PENDING', from: '2026-11-01', to: '2026-11-12', branchId: 'b1', page: 2 });
  });

  it('prints the number with zeros, or a dash while the SIAT has not numbered it', () => {
    expect(invoiceNumberLabel(12)).toBe('000012');
    expect(invoiceNumberLabel(null)).toBe('—');
  });

  it('builds a table row with the issue date when it exists and the creation date otherwise', () => {
    expect(toInvoiceRow(item()).cells).toMatchObject({ number: '000012', customer: 'Industrias Demo S.A.', sale: 'V-000124', date: '12/11/2026 10:24', total: 'Bs 1.280,00' });
    expect(toInvoiceRow(item({ issuedAt: null, number: null })).cells).toMatchObject({ number: '—', date: '12/11/2026 10:20' });
  });

  it('writes the range of the page', () => {
    expect(invoiceRangeLabel(1, 10, 23)).toBe('1–10 de 23 facturas');
    expect(invoiceRangeLabel(3, 3, 23)).toBe('21–23 de 23 facturas');
    expect(invoiceRangeLabel(1, 1, 1)).toBe('1–1 de 1 factura');
    expect(invoiceRangeLabel(1, 0, 0)).toBe('');
  });

  it('builds the row menu from the actions the API allows, in the order the API gives them', () => {
    const menu = invoiceMenuFor(item({ actions: ['VIEW_DETAIL', 'DOWNLOAD_PDF', 'DOWNLOAD_XML', 'SEND', 'ISSUE', 'ISSUE_CREDIT_NOTE', 'REQUEST_CANCELLATION'] }));
    expect(menu.map((m) => m.key)).toEqual(['view', 'pdf', 'xml', 'send', 'issue', 'credit-note', 'cancel']);
    expect(menu.find((m) => m.key === 'cancel')?.danger).toBe(true);
    expect(invoiceMenuFor(item({ actions: [] }))).toEqual([]);
  });

  it('translates the SIAT history and keeps an unknown action as it is', () => {
    expect(historyLabel('invoicing.invoice.accept')).toBe('Aceptada por el SIAT');
    expect(historyLabel('invoicing.invoice.unavailable')).toContain('queda sin facturar');
    expect(historyLabel('something.else')).toBe('something.else');
  });
});
