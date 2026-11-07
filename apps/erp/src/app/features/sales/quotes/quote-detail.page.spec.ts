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
  lines: [{ id: 'l1', productId: 'p1', sku: 'S1', code: 'ABC-1', name: 'Rodamiento', quantity: 2, unitPrice: '100.00', lineTotal: '200.00', available: 5 }],
  order: null,
  convertible: true,
  customerEmail: 'ana@demo.test',
  customerPhone: '70000000',
  company: 'RODALASER',
  sendLog: [],
  timeline: [
    { key: 'DRAFT', state: 'current', date: '2026-11-07' },
    { key: 'SENT', state: 'pending', date: null },
    { key: 'WAITING', state: 'pending', date: null },
    { key: 'CONVERTED', state: 'pending', date: null },
  ],
  canSend: true,
  canRenew: false,
  canReject: false,
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
    const expired = await open(quote({ status: 'EXPIRED', convertible: false, canSend: false, canRenew: true, canReject: true }));
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

  describe('following the quote (HU-VEN-17, HU-VEN-18)', () => {
    const sentLog = [{ channel: 'EMAIL' as const, to: 'ana@demo.test', at: '2026-11-07T15:00:00.000Z', userId: 'u1', userName: 'Vendedor' }];
    const expiredQuote = () =>
      quote({
        status: 'EXPIRED',
        convertible: false,
        canSend: false,
        canRenew: true,
        canReject: true,
        sendLog: sentLog,
        timeline: [
          { key: 'DRAFT', state: 'done', date: '2026-11-01' },
          { key: 'SENT', state: 'done', date: '2026-11-01' },
          { key: 'EXPIRED', state: 'warning', date: '2026-11-07' },
          { key: 'CONVERTED', state: 'pending', date: null },
        ],
      });

    it('draws the timeline and the send log', async () => {
      const h = await open(quote({ status: 'SENT', sendLog: sentLog, timeline: expiredQuote().timeline }));
      expect(text(h)).toContain('Borrador');
      expect(text(h)).toContain('Vencida');
      expect(text(h)).toContain('Convertida');
      expect(text(h)).toContain('Correo');
      expect(text(h)).toContain('ana@demo.test');
    });

    it('offers "Enviar" on a draft and "Reenviar" once it was sent', async () => {
      const draft = await open(quote());
      expect(draft.routeNativeElement?.querySelector('[data-testid="quote-send"]')?.textContent).toContain('Enviar');
      expect(draft.routeNativeElement?.querySelector('[data-testid="quote-renew"]')).toBeNull();
      TestBed.resetTestingModule();
      const sent = await open(quote({ status: 'SENT', sendLog: sentLog }));
      expect(sent.routeNativeElement?.querySelector('[data-testid="quote-send"]')?.textContent).toContain('Reenviar');
    });

    it('an expired quote says so, offers renew and reject, and no sending', async () => {
      const h = await open(expiredQuote());
      expect(text(h)).toContain('La cotización venció');
      expect(h.routeNativeElement?.querySelector('[data-testid="quote-renew"]')).not.toBeNull();
      expect(h.routeNativeElement?.querySelector('[data-testid="quote-reject"]')).not.toBeNull();
      expect(h.routeNativeElement?.querySelector('[data-testid="quote-send"]')).toBeNull();
    });

    it('renews with the default validity and shows the renewed quote', async () => {
      const h = await open(expiredQuote());
      (h.routeNativeElement?.querySelector('[data-testid="quote-renew"]') as HTMLButtonElement).click();
      http.expectOne('/api/v1/sales/quotes/context').flush(context);
      h.detectChanges();
      (document.querySelector('[data-testid="quote-renew-confirm"]') as HTMLButtonElement).click();
      const request = http.expectOne('/api/v1/sales/quotes/q1/renew');
      expect(request.request.body).toEqual({ validUntil: '2026-11-14' });
      request.flush(quote({ status: 'SENT', validUntil: '2026-11-14', total: '240.00', canSend: true, canRenew: false, canReject: true }));
      h.detectChanges();
      expect(text(h)).not.toContain('La cotización venció');
      expect(text(h)).toContain('240,00');
    });

    it('shows the error when the renewal is refused', async () => {
      const h = await open(expiredQuote());
      (h.routeNativeElement?.querySelector('[data-testid="quote-renew"]') as HTMLButtonElement).click();
      http.expectOne('/api/v1/sales/quotes/context').flush(context);
      h.detectChanges();
      (document.querySelector('[data-testid="quote-renew-confirm"]') as HTMLButtonElement).click();
      http
        .expectOne('/api/v1/sales/quotes/q1/renew')
        .flush({ code: 'PRODUCT_INACTIVE', message: 'x' }, { status: 409, statusText: 'Conflict' });
      h.detectChanges();
      expect(document.body.textContent).toContain('No se pudo renovar');
    });

    it('rejects after confirming and hides every action', async () => {
      const h = await open(expiredQuote());
      (h.routeNativeElement?.querySelector('[data-testid="quote-reject"]') as HTMLButtonElement).click();
      h.detectChanges();
      (document.querySelector('[data-testid="quote-reject-confirm"]') as HTMLButtonElement).click();
      http.expectOne('/api/v1/sales/quotes/q1/reject').flush(quote({ status: 'REJECTED', canSend: false, canRenew: false, canReject: false, convertible: false }));
      h.detectChanges();
      expect(text(h)).toContain('Rechazada');
      expect(h.routeNativeElement?.querySelector('[data-testid="quote-reject"]')).toBeNull();
    });

    it('shows the four summary cards, with the expiry day in "Venció"', async () => {
      const ok = await open(quote());
      expect(text(ok)).toContain('Stock disponible');
      expect(text(ok)).toContain('Todo disponible');
      expect(text(ok)).toContain('en 1 producto');
      TestBed.resetTestingModule();
      const expired = await open(expiredQuote());
      expect(text(expired)).toContain('Venció');
    });

    it('marks a line without enough stock', async () => {
      const h = await open(quote({ lines: [{ ...quote().lines[0], available: 1 }] }));
      expect(text(h)).toContain('Sin existencia');
    });
  });
});
