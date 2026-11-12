import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import type { SaleReceipt } from '@rodasoft/domain';
import { ReceiptPrintPage } from './receipt-print.page';

const RECEIPT_URL = '/api/v1/sales/sales/s1/receipt';

const receipt = (over: Partial<SaleReceipt> = {}): SaleReceipt => ({
  saleId: 's1',
  number: 'V-000125',
  createdAt: '2026-10-14T14:42:00.000Z',
  company: { tradeName: 'Rodalaser', legalName: 'Rodalaser S.R.L.', nit: '1020304050' },
  branch: { name: 'Sucursal central' },
  cashier: { name: 'Alberto Andia' },
  customer: { name: 'S/N', documentType: 5, documentNumber: '0', complement: null, email: null },
  lines: [{ code: '6205-2RS', name: 'Rodamiento rígido de bolas', quantity: 2, unitPrice: '245.00', lineTotal: '490.00', spec: { measures: { innerDiameter: '25', outerDiameter: '52', width: '15' }, category: 'Rodamientos', subcategory: 'Rígidos de bolas', details: ['Sello: 2RS'] } }],
  subtotal: '490.00',
  discountType: 'NONE',
  discountAmount: '0.00',
  roundingAmount: '0.00',
  total: '490.00',
  payments: [{ method: 'CASH', amount: '490.00', change: '10.00', dueDate: null }],
  invoiceStatus: 'PENDING',
  format: 'TICKET_80MM',
  ...over,
});

