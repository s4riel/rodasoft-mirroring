import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { QuoteDetail, QuoteEditorContext } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { QuoteDetailPage } from './quote-detail.page';

@Component({ template: '' })
class StubPage {}

const quote = (over: Partial<QuoteDetail> = {}): QuoteDetail => ({
  id: 'q1',
  number: 'COT-000001',
  status: 'DRAFT',
  customer: { id: 'c1', name: 'Ana Rojas', documentNumber: '1001' },
  createdAt: '2026-11-07T15:00:00.000Z',
  createdByName: 'Vendedor',
  validUntil: '2026-11-14',
  subtotal: '200.00',
  discountType: 'NONE',
  discountValue: '0.00',
  discountAmount: '0.00',
  roundingAmount: '0.00',
  total: '200.00',
  lines: [{ id: 'l1', productId: 'p1', sku: 'S1', code: 'ABC-1', name: 'Rodamiento', quantity: 2, unitPrice: '100.00', lineTotal: '200.00' }],
  order: null,
  convertible: true,
  ...over,
});
const context: QuoteEditorContext = {
  defaultValidUntil: '2026-11-14',
  validityDays: 7,
  roundingMode: 'NONE',
  warehouses: [{ id: 'w1', name: 'Central', isMain: true }],
};

describe('QuoteDetailPage', () => {
  let http: HttpTestingController;

  async function open(detail: QuoteDetail, granted = ['sales.quotes.manage', 'sales.orders.manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'quote/:id', component: QuoteDetailPage },
          { path: 'sales/orders/:id', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(granted)) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/quote/q1', QuoteDetailPage);
    http.expectOne('/api/v1/sales/quotes/q1').flush(detail);
    harness.detectChanges();
    return harness;
  }
  const text = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).textContent ?? '';
  afterEach(() => http.verify());

  it('shows the quote, its lines and the convert action', async () => {
    const h = await open(quote());
    expect(text(h)).toContain('COT-000001');
    expect(text(h)).toContain('ABC-1');
    expect(h.routeNativeElement?.querySelector('[data-testid="quote-convert"]')).not.toBeNull();
  });

  it('hides the convert action without permission or when not convertible', async () => {
    const without = await open(quote(), ['sales.quotes.manage']);
    expect(without.routeNativeElement?.querySelector('[data-testid="quote-convert"]')).toBeNull();
    TestBed.resetTestingModule();
    const expired = await open(quote({ status: 'EXPIRED', convertible: false }));
    expect(expired.routeNativeElement?.querySelector('[data-testid="quote-convert"]')).toBeNull();
    expect(text(expired)).toContain('La cotización venció');
  });

  it('converts into the chosen warehouse and goes to the order', async () => {
    const h = await open(quote());
    const router = TestBed.inject(Router);
    (h.routeNativeElement?.querySelector('[data-testid="quote-convert"]') as HTMLButtonElement).click();
    http.expectOne('/api/v1/sales/quotes/context').flush(context);
    h.detectChanges();
    (document.querySelector('[data-testid="quote-convert-confirm"]') as HTMLButtonElement).click();
    const request = http.expectOne('/api/v1/sales/quotes/q1/convert');
    expect(request.request.body).toEqual({ warehouseId: 'w1' });
    request.flush({ id: 'o1', number: 'PED-000001' });
    await h.fixture.whenStable();
    expect(router.url).toBe('/sales/orders/o1');
  });

  it('names the short products when the stock is not enough', async () => {
    const h = await open(quote());
    (h.routeNativeElement?.querySelector('[data-testid="quote-convert"]') as HTMLButtonElement).click();
    http.expectOne('/api/v1/sales/quotes/context').flush(context);
    h.detectChanges();
    (document.querySelector('[data-testid="quote-convert-confirm"]') as HTMLButtonElement).click();
    http
      .expectOne('/api/v1/sales/quotes/q1/convert')
      .flush(
        { code: 'INSUFFICIENT_STOCK', message: 'x', details: { items: [{ productId: 'p1', requested: 2, available: 1 }] } },
        { status: 409, statusText: 'Conflict' },
      );
    h.detectChanges();
    expect(document.body.textContent).toContain('ABC-1 · Rodamiento: pides 2, disponible 1');
  });
});
