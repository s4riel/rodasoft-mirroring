import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EMPTY_SALES_LINE_SPEC, type SalesOrderDetail, type SalesOrderLineDetail } from '@rodasoft/domain';
import { DispatchOrderDialog } from './dispatch-order.dialog';

const line = (id: string, code: string, quantity: number, unitPrice: string, over: Partial<SalesOrderLineDetail> = {}): SalesOrderLineDetail => ({
  id,
  productId: 'p-' + id,
  sku: code,
  code,
  name: 'Rodamiento ' + code,
  quantity,
  unitPrice,
  lineTotal: (quantity * Number(unitPrice)).toFixed(2),
  reservedQuantity: quantity,
  dispatchedQuantity: 0,
  invoicedQuantity: 0,
  pendingQuantity: quantity,
  spec: EMPTY_SALES_LINE_SPEC,
  ...over,
});

const order = (over: Partial<SalesOrderDetail> = {}): SalesOrderDetail =>
  ({
    id: 'o1',
    number: 'PED-000032',
    status: 'OPEN',
    subtotal: '600.00',
    discountAmount: '0.00',
    roundingAmount: '0.00',
    total: '600.00',
    lines: [line('a', '6205-2RS', 6, '50.00'), line('b', '6306-2RS', 3, '100.00')],
    dispatches: [],
    invoicedTotal: '0.00',
    dispatchable: true,
    partialDispatchAllowed: true,
    roundingMode: 'NONE',
    ...over,
  }) as SalesOrderDetail;

describe('DispatchOrderDialog', () => {
  let http: HttpTestingController;

  async function render(detail: SalesOrderDetail = order()) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(DispatchOrderDialog);
    fixture.componentRef.setInput('order', detail);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const send = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="dispatch-send"]')!;
  const total = (f: Fixture) => el(f).querySelector('[data-testid="dispatch-total"]')!.textContent?.trim();
  /** Presses "Quitar una pieza" of a line `times` times. */
  const remove = (f: Fixture, lineId: string, times: number) => {
    const row = el(f).querySelector(`[data-testid="dispatch-line-${lineId}"]`)!;
    const button = row.querySelector<HTMLButtonElement>('button[aria-label="Quitar una pieza"]')!;
    for (let i = 0; i < times; i++) button.click();
    f.detectChanges();
  };

  afterEach(() => http.verify());

  it('starts with everything that is reserved and says how much is invoiced now', async () => {
    const f = await render();
    const text = el(f).textContent ?? '';
    expect(text).toContain('PED-000032 · elige cuánto se entrega hoy');
    expect(text).toContain('6 reservadas');
    expect(text).toContain('Se factura ahora (9 piezas)');
    expect(total(f)).toContain('600,00');
    expect(el(f).querySelector('[data-testid="dispatch-remaining"]')).toBeNull();
  });

  it('lowers a line, updates the invoice total and says the rest stays on the order', async () => {
    const f = await render();
    remove(f, 'a', 2);
    expect(el(f).textContent).toContain('Se factura ahora (7 piezas)');
    expect(total(f)).toContain('500,00');
    expect(el(f).querySelector('[data-testid="dispatch-remaining"]')?.textContent).toContain('Las 2 piezas faltantes quedan en el pedido');
  });

  it('cannot go above what is reserved and not dispatched', async () => {
    const f = await render(order({ lines: [line('a', 'X', 6, '50.00', { dispatchedQuantity: 4, invoicedQuantity: 4, pendingQuantity: 2 })] }));
    expect(el(f).textContent).toContain('2 reservadas');
    expect(el(f).textContent).toContain('Se factura ahora (2 piezas)');
  });

  it('only lists the lines that still have pieces to give', async () => {
    const f = await render(
      order({
        lines: [
          line('a', 'DONE-1', 2, '10.00', { dispatchedQuantity: 2, invoicedQuantity: 2, pendingQuantity: 0 }),
          line('b', 'OPEN-1', 3, '10.00'),
        ],
      }),
    );
    expect(el(f).textContent).not.toContain('DONE-1');
    expect(el(f).textContent).toContain('OPEN-1');
  });

  it('cannot send with nothing chosen', async () => {
    const f = await render(order({ lines: [line('a', 'X', 1, '50.00')] }));
    remove(f, 'a', 1);
    expect(send(f).disabled).toBe(true);
    expect(el(f).textContent).toContain('Se factura ahora (0 piezas)');
  });

  it('the dispatch that finishes the order invoices what is left of the total, not a new share', async () => {
    const f = await render(
      order({
        total: '600.00',
        invoicedTotal: '350.00',
        lines: [line('a', 'X', 6, '50.00', { dispatchedQuantity: 4, invoicedQuantity: 4, pendingQuantity: 2 })],
      }),
    );
    expect(total(f)).toContain('250,00');
  });

  it('previews the total of a part with the rounding mode of the company', async () => {
    const f = await render(order({ subtotal: '100.00', total: '100.00', roundingMode: 'INTEGER', lines: [line('a', 'X', 10, '10.30')] }));
    remove(f, 'a', 9);
    expect(total(f)).toContain('10,00');
  });

  it('with partial dispatch off the steppers are locked and the note says so', async () => {
    const f = await render(order({ partialDispatchAllowed: false }));
    const buttons = Array.from(el(f).querySelectorAll<HTMLButtonElement>('[data-testid^="dispatch-line-"] button'));
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(el(f).textContent).toContain('Esta empresa despacha el pedido completo');
    expect(el(f).textContent).toContain('Se factura ahora (9 piezas)');
  });

  it('sends every line with its quantity and a key, then emits the order and closes', async () => {
    const f = await render();
    remove(f, 'b', 1);
    const dispatched = jest.fn();
    f.componentInstance.dispatched.subscribe(dispatched);
    send(f).click();
    const request = http.expectOne('/api/v1/sales/orders/o1/dispatches');
    expect(request.request.body).toEqual({
      items: [
        { orderItemId: 'a', quantity: 6 },
        { orderItemId: 'b', quantity: 2 },
      ],
    });
    expect(request.request.headers.get('Idempotency-Key')).toMatch(/\S+/);
    const updated = order({ status: 'PARTIALLY_DISPATCHED' });
    request.flush(updated);
    f.detectChanges();
    expect(dispatched).toHaveBeenCalledWith(updated);
    expect(f.componentInstance.open()).toBe(false);
  });

  it('a changed quantity is a new request: it takes another key', async () => {
    const f = await render();
    send(f).click();
    const first = http.expectOne('/api/v1/sales/orders/o1/dispatches');
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush({ message: 'x' }, { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    remove(f, 'a', 1);
    send(f).click();
    const second = http.expectOne('/api/v1/sales/orders/o1/dispatches');
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    second.flush(order());
  });

  it('does not close with Escape or a backdrop click while the request is in flight', async () => {
    const f = await render();
    send(f).click();
    f.detectChanges();
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    http.expectOne('/api/v1/sales/orders/o1/dispatches').flush(order());
  });

  it('shows the error of the server in Spanish and stays open', async () => {
    const f = await render();
    send(f).click();
    http
      .expectOne('/api/v1/sales/orders/o1/dispatches')
      .flush({ code: 'DISPATCH_EXCEEDS_RESERVED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    expect(el(f).textContent).toContain('No pudimos despachar el pedido');
    expect(el(f).textContent).toContain('más piezas de las que quedan reservadas');
    expect(f.componentInstance.open()).toBe(true);
    expect(send(f).disabled).toBe(false);
  });
});