describe('ReceiptPrintPage', () => {
  let http: HttpTestingController;
  let print: jest.SpyInstance;

  async function render(query: Record<string, string> = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ saleId: 's1' }), queryParamMap: convertToParamMap(query) } },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    print = jest.spyOn(window, 'print').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(ReceiptPrintPage);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  const el = (fixture: Awaited<ReturnType<typeof render>>) => fixture.nativeElement as HTMLElement;
  const settle = async (fixture: Awaited<ReturnType<typeof render>>) => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  afterEach(() => {
    http.verify();
    print.mockRestore();
    document.head.querySelectorAll('style').forEach((s) => s.textContent?.includes('@page') && s.remove());
  });

  it('shows the receipt of the sale in Spanish, with the company, number, lines, totals and the change', async () => {
    const fixture = await render();
    expect(el(fixture).querySelector('[role=status]')).not.toBeNull();
    http.expectOne(RECEIPT_URL).flush(receipt());
    await settle(fixture);
    const text = el(fixture).textContent ?? '';
    expect(text).toContain('Rodalaser S.R.L.');
    expect(text).toContain('NIT 1020304050');
    expect(text).toContain('V-000125');
    expect(text).toContain('14/10/2026 10:42');
    expect(text).toContain('6205-2RS · Rodamiento rígido de bolas');
    expect(text).toContain('2 × Bs 245,00');
    expect(text).toContain('Efectivo recibido');
    expect(text).toContain('Bs 500,00');
    expect(text).toContain('Cambio');
    expect(text).toContain('Bs 10,00');
    expect(text).toContain('Factura pendiente de emisión');
    expect(text).not.toContain('Descuento');
  });

  it('writes the due date of a credit sale and no cash received (HU-VEN-34)', async () => {
    const fixture = await render();
    http.expectOne(RECEIPT_URL).flush(receipt({ payments: [{ method: 'CREDIT', amount: '490.00', change: '0.00', dueDate: '2026-11-21' }] }));
    await settle(fixture);
    const text = el(fixture).textContent ?? '';
    expect(text).toContain('Crédito · vence 21/11/2026');
    expect(text).not.toContain('Efectivo recibido');
  });

  it('shows the discount and the rounding only when there are some', async () => {
    const fixture = await render();
    http.expectOne(RECEIPT_URL).flush(receipt({ discountAmount: '49.00', roundingAmount: '-0.20', subtotal: '490.00', total: '440.80' }));
    await settle(fixture);
    const text = el(fixture).textContent ?? '';
    expect(text).toContain('Descuento');
    expect(text).toContain('−Bs 49,00');
    expect(text).toContain('Redondeo');
  });

  it('draws the paper of the company setting: 80 mm by default, letter when set', async () => {
    const fixture = await render();
    http.expectOne(RECEIPT_URL).flush(receipt({ format: 'LETTER' }));
    await settle(fixture);
    expect(el(fixture).querySelector('rs-receipt')?.getAttribute('data-paper')).toBe('letter');
    expect(Array.from(document.head.querySelectorAll('style')).some((s) => s.textContent?.includes('size: letter'))).toBe(true);
  });

  it('opens the print dialog once the receipt is drawn, and again from the button', async () => {
    const fixture = await render();
    http.expectOne(RECEIPT_URL).flush(receipt());
    await settle(fixture);
    await new Promise((resolve) => setTimeout(resolve, 20));
    // the receipt printed itself (earlier tests' timers may also fire here, so count from now on)
    expect(print).toHaveBeenCalled();
    const before = print.mock.calls.length;
    Array.from(el(fixture).querySelectorAll('button')).find((b) => b.textContent?.includes('Imprimir'))!.click();
    expect(print.mock.calls.length).toBe(before + 1);
  });

  it('says there is no permission, without a retry', async () => {
    const fixture = await render();
    http.expectOne(RECEIPT_URL).flush({ code: 'NO_PERMISSION', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await settle(fixture);
    expect(el(fixture).querySelector('[role=alert]')?.textContent).toContain('No tienes permiso para ver este comprobante');
    expect(Array.from(el(fixture).querySelectorAll('button')).some((b) => b.textContent?.includes('Reintentar'))).toBe(false);
  });

  it('retries after an error and then shows the receipt', async () => {
    const fixture = await render();
    http.expectOne(RECEIPT_URL).flush({}, { status: 500, statusText: 'Server Error' });
    await settle(fixture);
    Array.from(el(fixture).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar'))!.click();
    await settle(fixture);
    http.expectOne(RECEIPT_URL).flush(receipt());
    await settle(fixture);
    expect(el(fixture).querySelector('rs-receipt')).not.toBeNull();
  });

  it('says it could not load the receipt', async () => {
    const fixture = await render();
    http.expectOne(RECEIPT_URL).flush({ code: 'SALE_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(fixture);
    expect(el(fixture).querySelector('[role=alert]')?.textContent).toContain('No pudimos cargar el comprobante');
    expect(el(fixture).textContent).toContain('La venta no existe.');
    expect(print).not.toHaveBeenCalled();
  });

  it('a reprint records itself first and then prints the ticket with the REIMPRESIÓN line', async () => {
    const fixture = await render({ reprint: '1' });
    http.expectOne(RECEIPT_URL).flush(receipt());
    // the ticket is not drawn until the server has recorded the reprint
    expect(el(fixture).querySelector('rs-receipt')).toBeNull();
    http.expectOne({ method: 'POST', url: '/api/v1/sales/sales/s1/receipt/reprint' }).flush({ printedAt: '2026-10-15T15:30:00.000Z' });
    await settle(fixture);
    expect(el(fixture).textContent).toContain('REIMPRESIÓN · 15/10/2026 11:30');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(print).toHaveBeenCalled();
  });

  it('a plain print does not record a reprint', async () => {
    const fixture = await render();
    http.expectOne(RECEIPT_URL).flush(receipt());
    await settle(fixture);
    expect(el(fixture).textContent).not.toContain('REIMPRESIÓN');
    http.expectNone('/api/v1/sales/sales/s1/receipt/reprint');
  });

  it('does not print when the reprint cannot be recorded', async () => {
    const fixture = await render({ reprint: '1' });
    http.expectOne(RECEIPT_URL).flush(receipt());
    http.expectOne({ method: 'POST', url: '/api/v1/sales/sales/s1/receipt/reprint' }).flush({ code: 'SALE_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(fixture);
    expect(el(fixture).querySelector('[role=alert]')).not.toBeNull();
    expect(print).not.toHaveBeenCalled();
  });
});
