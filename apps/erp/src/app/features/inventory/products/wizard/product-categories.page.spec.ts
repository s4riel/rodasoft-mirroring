import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ProductFilterOptions } from '@rodasoft/domain';
import { ProductCategoriesPage } from './product-categories.page';

const OPTIONS_URL = '/api/v1/inventory/filter-options';

const options = (categories: ProductFilterOptions['categories']): ProductFilterOptions => ({ countries: [], brands: [], categories });

const cats: ProductFilterOptions['categories'] = [
  { id: 'k-1', name: 'Rodamientos', icon: 'bearing', subcategories: [{ id: 'k-2', name: 'Rígidos de bolas' }] },
  { id: 'k-3', name: 'Retenes y sellos', icon: 'seal', subcategories: [] },
  { id: 'k-4', name: 'Correas y poleas', icon: 'pulley', subcategories: [] },
];

@Component({ template: '' })
class WizardStubPage {}

describe('ProductCategoriesPage', () => {
  let http: HttpTestingController;

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'new', component: ProductCategoriesPage },
          { path: 'inventory/products/new/:categoryId', component: WizardStubPage },
          { path: 'inventory/products', component: WizardStubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/new', ProductCategoriesPage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const cards = (h: RouterTestingHarness) => Array.from(root(h).querySelectorAll<HTMLElement>('rs-category-card'));
  const next = (h: RouterTestingHarness) => Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Continuar')) as HTMLButtonElement;

  it('shows one card per root category with its subcategory count', async () => {
    const h = await open();
    http.expectOne(OPTIONS_URL).flush(options(cats));
    h.detectChanges();

    expect(cards(h).map((c) => c.querySelector('.title')?.textContent?.trim())).toEqual(['Rodamientos', 'Retenes y sellos', 'Correas y poleas']);
    expect(cards(h)[0].querySelector('.description')?.textContent?.trim()).toBe('1 subcategoría');
    expect(cards(h)[1].querySelector('.description')?.textContent?.trim()).toBe('Sin subcategorías');
  });

  it('keeps "Continuar" disabled until a category is chosen', async () => {
    const h = await open();
    http.expectOne(OPTIONS_URL).flush(options(cats));
    h.detectChanges();
    expect(next(h).disabled).toBe(true);

    cards(h)[1].click();
    h.detectChanges();
    expect(cards(h)[1].getAttribute('aria-checked')).toBe('true');
    expect(next(h).disabled).toBe(false);
  });

  it('has one tab stop and moves between the cards with the arrow keys', async () => {
    const h = await open();
    http.expectOne(OPTIONS_URL).flush(options(cats));
    h.detectChanges();
    expect(cards(h).map((c) => c.getAttribute('tabindex'))).toEqual(['0', '-1', '-1']);

    cards(h)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    h.detectChanges();
    expect(cards(h)[1].getAttribute('aria-checked')).toBe('true');
    expect(cards(h).map((c) => c.getAttribute('tabindex'))).toEqual(['-1', '0', '-1']);
  });

  it('offers a way back when there are no categories', async () => {
    const h = await open();
    http.expectOne(OPTIONS_URL).flush(options([]));
    h.detectChanges();

    expect(root(h).textContent).toContain('Aún no hay categorías');
    expect(root(h).textContent).toContain('Volver a productos');
  });

  it('shows the error state and retries', async () => {
    const h = await open();
    http.expectOne(OPTIONS_URL).flush('boom', { status: 500, statusText: 'Server Error' });
    h.detectChanges();
    expect(root(h).textContent).toContain('No pudimos cargar las categorías');

    (Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar')) as HTMLButtonElement).click();
    http.expectOne(OPTIONS_URL).flush(options(cats));
    h.detectChanges();
    expect(cards(h)).toHaveLength(3);
  });
});
