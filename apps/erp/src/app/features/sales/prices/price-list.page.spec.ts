import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { PriceListResponse } from '@rodasoft/domain';
import { RowActionComponent, RS_PERMISSIONS, SelectComponent } from '@rodasoft/ui';
import { PriceListPage } from './price-list.page';
import { priceChange, priceDetail, priceList, priceRow } from './prices.testing';

const LIST_URL = '/api/v1/sales/prices';
const EDIT = 'sales.prices.edit';

/** VP-11 · Precios y descuentos (HU-VEN-26). */
describe('PriceListPage', () => {
  let http: HttpTestingController;

  async function open(url = '/prices', granted: string[] = [EDIT]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'prices', component: PriceListPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(granted)) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, PriceListPage);
    return harness;
  }

  const request = () => http.expectOne((r) => r.url === LIST_URL);
  const flushList = (body: PriceListResponse = priceList()) => request().flush(body);
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent?.replace(/\s+/g, ' ') ?? '';
  const bodyRows = (h: RouterTestingHarness) => Array.from(root(h).querySelectorAll('rs-doc-table tbody tr')).map((r) => r.textContent?.replace(/\s+/g, ' ') ?? '');
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows a skeleton while the list loads and asks for the first page', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    const req = request();
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('20');
    expect(req.request.params.has('q')).toBe(false);
    req.flush(priceList());
  });

  it('shows the title, the single-price subtitle and the KPIs', async () => {
    const h = await open();
    flushList();
    await settle(h);
    expect(text(h)).toContain('Precios y descuentos');
    expect(text(h)).toContain('Un solo precio de venta por producto y empresa.');
    const kpis = Array.from(root(h).querySelectorAll('rs-kpi-card')).map((k) => k.textContent?.replace(/\s+/g, ' ') ?? '');
    // without `inventory.costs.view` the API sends no margin and the card is not drawn
    expect(kpis).toHaveLength(3);
    expect(kpis[0]).toContain('Productos con precio');
    expect(kpis[0]).toContain('37');
    expect(kpis[0]).toContain('de 40 productos');
    expect(kpis[1]).toContain('Sin precio');
    expect(kpis[1]).toContain('3');
    expect(kpis[2]).toContain('Cambios este mes');
    expect(kpis[2]).toContain('5');
    expect(text(h)).not.toContain('Margen promedio');
  });

  it('shows the average margin only when the API sends it', async () => {
    const h = await open();
    flushList(priceList({ kpis: { products: 40, withPrice: 37, withoutPrice: 3, changesThisMonth: 5, averageMarginPercent: '38.5' } }));
    await settle(h);
    const margin = root(h).querySelector('[data-testid="prices-margin"]')?.textContent ?? '';
    expect(margin).toContain('Margen promedio');
    expect(margin).toContain('38,5 %');
  });

  it('lists code, product, last update, stock, price and status', async () => {
    const h = await open();
    flushList();
    await settle(h);
    for (const header of ['Código', 'Producto', 'Última actualización', 'En sucursal', 'Precio de venta', 'Estado']) expect(text(h)).toContain(header);
    const rows = bodyRows(h);
    expect(rows[0]).toContain('6205-2RS');
    expect(rows[0]).toContain('Rodamiento rígido de bolas');
    expect(rows[0]).toContain('SKF · Suecia');
    expect(rows[0]).toContain('14/10/2026 · Gabriela Gerente · +4,3 %');
    expect(rows[0]).toContain('12');
    expect(rows[0]).toContain('Bs 245,00');
    expect(rows[0]).toContain('Con precio');
    // a product without price, country, stock or history
    expect(rows[1]).toContain('6206-ZZ');
    expect(rows[1]).toContain('SKF');
    expect(rows[1]).not.toContain('Suecia');
    // no stock in the branch: the flag, with its label for screen readers
    expect(root(h).querySelectorAll('rs-doc-table tbody tr')[1].querySelector('rs-stock-flag')).not.toBeNull();
    expect(root(h).querySelectorAll('rs-doc-table tbody tr')[0].querySelector('rs-stock-flag')).toBeNull();
    expect(rows[1]).toContain('Sin precio');
    expect(rows[1]).not.toContain('Bs 0,00');
    expect(text(h)).toContain('1–2 de 2 productos');
  });

  it('names an imported list instead of the user in "Última actualización"', async () => {
    const h = await open();
    flushList(priceList({ items: [priceRow({ lastChange: priceChange({ source: 'IMPORT', percent: '-2.0' }) })], total: 1 }));
    await settle(h);
    expect(bodyRows(h)[0]).toContain('14/10/2026 · lista importada · −2,0 %');
  });

  it('sends the filters of the URL', async () => {
    await open('/prices?q=6205&brandId=b1&categoryId=c1&priced=without&page=2');
    const req = request();
    expect(req.request.params.get('q')).toBe('6205');
    expect(req.request.params.get('brandId')).toBe('b1');
    expect(req.request.params.get('categoryId')).toBe('c1');
    expect(req.request.params.get('priced')).toBe('without');
    expect(req.request.params.get('page')).toBe('2');
    req.flush(priceList());
  });

  it('filters "sin precio" back on the first page', async () => {
    const h = await open('/prices?page=3');
    flushList();
    await settle(h);
    const priced = h.fixture.debugElement.queryAll(By.directive(SelectComponent)).find((s) => (s.nativeElement as HTMLElement).dataset['testid'] === 'prices-priced')
      ?.componentInstance as SelectComponent;
    priced.value.set('without');
    await settle(h);
    const req = request();
    expect(req.request.params.get('priced')).toBe('without');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(priceList());
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/prices?priced=without');
  });

  it('searches after a short pause', async () => {
    const h = await open();
    flushList();
    await settle(h);
    const input = root(h).querySelector('rs-filter-bar-products input') as HTMLInputElement;
    input.value = '6206';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // nothing is asked while the user is still typing
    http.expectNone((r) => r.url === LIST_URL);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await settle(h);
    const req = request();
    expect(req.request.params.get('q')).toBe('6206');
    req.flush(priceList());
  });

  it('opens the dialog from "Editar precio" and reloads the list after a save', async () => {
    const h = await open();
    flushList();
    await settle(h);
    const menu = h.fixture.debugElement.query(By.directive(RowActionComponent)).componentInstance as RowActionComponent;
    expect(menu.items().map((i) => i.label)).toEqual(['Editar precio']);

    menu.selected.emit('edit');
    await settle(h);
    http.expectOne('/api/v1/sales/prices/p1').flush(priceDetail());
    await settle(h);
    expect(text(h)).toContain('Editar precio · 6205-2RS');

    const input = root(h).querySelector('#price-new') as HTMLInputElement;
    input.value = '255';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(h);
    (root(h).querySelector('[data-testid="price-save"]') as HTMLButtonElement).click();
    http.expectOne((r) => r.method === 'PATCH').flush(priceDetail({ salePrice: '255.00' }));
    await settle(h);

    // the list is read again, without the skeleton
    expect(root(h).querySelector('rs-doc-table')).not.toBeNull();
    flushList(priceList({ items: [priceRow({ salePrice: '255.00', lastChange: priceChange({ oldPrice: '245.00', newPrice: '255.00', percent: '4.1' }) })], total: 1 }));
    await settle(h);
    expect(bodyRows(h)[0]).toContain('Bs 255,00');
    expect(bodyRows(h)[0]).toContain('+4,1 %');
  });

  it('shows the empty state, and another one when the filters leave nothing', async () => {
    const empty = await open();
    flushList(priceList({ items: [], total: 0 }));
    await settle(empty);
    expect(text(empty)).toContain('Aún no hay productos');
    TestBed.resetTestingModule();

    const filtered = await open('/prices?priced=without');
    flushList(priceList({ items: [], total: 0 }));
    await settle(filtered);
    expect(text(filtered)).toContain('No encontramos productos');
    expect(text(filtered)).toContain('Limpiar filtros');
  });

  it('shows the error state with a retry, and the no-permission state', async () => {
    const h = await open();
    request().flush({ message: 'x' }, { status: 500, statusText: 'Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar los precios');
    (Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar')) as HTMLButtonElement).click();
    flushList();
    await settle(h);
    expect(bodyRows(h)).toHaveLength(2);
    TestBed.resetTestingModule();

    const forbidden = await open();
    request().flush({ code: 'NO_PERMISSION', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await settle(forbidden);
    expect(text(forbidden)).toContain('No tienes permiso para ver los precios');
    expect(root(forbidden).querySelector('rs-doc-table')).toBeNull();
  });
});
