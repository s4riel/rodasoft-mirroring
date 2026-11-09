import { DOCUMENT } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SalesOrderDetail } from '@rodasoft/domain';
import { OrderPrintPage } from './order-print.page';

const order = {
  id: 'o1',
  number: 'PED-000032',
  company: 'Rodalaser S.R.L.',
  createdAt: '2026-10-15T15:00:00.000Z',
  customer: { id: 'c1', name: 'Minera Demo Ltda.', documentNumber: '1001' },
  branchName: 'Sucursal central',
  warehouseName: 'Huayna Kapac',
  lines: [
    { id: 'l1', code: '6205-2RS', name: 'Rodamiento SKF', quantity: 12, dispatchedQuantity: 12, pendingQuantity: 0 },
    { id: 'l2', code: '6306-2RS', name: 'Rodamiento NSK', quantity: 6, dispatchedQuantity: 3, pendingQuantity: 3 },
  ],
} as unknown as SalesOrderDetail;

describe('OrderPrintPage', () => {
  let http: HttpTestingController;

  async function open() {
    jest.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'orders/:id/print', component: OrderPrintPage }]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/orders/o1/print', OrderPrintPage);
    return harness;
  }
  const el = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;

  afterEach(() => {
    http.verify();
    jest.useRealTimers();
  });

  it('draws the pieces still pending on the dispatch order and opens the print dialog', async () => {
    const h = await open();
    const print = jest.spyOn(TestBed.inject(DOCUMENT).defaultView as Window, 'print').mockImplementation(() => undefined);
    http.expectOne('/api/v1/sales/orders/o1').flush(order);
    h.detectChanges();
    const text = el(h).textContent ?? '';
    expect(text).toContain('Orden de despacho');
    expect(text).toContain('Rodalaser S.R.L.');
    expect(text).toContain('PED-000032');
    expect(text).toContain('6306-2RS');
    expect(text).not.toContain('6205-2RS');
    expect(text).toContain('Por despachar');
    jest.runAllTimers();
    expect(print).toHaveBeenCalled();
  });

  it('says so when the order cannot be loaded and offers to retry', async () => {
    const h = await open();
    http.expectOne('/api/v1/sales/orders/o1').flush({ code: 'SALES_ORDER_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    h.detectChanges();
    expect(el(h).textContent).toContain('No pudimos cargar el pedido');
    expect(el(h).textContent).toContain('Reintentar');
  });

  it('shows the no-permission state on a 403', async () => {
    const h = await open();
    http.expectOne('/api/v1/sales/orders/o1').flush({ message: 'x' }, { status: 403, statusText: 'Forbidden' });
    h.detectChanges();
    expect(el(h).textContent).toContain('No tienes permiso para ver este pedido');
  });
});
