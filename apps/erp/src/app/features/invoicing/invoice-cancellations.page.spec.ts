import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { InvoiceCancellationItem } from '@rodasoft/domain';
import { InvoiceCancellationsPage } from './invoice-cancellations.page';

const URL = '/api/v1/invoicing/cancellations';

const item = (over: Partial<InvoiceCancellationItem> = {}): InvoiceCancellationItem => ({
  saleId: 's1',
  saleNumber: 'V-000124',
  invoiceId: 'i1',
  invoiceNumber: 12,
  invoiceStatus: 'VALID',
  customerName: 'Industrias Demo S.A.',
  total: '1280.00',
  reason: 'SIN_3',
  comment: 'Datos de otro cliente',
  requestedBy: 'Ana Cajera',
  requestedAt: '2026-11-12T14:24:00.000Z',
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('InvoiceCancellationsPage (FS-18)', () => {
  let http: HttpTestingController;

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'invoicing/cancellations', component: InvoiceCancellationsPage },
          { path: 'invoicing', component: StubPage },
          { path: 'invoicing/invoices/:id', component: StubPage },
          { path: 'sales/history/:id/cancellation', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/cancellations', InvoiceCancellationsPage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows a skeleton while it loads', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(URL).flush({ items: [] });
  });

  it('lists each request with the invoice, customer, SIN reason, who asked, date and total', async () => {
    const h = await open();
    http.expectOne(URL).flush({ items: [item(), item({ saleId: 's2', invoiceId: 'i2', invoiceNumber: 13, reason: 'CUSTOMER_DATA_ERROR' })] });
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(text).toContain('000012');
    expect(text).toContain('Industrias Demo S.A.');
    expect(text).toContain('Datos de emisión incorrectos');
    expect(text).toContain('Error en datos del cliente');
    expect(text).toContain('Ana Cajera');
    expect(text).toContain('12/11/2026 10:24');
    expect(text).toContain('Bs 1.280,00');
  });

  it('links the invoice to its detail and "Revisar" to the review of the sale', async () => {
    const h = await open();
    http.expectOne(URL).flush({ items: [item()] });
    await settle(h);
    expect(root(h).querySelector('a.number')?.getAttribute('href')).toBe('/invoicing/invoices/i1');
    expect(root(h).querySelector('a.review')?.getAttribute('href')).toBe('/sales/history/s1/cancellation');
  });

  it('says there is nothing to approve', async () => {
    const h = await open();
    http.expectOne(URL).flush({ items: [] });
    await settle(h);
    expect(root(h).textContent).toContain('No hay anulaciones por aprobar');
  });

  it('shows the error state with a retry and the no-permission state on 403', async () => {
    const h = await open();
    http.expectOne(URL).flush({ code: 'INTERNAL', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(root(h).textContent).toContain('No pudimos cargar las anulaciones');
    Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Reintentar'))?.click();
    http.expectOne(URL).flush({ code: 'NO_PERMISSION', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(root(h).textContent).toContain('No tienes permiso para ver las anulaciones');
  });
});
