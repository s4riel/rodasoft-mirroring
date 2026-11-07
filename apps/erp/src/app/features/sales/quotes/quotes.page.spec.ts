import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { QuoteListItem, QuoteListResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { QuotesPage } from './quotes.page';

@Component({ template: '' })
class StubPage {}

const item = (over: Partial<QuoteListItem> = {}): QuoteListItem => ({
  id: 'q1',
  number: 'COT-000001',
  customerName: 'Ana Rojas',
  createdAt: '2026-11-07T15:00:00.000Z',
  validUntil: '2026-11-14',
  itemsCount: 6,
  total: '302.00',
  status: 'DRAFT',
  orderNumber: null,
  ...over,
});
const response = (items: QuoteListItem[]): QuoteListResponse => ({ items, total: items.length, page: 1, pageSize: 10 });

describe('QuotesPage', () => {
  let http: HttpTestingController;

  async function open(url = '/quotes', granted = ['sales.quotes.manage', 'sales.orders.manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'quotes', component: QuotesPage },
          { path: 'sales/quotes/new', component: StubPage },
          { path: 'sales/quotes/:id', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(granted)) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, QuotesPage);
    return harness;
  }
  const flush = (h: RouterTestingHarness, body: QuoteListResponse) => {
    http.expectOne((r) => r.url === '/api/v1/sales/quotes').flush(body);
    h.detectChanges();
  };
  const text = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).textContent ?? '';
  afterEach(() => http.verify());

  it('shows a skeleton while loading, then the rows with their Spanish status', async () => {
    const h = await open();
    expect(h.routeNativeElement?.querySelector('[aria-busy="true"]')).not.toBeNull();
    flush(h, response([item(), item({ id: 'q2', number: 'COT-000002', status: 'EXPIRED' })]));
    expect(text(h)).toContain('COT-000001');
    expect(text(h)).toContain('Borrador');
    expect(text(h)).toContain('Vencida');
    expect(text(h)).toContain('14/11/2026');
    // the total row: two quotes, their units and amount
    expect(text(h)).toContain('2 cotizaciones');
  });

  it('builds the query from the URL filters', async () => {
    const h = await open('/quotes?status=SENT&q=ana&page=2');
    const request = http.expectOne((r) => r.url === '/api/v1/sales/quotes');
    expect(request.request.params.get('status')).toBe('SENT');
    expect(request.request.params.get('q')).toBe('ana');
    expect(request.request.params.get('page')).toBe('2');
    request.flush(response([item()]));
    h.detectChanges();
  });

  it('says there are no quotes yet, and differently when the filters leave none', async () => {
    const first = await open();
    flush(first, response([]));
    expect(text(first)).toContain('Aún no hay cotizaciones');
    TestBed.resetTestingModule();
    const filtered = await open('/quotes?status=SENT');
    flush(filtered, response([]));
    expect(text(filtered)).toContain('No encontramos cotizaciones');
    expect(text(filtered)).toContain('Limpiar filtros');
  });

  it('shows the error state with a retry, and the no-permission state on a 403', async () => {
    const failed = await open();
    http.expectOne((r) => r.url === '/api/v1/sales/quotes').flush({ code: 'X', message: 'boom' }, { status: 500, statusText: 'Error' });
    failed.detectChanges();
    expect(text(failed)).toContain('No pudimos cargar las cotizaciones');
    expect(text(failed)).toContain('Reintentar');
    TestBed.resetTestingModule();
    const denied = await open();
    http.expectOne((r) => r.url === '/api/v1/sales/quotes').flush({ code: 'FORBIDDEN', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    denied.detectChanges();
    expect(text(denied)).toContain('No tienes permiso para ver las cotizaciones');
  });

  it('offers "Nueva cotización" only to who manages quotes', async () => {
    const without = await open('/quotes', ['sales.orders.manage']);
    flush(without, response([item()]));
    expect(text(without)).not.toContain('Nueva cotización');
  });
});
