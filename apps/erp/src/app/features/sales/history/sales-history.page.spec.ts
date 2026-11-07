import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SaleListItem, SaleListResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { SalesHistoryPage } from './sales-history.page';

const LIST_URL = '/api/v1/sales/sales';

const item = (over: Partial<SaleListItem> = {}): SaleListItem => ({
  id: 's1',
  number: 'V-000124',
  customerName: 'Industrias Demo S.A.',
  createdAt: '2026-10-14T14:24:00.000Z',
  itemsCount: 8,
  total: '1280.00',
  status: 'COMPLETED',
  invoiceStatus: 'PENDING',
  methods: ['CASH'],
  ...over,
});

const response = (items: SaleListItem[], over: Partial<SaleListResponse> = {}): SaleListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('SalesHistoryPage', () => {
  let http: HttpTestingController;

  async function open(url = '/history') {
    const permissions = new Set(['sales.pos.use']);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'history', component: SalesHistoryPage },
          { path: 'sales/history/:id', component: StubPage },
          { path: 'sales/pos', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, SalesHistoryPage);
    return harness;
  }

  const flushList = (body: SaleListResponse) => http.expectOne((r) => r.url === LIST_URL).flush(body);
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows a skeleton while the list loads', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    flushList(response([item()]));
  });

  it('lists number, customer, date, items, total and status, with a total row', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 's2', number: 'V-000123', customerName: 'Cliente mostrador', itemsCount: 2, total: '640.00', status: 'CANCELLED' })]));
    await settle(h);

    expect(text(h)).toContain('V-000124');
    expect(text(h)).toContain('Industrias Demo S.A.');
    expect(text(h)).toContain('14/10/2026 10:24');
    expect(text(h)).toContain('Bs 1.280,00');
    expect(text(h)).toContain('Pagada');
    expect(text(h)).toContain('Anulada');
    expect(text(h)).toContain('2 ventas');
    expect(text(h)).toContain('Bs 1.920,00');
    expect(text(h)).toContain('1–2 de 2 ventas');
  });

  it('links each number to the sale detail', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 's2', number: 'V-000123' })]));
    await settle(h);
    const links = Array.from(root(h).querySelectorAll<HTMLAnchorElement>('a.number')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/sales/history/s1', '/sales/history/s2']);
  });

  it('the row menu has only Ver venta and Reimprimir, and Ver venta opens the detail', async () => {
    const h = await open();
    flushList(response([item()]));
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('button[aria-label="Acciones de la venta V-000124"]')?.click();
    h.detectChanges();
    const menu = root(h).querySelector('rs-row-menu')?.textContent ?? '';
    expect(menu).toContain('Ver venta');
    expect(menu).toContain('Reimprimir');
    expect(menu).not.toContain('anulación');
    expect(menu).not.toContain('nota de crédito');
    root(h).querySelector<HTMLButtonElement>('rs-row-menu [role="menuitem"]')?.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/sales/history/s1');
  });

  it('Reimprimir opens the ticket in a new tab with the reprint flag', async () => {
    const h = await open();
    flushList(response([item()]));
    await settle(h);
    const opened = jest.spyOn(window, 'open').mockImplementation(() => null);
    root(h).querySelector<HTMLButtonElement>('button[aria-label="Acciones de la venta V-000124"]')?.click();
    h.detectChanges();
    root(h).querySelectorAll<HTMLButtonElement>('rs-row-menu [role="menuitem"]')[1].click();
    expect(opened).toHaveBeenCalledWith('/sales/receipts/s1/print?reprint=1', '_blank', 'noopener');
    opened.mockRestore();
  });

  it('reads the filters from the URL and sends them to the API', async () => {
    const h = await open('/history?status=CANCELLED&method=QR&from=2026-10-01&to=2026-10-31&q=V-0001&page=2');
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.get('status')).toBe('CANCELLED');
    expect(req.request.params.get('method')).toBe('QR');
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    expect(req.request.params.get('q')).toBe('V-0001');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush(response([item()], { total: 11, page: 2 }));
    await settle(h);
  });

  it('shows the first-use empty state with Nueva venta, and no filters', async () => {
    const h = await open();
    flushList(response([]));
    await settle(h);
    expect(text(h)).toContain('Aún no hay ventas');
    expect(text(h)).toContain('Nueva venta');
    expect(root(h).querySelector('rs-doc-table')).toBeNull();
  });

  it('shows a different empty state when the filters leave nothing, and Limpiar filtros clears them', async () => {
    const h = await open('/history?status=CANCELLED');
    flushList(response([]));
    await settle(h);
    expect(text(h)).toContain('No encontramos ventas');
    Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Limpiar filtros'))!.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/history');
    flushList(response([item()]));
  });

  it('shows an error with Reintentar', async () => {
    const h = await open();
    http.expectOne((r) => r.url === LIST_URL).flush({}, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(root(h).querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar las ventas');
    Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar'))!.click();
    flushList(response([item()]));
    await settle(h);
    expect(text(h)).toContain('V-000124');
  });

  it('says there is no permission on a 403', async () => {
    const h = await open();
    http.expectOne((r) => r.url === LIST_URL).flush({ code: 'NO_PERMISSION', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver las ventas');
  });

  it('Exportar reads every page and downloads a CSV', async () => {
    const h = await open();
    flushList(response([item()], { total: 1 }));
    await settle(h);
    const create = jest.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: jest.fn() });
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Exportar'))!.click();
    http.expectOne((r) => r.url === LIST_URL && r.params.get('pageSize') === '100').flush(response([item()], { total: 1 }));
    await settle(h);
    await h.fixture.whenStable();
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
  });
});
