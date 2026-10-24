import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ProductFilterOptions, ProductListItem, ProductListResponse } from '@rodasoft/domain';
import { ALL_BRANCHES, RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { ProductsPage } from './products.page';

const LIST_URL = '/api/v1/inventory/products';
const OPTIONS_URL = '/api/v1/inventory/filter-options';

const options: ProductFilterOptions = {
  countries: [{ id: 'c-jp', code: 'JP', name: 'Japón' }],
  brands: [{ id: 'b-nsk', name: 'NSK', logoUrl: null, countryId: 'c-jp' }],
  categories: [{ id: 'k-1', name: 'Rodamientos', icon: 'circle', subcategories: [{ id: 'k-2', name: 'Rígidos de bolas' }] }],
};

const item = (over: Partial<ProductListItem> = {}): ProductListItem => ({
  id: 'p1',
  sku: 'RL-000001',
  manufacturerCode: '6205-2RS',
  name: 'Rodamiento rígido',
  photoUrl: null,
  brand: { id: 'b-skf', name: 'SKF', logoUrl: null },
  country: { id: 'c-se', code: 'SE', name: 'Suecia' },
  category: { id: 'k-1', name: 'Rodamientos', icon: 'bearing' },
  subcategory: { id: 'k-2', name: 'Rígidos de bolas' },
  dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15' },
  specs: [],
  totalStock: 60,
  branchStock: 24,
  salePrice: '245.00',
  status: 'ACTIVE',
  ...over,
});

const response = (items: ProductListItem[], over: Partial<ProductListResponse> = {}): ProductListResponse => ({
  items,
  page: 1,
  pageSize: 10,
  total: items.length,
  catalogEmpty: false,
  ...over,
});

@Component({ template: '' })
class SheetStubPage {}

describe('ProductsPage', () => {
  let http: HttpTestingController;
  let permissions: Set<string>;
  let branchId: ReturnType<typeof signal<string>>;

  async function open(url = '/products', granted = ['inventory.products.view', 'inventory.products.import','inventory.products.export', 'inventory.products.edit']) {
    permissions = new Set(granted);
    branchId = signal('branch-1');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'products', component: ProductsPage },
          { path: 'inventory/products/:id', component: SheetStubPage },
          { path: 'inventory/products/:id/edit', component: SheetStubPage },
          { path: 'inventory/products/:id/draft', component: SheetStubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), branchId } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, ProductsPage);
    return harness;
  }

  const flushList = (body: ProductListResponse) => http.expectOne((r) => r.url === LIST_URL).flush(body);
  const flushOptions = () => http.expectOne(OPTIONS_URL).flush(options);
  const text = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).textContent ?? '';

  afterEach(() => http.verify());

  it('lists products with the selected branch and shows the actions the role can use', async () => {
    const h = await open('/products?brandId=b-nsk&page=2');
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.get('branchId')).toBe('branch-1');
    expect(req.request.params.get('brandId')).toBe('b-nsk');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush(response([item(), item({ id: 'p2', manufacturerCode: '30208', branchStock: 0 })], { total: 25 }));
    flushOptions();
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();

    const t = text(h);
    expect(t).toContain('6205-2RS');
    expect(t).toContain('245,00');
    expect(t).toContain('Agotado');
    expect(t).toContain('Importar');
    expect(t).toContain('Exportar');
    expect(t).toContain('Nuevo producto');
    expect(t).toContain('11–12 de 25 registros');
    expect(t).toContain('Subtotal');
  });

  it('hides header actions the role does not have', async () => {
    const h = await open('/products', ['inventory.products.view']);
    flushList(response([item()]));
    flushOptions();
    h.detectChanges();
    const t = text(h);
    expect(t).not.toContain('Importar');
    expect(t).not.toContain('Exportar');
    expect(t).not.toContain('Nuevo producto');
  });

  it('does not request anything and shows the no-permission state without inventory.products.view', async () => {
    const h = await open('/products', []);
    h.detectChanges();
    expect(text(h)).toContain('No tienes permiso para ver productos');
  });

  it('shows the empty catalog state on first use', async () => {
    const h = await open();
    flushList(response([], { catalogEmpty: true }));
    flushOptions();
    h.detectChanges();
    expect(text(h)).toContain('Tu catálogo está vacío');
  });

  it('shows "no results" and clears the filters', async () => {
    const h = await open('/products?brandId=b-nsk');
    flushList(response([]));
    flushOptions();
    h.detectChanges();
    expect(text(h)).toContain('No encontramos productos');

    const button = Array.from((h.routeNativeElement as HTMLElement).querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Limpiar filtros',
    ) as HTMLButtonElement;
    button.click();
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/products');
    flushList(response([item()]));
  });

  it('shows applied filters as chips and removes one with the ✕', async () => {
    const h = await open('/products?brandId=b-nsk&countryId=c-jp');
    flushList(response([item()]));
    flushOptions();
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();

    const chips = (h.routeNativeElement as HTMLElement).querySelectorAll('rs-filter-chip');
    expect(chips).toHaveLength(2);
    expect(text(h)).toContain('Japón');
    expect(text(h)).toContain('NSK');
    expect(text(h)).toContain('Limpiar todo');

    (chips[1].querySelector('button') as HTMLButtonElement).click();
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/products?countryId=c-jp');
    const next = http.expectOne((r) => r.url === LIST_URL);
    expect(next.request.params.has('brandId')).toBe(false);
    next.flush(response([item()]));
  });

  it('does not send a branch when all branches are selected', async () => {
    permissions = new Set(['inventory.products.view']);
    const h = await open();
    flushList(response([item({ branchStock: 24 })]));
    flushOptions();
    branchId.set(ALL_BRANCHES);
    h.detectChanges();
    await h.fixture.whenStable();
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.has('branchId')).toBe(false);
    req.flush(response([item({ branchStock: null })]));
  });

  it('shows the error state and retries', async () => {
    const h = await open();
    http.expectOne((r) => r.url === LIST_URL).flush({ code: 'INTERNAL', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    flushOptions();
    h.detectChanges();
    expect(text(h)).toContain('No pudimos cargar los productos');

    const retry = Array.from((h.routeNativeElement as HTMLElement).querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Reintentar',
    ) as HTMLButtonElement;
    retry.click();
    flushList(response([item()]));
    h.detectChanges();
    expect(text(h)).toContain('6205-2RS');
  });

  describe('row actions (HU-INV-02)', () => {
    const VIEW = ['inventory.products.view'];
    const el = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;

    async function openMenu(granted: string[]) {
      const h = await open('/products', granted);
      flushList(response([item()]));
      flushOptions();
      h.detectChanges();
      await h.fixture.whenStable();
      h.detectChanges();
      (el(h).querySelector('[data-kebab]') as HTMLButtonElement).click();
      h.detectChanges();
      return h;
    }
    const menuLabels = (h: RouterTestingHarness) =>
      Array.from(el(h).querySelectorAll('rs-row-menu button')).map((b) => b.textContent?.trim());
    const choose = async (h: RouterTestingHarness, label: string) => {
      const button = Array.from(el(h).querySelectorAll('rs-row-menu button')).find((b) =>
        b.textContent?.includes(label),
      ) as HTMLButtonElement;
      button.click();
      h.detectChanges();
      await h.fixture.whenStable();
      h.detectChanges();
    };

    it('offers each action only to the roles that have its permission', async () => {
      expect(menuLabels(await openMenu(VIEW))).toEqual(['Ver detalles']);
      TestBed.resetTestingModule();
      expect(menuLabels(await openMenu([...VIEW, 'inventory.products.edit']))).toEqual([
        'Ver detalles',
        'Editar',
        'Duplicar',
      ]);
      TestBed.resetTestingModule();
      expect(
        menuLabels(await openMenu([...VIEW, 'inventory.products.edit', 'inventory.adjustments.create', 'inventory.products.delete'])),
      ).toEqual(['Ver detalles', 'Editar', 'Duplicar', 'Ajustar stock', 'Eliminar']);
    });

    it('shows the coming-soon toast for Ajustar stock', async () => {
      const h = await openMenu([...VIEW, 'inventory.products.edit', 'inventory.adjustments.create']);
      await choose(h, 'Ajustar stock');
      expect(text(h)).toContain('Esta acción estará disponible próximamente.');
      expect(el(h).querySelector('rs-duplicate-product-dialog [role=dialog]')).toBeNull();
    });

    it('opens the edit wizard from Editar', async () => {
      const h = await openMenu([...VIEW, 'inventory.products.edit']);
      await choose(h, 'Editar');
      expect(TestBed.inject(Router).url).toBe('/inventory/products/p1/edit');
    });

    it('opens the product sheet from Ver detalles', async () => {
      const h = await openMenu(VIEW);
      await choose(h, 'Ver detalles');
      expect(TestBed.inject(Router).url).toBe('/inventory/products/p1');
    });

    it('opens the duplicate dialog for the chosen row', async () => {
      const h = await openMenu([...VIEW, 'inventory.products.edit']);
      await choose(h, 'Duplicar');
      const dialog = el(h).querySelector('rs-duplicate-product-dialog [role=dialog]');
      expect(dialog?.textContent).toContain('Crea una copia de 6205-2RS · SKF');
    });

    it('opens the copy after duplicating', async () => {
      const h = await openMenu([...VIEW, 'inventory.products.edit']);
      await choose(h, 'Duplicar');
      const input = el(h).querySelector('#duplicate-code') as HTMLInputElement;
      input.value = '6205-2RS-B';
      input.dispatchEvent(new Event('input'));
      (el(h).querySelector('button[type=submit]') as HTMLButtonElement).click();
      await h.fixture.whenStable();
      http.expectOne('/api/v1/inventory/products/p1/duplicate').flush({ id: 'p2', sku: 'RL-000002', status: 'ACTIVE' });
      await h.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/inventory/products/p2/edit');
    });

    it('asks for confirmation, deletes and reloads', async () => {
      const h = await openMenu([...VIEW, 'inventory.products.delete']);
      await choose(h, 'Eliminar');
      expect(text(h)).toContain('¿Eliminar 6205-2RS?');
      http.expectNone('/api/v1/inventory/products/p1');

      const confirm = Array.from(el(h).querySelectorAll('[role=dialog] button')).find(
        (b) => b.textContent?.trim() === 'Eliminar',
      ) as HTMLButtonElement;
      confirm.click();
      await h.fixture.whenStable();
      const req = http.expectOne('/api/v1/inventory/products/p1');
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
      await h.fixture.whenStable();
      flushList(response([], { catalogEmpty: true }));
      h.detectChanges();
      expect(text(h)).toContain('Producto eliminado: 6205-2RS');
    });

    it('explains that a product with stock cannot be deleted', async () => {
      const h = await openMenu([...VIEW, 'inventory.products.delete']);
      await choose(h, 'Eliminar');
      const confirm = Array.from(el(h).querySelectorAll('[role=dialog] button')).find(
        (b) => b.textContent?.trim() === 'Eliminar',
      ) as HTMLButtonElement;
      confirm.click();
      await h.fixture.whenStable();
      http
        .expectOne('/api/v1/inventory/products/p1')
        .flush({ code: 'PRODUCT_HAS_STOCK', message: 'has stock' }, { status: 409, statusText: 'Conflict' });
      await h.fixture.whenStable();
      h.detectChanges();
      expect(text(h)).toContain('No se puede eliminar: tiene stock registrado. Desactívalo en su lugar.');
    });
  });
});
