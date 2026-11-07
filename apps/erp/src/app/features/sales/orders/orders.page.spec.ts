import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SalesOrderListItem, SalesOrderListResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { OrdersPage } from './orders.page';

const item = (over: Partial<SalesOrderListItem> = {}): SalesOrderListItem => ({
  id: 'o1',
  number: 'PED-000001',
  customerName: 'Ana Rojas',
  quoteNumber: 'COT-000001',
  warehouseName: 'Central',
  createdAt: '2026-11-07T15:00:00.000Z',
  total: '200.00',
  status: 'OPEN',
  ...over,
});
const response = (items: SalesOrderListItem[]): SalesOrderListResponse => ({ items, total: items.length, page: 1, pageSize: 10 });

describe('OrdersPage', () => {
  let http: HttpTestingController;

  async function open(url = '/orders') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'orders', component: OrdersPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(['sales.orders.manage'])) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, OrdersPage);
    return harness;
  }
  const flush = (h: RouterTestingHarness, body: SalesOrderListResponse, init?: { status: number; statusText: string }) => {
    http.expectOne((r) => r.url === '/api/v1/sales/orders').flush(body, init);
    h.detectChanges();
  };
  const text = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).textContent ?? '';
  afterEach(() => http.verify());

  it('lists the orders with the quote, the warehouse and the Spanish status', async () => {
    const h = await open();
    expect(h.routeNativeElement?.querySelector('[aria-busy="true"]')).not.toBeNull();
    flush(h, response([item(), item({ id: 'o2', number: 'PED-000002', status: 'CANCELLED', quoteNumber: null })]));
    expect(text(h)).toContain('PED-000001');
    expect(text(h)).toContain('COT-000001');
    expect(text(h)).toContain('Central');
    expect(text(h)).toContain('Reservado');
    expect(text(h)).toContain('Anulado');
  });

  it('sends the status filter of the URL', async () => {
    const h = await open('/orders?status=CANCELLED');
    const request = http.expectOne((r) => r.url === '/api/v1/sales/orders');
    expect(request.request.params.get('status')).toBe('CANCELLED');
    request.flush(response([]));
    h.detectChanges();
    expect(text(h)).toContain('No encontramos pedidos');
  });

  it('explains that an order is born from a quote when there are none', async () => {
    const h = await open();
    flush(h, response([]));
    expect(text(h)).toContain('Aún no hay pedidos');
  });

  it('shows the error state and the no-permission state', async () => {
    const failed = await open();
    flush(failed, { items: [], total: 0, page: 1, pageSize: 10 }, { status: 500, statusText: 'Error' });
    expect(text(failed)).toContain('No pudimos cargar los pedidos');
    TestBed.resetTestingModule();
    const denied = await open();
    flush(denied, { items: [], total: 0, page: 1, pageSize: 10 }, { status: 403, statusText: 'Forbidden' });
    expect(text(denied)).toContain('No tienes permiso para ver los pedidos');
  });
});
