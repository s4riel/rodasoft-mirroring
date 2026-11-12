import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CustomerSummary, QuoteEditorContext, QuoteProductResult } from '@rodasoft/domain';
import { QuoteFormPage } from './quote-form.page';

@Component({ template: '' })
class StubPage {}

const context: QuoteEditorContext = {
  defaultValidUntil: '2026-11-14',
  validityDays: 7,
  roundingMode: 'NONE',
  warehouses: [{ id: 'w1', name: 'Central', isMain: true }],
};
const customer = {
  id: 'c1',
  name: 'Ana Rojas',
  documentType: 1,
  documentNumber: '1001',
  complement: null,
  email: null,
  phone: null,
  creditEnabled: false,
  discount: { type: 'PERCENT', value: '10.00' },
  status: 'ACTIVE',
} as CustomerSummary;
const product: QuoteProductResult = { id: 'p1', sku: 'S1', code: 'ABC-1', name: 'Rodamiento', brandName: 'SKF', salePrice: '100.00', available: 7, spec: { measures: { innerDiameter: '25', outerDiameter: '52', width: '15' }, category: 'Rodamientos', subcategory: 'Rígidos de bolas', details: ['Sello: 2RS'] } };

describe('QuoteFormPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  const el = () => harness.routeNativeElement as HTMLElement;
  const type = (selector: string, value: string) => {
    const input = el().querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'quote', component: QuoteFormPage },
          { path: 'sales/quotes/:id', component: StubPage },
          { path: 'sales/quotes', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/quote', QuoteFormPage);
  });
  afterEach(() => {
    jest.useRealTimers();
    http.verify();
  });

  it('shows a skeleton until the context arrives, and the default validity', () => {
    expect(el().querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne('/api/v1/sales/quotes/context').flush(context);
    harness.detectChanges();
    expect((el().querySelector('#quote-valid') as HTMLInputElement).value).toBe('2026-11-14');
    expect(el().textContent).toContain('Por defecto 7 días.');
  });

  it('shows the no-permission state on a 403', () => {
    http.expectOne('/api/v1/sales/quotes/context').flush({ code: 'FORBIDDEN', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    harness.detectChanges();
    expect(el().textContent).toContain('No tienes permiso para crear cotizaciones');
  });

  it('asks for a customer and a product before saving', () => {
    http.expectOne('/api/v1/sales/quotes/context').flush(context);
    harness.detectChanges();
    (el().querySelector('[data-testid="quote-save"]') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(el().textContent).toContain('Elige un cliente.');
    expect(el().textContent).toContain('Agrega al menos un producto.');
  });

  it('adds a searched product with Enter, previews the total with the customer discount and saves', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    http.expectOne('/api/v1/sales/quotes/context').flush(context);
    harness.detectChanges();

    type('#quote-customer', 'ana');
    jest.advanceTimersByTime(300);
    http.expectOne((r) => r.url === '/api/v1/sales/quotes/customers').flush({ items: [customer] });
    harness.detectChanges();
    (el().querySelector('.results .result') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(el().textContent).toContain('Ana Rojas');

    type('#quote-product', 'ABC');
    jest.advanceTimersByTime(300);
    const search = http.expectOne((r) => r.url === '/api/v1/sales/quotes/product-search');
    expect(search.request.params.get('warehouseId')).toBe('w1');
    search.flush({ items: [product] });
    harness.detectChanges();
    (el().querySelector('#quote-product') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    harness.detectChanges();
    expect(el().querySelector('[data-testid="quote-lines-title"]')?.textContent).toContain('Ítems de la cotización (1)');
    // 100.00 − 10 % of the customer
    expect(el().querySelector('[data-testid="quote-total"]')?.textContent).toContain('90,00');

    (el().querySelector('[data-testid="quote-save"]') as HTMLButtonElement).click();
    const create = http.expectOne('/api/v1/sales/quotes');
    expect(create.request.body).toEqual({ customerId: 'c1', validUntil: '2026-11-14', lines: [{ productId: 'p1', quantity: 1 }] });
    create.flush({ id: 'q1', number: 'COT-000001' });
    jest.useRealTimers();
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/sales/quotes/q1');
  });

  describe('the items list (HU-VEN-33, HU-VEN-36)', () => {
    const second: QuoteProductResult = { ...product, id: 'p2', sku: 'S2', code: 'XYZ-2', salePrice: '50.00', available: 0, spec: { ...product.spec, measures: null, subcategory: null, details: [] } };

    /** Picks the customer and adds the products in order, each one searched and added with Enter. */
    function fill(products: QuoteProductResult[]) {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
      http.expectOne('/api/v1/sales/quotes/context').flush(context);
      harness.detectChanges();
      type('#quote-customer', 'ana');
      jest.advanceTimersByTime(300);
      http.expectOne((r) => r.url === '/api/v1/sales/quotes/customers').flush({ items: [customer] });
      harness.detectChanges();
      (el().querySelector('.results .result') as HTMLButtonElement).click();
      harness.detectChanges();
      for (const p of products) {
        type('#quote-product', p.code);
        jest.advanceTimersByTime(300);
        http.expectOne((r) => r.url === '/api/v1/sales/quotes/product-search').flush({ items: [p] });
        harness.detectChanges();
        (el().querySelector('#quote-product') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        harness.detectChanges();
      }
    }

    const lineRows = () => Array.from(el().querySelectorAll<HTMLElement>('[data-testid="quote-lines"] > li'));
    const press = (button: Element, key: string) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      harness.detectChanges();
      return event;
    };

    it('draws a drag handle with its accessible name on each line', () => {
      fill([product, second]);
      expect(lineRows()).toHaveLength(2);
      const handles = lineRows().map((row) => row.querySelector('rs-drag-handle button')?.getAttribute('aria-label'));
      expect(handles).toEqual(['Arrastrar ABC-1', 'Arrastrar XYZ-2']);
    });

    it('writes the price, the measures and type under each line, and "Sin existencia" when there is no stock', () => {
      fill([product, second]);
      const [first, short] = lineRows().map((row) => row.querySelector('.unit')?.textContent ?? '');
      expect(first).toContain('c/u');
      expect(first).toContain('25 × 52 × 15 mm · Rodamientos · Rígidos de bolas · Sello: 2RS');
      expect(first).not.toContain('Sin existencia');
      expect(short).toContain('Rodamientos');
      expect(short).toContain('Sin existencia');
    });

    it('reorders with the arrow keys on the handle and saves the lines in that order', () => {
      fill([product, second]);
      press(lineRows()[1].querySelector('rs-drag-handle button') as Element, 'ArrowUp');
      expect(lineRows().map((row) => row.querySelector('.title')?.textContent)).toEqual(['XYZ-2 · SKF', 'ABC-1 · SKF']);
      // the first line cannot go further up
      press(lineRows()[0].querySelector('rs-drag-handle button') as Element, 'ArrowUp');
      expect(lineRows().map((row) => row.querySelector('.title')?.textContent)).toEqual(['XYZ-2 · SKF', 'ABC-1 · SKF']);

      (el().querySelector('[data-testid="quote-save"]') as HTMLButtonElement).click();
      const create = http.expectOne('/api/v1/sales/quotes');
      expect(create.request.body.lines).toEqual([
        { productId: 'p2', quantity: 1 },
        { productId: 'p1', quantity: 1 },
      ]);
      create.flush({ id: 'q1', number: 'COT-000001' });
    });
  });
});
