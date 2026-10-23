import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EquivalenceSuggestion, ProductDetail } from '@rodasoft/domain';
import { ProductCreatedPage } from './product-created.page';

const DETAIL_URL = '/api/v1/inventory/products/p1';
const SUGGESTIONS_URL = '/api/v1/inventory/products/p1/equivalence-suggestions';

const detail = {
  id: 'p1',
  sku: 'RL-000090',
  manufacturerCode: '6205-2RS',
  name: 'Rígidos de bolas SKF 6205-2RS',
  brand: { id: 'b-skf', name: 'SKF', logoUrl: null },
  category: { id: 'k1', name: 'Rodamientos', icon: 'bearing' },
  subcategory: { id: 'k2', name: 'Rígidos de bolas' },
  dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15', weight: null },
  pricing: { salePrice: '245.00' },
  specs: [],
} as unknown as ProductDetail;
const suggestion = (over: Partial<EquivalenceSuggestion> = {}): EquivalenceSuggestion => ({
  productId: 'p2',
  manufacturerCode: '6205-2RSR',
  brand: { id: 'b-ntn', name: 'NTN', logoUrl: null },
  kind: 'EXACT',
  differences: [],
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('ProductCreatedPage', () => {
  let http: HttpTestingController;

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'inventory/products/:id/created', component: ProductCreatedPage },
          { path: '**', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/inventory/products/p1/created', ProductCreatedPage);
    return harness;
  }

  const text = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).textContent ?? '';

  it('confirms the product with its SKU and lists the suggestions', async () => {
    const h = await open();
    http.expectOne(DETAIL_URL).flush(detail);
    http.expectOne(SUGGESTIONS_URL).flush({ items: [suggestion()] });
    h.detectChanges();

    expect(text(h)).toContain('RL-000090');
    expect(text(h)).toContain('6205-2RSR');
    expect(text(h)).toContain('NTN');
  });

  it('shows the illustrated empty state when there is nothing to link', async () => {
    const h = await open();
    http.expectOne(DETAIL_URL).flush(detail);
    http.expectOne(SUGGESTIONS_URL).flush({ items: [] });
    h.detectChanges();

    expect(text(h)).toContain('Sin equivalentes para vincular');
    expect((h.routeNativeElement as HTMLElement).querySelector('rs-empty-state-illustrated')).not.toBeNull();
  });

  it('links a suggestion and marks it as linked', async () => {
    const h = await open();
    http.expectOne(DETAIL_URL).flush(detail);
    http.expectOne(SUGGESTIONS_URL).flush({ items: [suggestion()] });
    h.detectChanges();

    (Array.from((h.routeNativeElement as HTMLElement).querySelectorAll('button')).find((b) => b.textContent?.includes('Vincular')) as HTMLButtonElement).click();
    const link = http.expectOne('/api/v1/inventory/equivalences');
    expect(link.request.body).toEqual({ productAId: 'p1', productBId: 'p2' });
    link.flush({ id: 'e1', productAId: 'p1', productBId: 'p2' });
    h.detectChanges();

    expect(text(h)).toContain('Vinculado');
  });

  it('links every pending suggestion with "Vincular equivalencias"', async () => {
    const h = await open();
    http.expectOne(DETAIL_URL).flush(detail);
    http.expectOne(SUGGESTIONS_URL).flush({ items: [suggestion(), suggestion({ productId: 'p3', manufacturerCode: '6205-DDU' })] });
    h.detectChanges();

    (Array.from((h.routeNativeElement as HTMLElement).querySelectorAll('button')).find((b) => b.textContent?.includes('Vincular equivalencias')) as HTMLButtonElement).click();
    const links = http.match('/api/v1/inventory/equivalences');
    expect(links.map((r) => r.request.body.productBId)).toEqual(['p2', 'p3']);
    links.forEach((r) => r.flush({ id: 'e', productAId: 'p1', productBId: r.request.body.productBId }));
    h.detectChanges();

    expect(text(h).match(/Vinculado/g)?.length).toBe(2);
  });

  it('shows an error with a retry when the suggestions cannot be loaded', async () => {
    const h = await open();
    http.expectOne(DETAIL_URL).flush(detail);
    http.expectOne(SUGGESTIONS_URL).flush('boom', { status: 500, statusText: 'Server Error' });
    h.detectChanges();

    expect(text(h)).toContain('No pudimos buscar equivalentes');
    (Array.from((h.routeNativeElement as HTMLElement).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar')) as HTMLButtonElement).click();
    http.expectOne(SUGGESTIONS_URL).flush({ items: [] });
  });
});
