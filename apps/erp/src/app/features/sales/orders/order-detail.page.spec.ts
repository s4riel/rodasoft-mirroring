import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SalesOrderDetail } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { OrderDetailPage } from './order-detail.page';

const order = (over: Partial<SalesOrderDetail> = {}): SalesOrderDetail => ({
  id: 'o1',
  number: 'PED-000001',
  status: 'OPEN',
  customer: { id: 'c1', name: 'Ana Rojas', documentNumber: '1001' },
  quote: { id: 'q1', number: 'COT-000001' },
  company: 'Rodalaser S.R.L.',
  branchName: 'Sucursal central',
  warehouseName: 'Central',
  createdAt: '2026-11-07T15:00:00.000Z',
  createdByName: 'Vendedor',
  cancelledAt: null,
  subtotal: '200.00',
  discountAmount: '0.00',
  roundingAmount: '0.00',
  total: '200.00',
  lines: [
    {
      id: 'l1',
      productId: 'p1',
      sku: 'S1',
      code: 'ABC-1',
      name: 'Rodamiento',
      quantity: 2,
      unitPrice: '100.00',
      lineTotal: '200.00',
      reservedQuantity: 2,
      dispatchedQuantity: 0,
      invoicedQuantity: 0,
      pendingQuantity: 2,
    },
  ],
  cancellable: true,
  dispatches: [],
  invoicedTotal: '0.00',
  timeline: [
    { key: 'created', state: 'done', at: '2026-11-07T15:00:00.000Z' },
    { key: 'reserved', state: 'done', at: '2026-11-07T15:00:00.000Z' },
    { key: 'dispatch', state: 'current', at: null },
    { key: 'invoiced', state: 'pending', at: null },
    { key: 'completed', state: 'pending', at: null },
  ],
  dispatchable: true,
  partialDispatchAllowed: true,
  roundingMode: 'NONE',
  ...over,
});

describe('OrderDetailPage', () => {
  let http: HttpTestingController;

  async function open(detail: SalesOrderDetail) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'order/:id', component: OrderDetailPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(['sales.orders.manage'])) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/order/o1', OrderDetailPage);
    http.expectOne('/api/v1/sales/orders/o1').flush(detail);
    harness.detectChanges();
    return harness;
  }
  const el = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  afterEach(() => http.verify());

  it('shows the reserved lines and the quote it came from', async () => {
    const h = await open(order());
    expect(el(h).textContent).toContain('PED-000001');
    expect(el(h).textContent).toContain('COT-000001');
    expect(el(h).textContent).toContain('reservado en Central');
  });

  it('asks for a reason before cancelling, then shows the order cancelled', async () => {
    const h = await open(order());
    (el(h).querySelector('[data-testid="order-cancel"]') as HTMLButtonElement).click();
    h.detectChanges();
    (document.querySelector('[data-testid="order-cancel-confirm"]') as HTMLButtonElement).click();
    h.detectChanges();
    expect(document.body.textContent).toContain('Escribe el motivo');

    const area = document.querySelector('#order-cancel-reason') as HTMLTextAreaElement;
    area.value = 'El cliente ya no lo necesita';
    area.dispatchEvent(new Event('input'));
    (document.querySelector('[data-testid="order-cancel-confirm"]') as HTMLButtonElement).click();
    const request = http.expectOne('/api/v1/sales/orders/o1/cancel');
    expect(request.request.body).toEqual({ reason: 'El cliente ya no lo necesita' });
    request.flush(order({ status: 'CANCELLED', cancellable: false, cancelledAt: '2026-11-08T10:00:00.000Z' }));
    h.detectChanges();
    expect(el(h).textContent).toContain('Anulado');
    expect(el(h).querySelector('[data-testid="order-cancel"]')).toBeNull();
  });

  it('offers no cancel on a cancelled order', async () => {
    const h = await open(order({ status: 'CANCELLED', cancellable: false, dispatchable: false }));
    expect(el(h).querySelector('[data-testid="order-cancel"]')).toBeNull();
    expect(el(h).querySelector('[data-testid="order-dispatch"]')).toBeNull();
  });

  it('shows the steps, the four figures and the status of each line (VP-19)', async () => {
    const h = await open(
      order({
        status: 'PARTIALLY_DISPATCHED',
        lines: [
          { ...order().lines[0], quantity: 12, reservedQuantity: 12, dispatchedQuantity: 9, invoicedQuantity: 9, pendingQuantity: 3, lineTotal: '1200.00' },
        ],
        invoicedTotal: '900.00',
        dispatches: [
          { id: 'd1', number: 'DSP-000001', createdAt: '2026-11-08T15:00:00.000Z', createdByName: 'Vendedor', pieces: 9, total: '900.00', saleId: 's1', saleNumber: 'V-000010' },
        ],
      }),
    );
    const text = el(h).textContent ?? '';
    expect(text).toContain('Despacho parcial');
    expect(text).toContain('3 de 12 piezas');
    expect(text).toContain('9 piezas');
    expect(text).toContain('Pendiente 3');
    expect(text).toContain('DSP-000001');
    expect(text).toContain('V-000010');
  });

  it('marks a line with nothing pending as ready', async () => {
    const h = await open(
      order({
        status: 'DISPATCHED',
        cancellable: false,
        dispatchable: false,
        lines: [{ ...order().lines[0], dispatchedQuantity: 2, invoicedQuantity: 2, pendingQuantity: 0 }],
      }),
    );
    expect(el(h).textContent).toContain('Listo');
  });

  it('offers to dispatch and print only while there is something to dispatch', async () => {
    const h = await open(order());
    expect(el(h).querySelector('[data-testid="order-dispatch"]')).not.toBeNull();
    expect(el(h).querySelector<HTMLAnchorElement>('[data-testid="order-print"]')?.getAttribute('href')).toBe('/sales/orders/o1/print');
  });

  it('hides the dispatch actions without sales.orders.manage', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'order/:id', component: OrderDetailPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set<string>()) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/order/o1', OrderDetailPage);
    http.expectOne('/api/v1/sales/orders/o1').flush(order());
    harness.detectChanges();
    expect(el(harness).querySelector('[data-testid="order-dispatch"]')).toBeNull();
    expect(el(harness).querySelector('[data-testid="order-print"]')).toBeNull();
  });

  it('dispatches from the dialog and shows the order as it is left', async () => {
    const h = await open(order());
    (el(h).querySelector('[data-testid="order-dispatch"]') as HTMLButtonElement).click();
    h.detectChanges();
    (document.querySelector('[data-testid="dispatch-send"]') as HTMLButtonElement).click();
    const request = http.expectOne('/api/v1/sales/orders/o1/dispatches');
    expect(request.request.body).toEqual({ items: [{ orderItemId: 'l1', quantity: 2 }] });
    expect(request.request.headers.get('Idempotency-Key')).toBeTruthy();
    request.flush(order({ status: 'DISPATCHED', cancellable: false, dispatchable: false, invoicedTotal: '200.00' }));
    h.detectChanges();
    expect(el(h).querySelector('[data-testid="order-dispatch"]')).toBeNull();
    expect(document.body.textContent).toContain('despachado y facturado por completo');
  });
});
