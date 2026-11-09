import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { SaleDetail } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { SaleDetailPage } from './sale-detail.page';

const URL = '/api/v1/sales/sales/s1';

const detail = (over: Partial<SaleDetail> = {}): SaleDetail => ({
  id: 's1',
  number: 'V-000124',
  createdAt: '2026-10-14T14:24:00.000Z',
  status: 'COMPLETED',
  branch: { name: 'Sucursal central' },
  cashier: { name: 'Alberto Andia' },
  order: null,
  customer: { name: 'Industrias Demo S.A.', documentType: 5, documentNumber: '1023456029', email: 'ventas@demo.bo' },
  lines: [{ code: '6205-2RS', name: 'Rodamiento rígido de bolas', quantity: 2, unitPrice: '245.00', lineTotal: '490.00' }],
  subtotal: '490.00',
  discountType: 'NONE',
  discountAmount: '0.00',
  roundingAmount: '0.00',
  total: '490.00',
  payments: [{ method: 'CASH', amount: '490.00', change: '10.00', reference: null }],
  invoice: { status: 'PENDING', number: null },
  history: [
    { action: 'sales.sale.complete', at: '2026-10-14T14:24:00.000Z', userName: 'Alberto Andia', email: null },
    { action: 'sales.receipt.reprint', at: '2026-10-14T15:00:00.000Z', userName: 'Alberto Andia', email: null },
  ],
  cancellation: { canRequest: true, windowEndsAt: null, pending: null, lastDecision: null, impact: { warehouseName: 'Huayna Kapac', registerName: 'Caja 1' } },
  receiptFormat: 'TICKET_80MM',
  returns: [],
  returnable: true,
  ...over,
});

describe('SaleDetailPage', () => {
  let http: HttpTestingController;

  async function render(opts: { permissions?: string[]; query?: Record<string, string> } = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(opts.permissions ?? ['sales.pos.use', 'sales.cancellations.request'])) },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: 's1' }), queryParamMap: convertToParamMap(opts.query ?? {}) } },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SaleDetailPage);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const settle = async (f: Fixture) => {
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
  };
  const button = (f: Fixture, label: string) => Array.from(el(f).querySelectorAll('button')).find((b) => b.textContent?.includes(label))!;

  afterEach(() => http.verify());

  it('shows a skeleton while it loads', async () => {
    const f = await render();
    expect(el(f).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(URL).flush(detail());
  });

  it('shows the products, the payment with its change, the pending invoice and the history', async () => {
    const f = await render();
    http.expectOne(URL).flush(detail());
    await settle(f);
    const text = el(f).textContent ?? '';
    expect(text).toContain('V-000124');
    expect(text).toContain('Pagada');
    expect(text).toContain('Sucursal central');
    expect(text).toContain('Industrias Demo S.A.');
    expect(text).toContain('6205-2RS');
    expect(text).toContain('Rodamiento rígido de bolas');
    expect(text).toContain('Bs 490,00');
    expect(text).toContain('Efectivo');
    expect(text).toContain('cambio Bs 10,00');
    expect(text).toContain('Pendiente de emisión SIAT');
    expect(text).toContain('Venta completada');
    expect(text).toContain('Comprobante reimpreso');
    expect(text).not.toContain('Descuento');
  });

  it('shows the discount and the rounding only when there are some', async () => {
    const f = await render();
    http.expectOne(URL).flush(detail({ discountAmount: '49.00', roundingAmount: '-0.20', total: '440.80' }));
    await settle(f);
    const text = el(f).textContent ?? '';
    expect(text).toContain('Descuento');
    expect(text).toContain('Redondeo');
  });

  it('Reimprimir opens the ticket with the reprint flag', async () => {
    const f = await render();
    http.expectOne(URL).flush(detail());
    await settle(f);
    const opened = jest.spyOn(window, 'open').mockImplementation(() => null);
    button(f, 'Reimprimir').click();
    expect(opened).toHaveBeenCalledWith('/sales/receipts/s1/print?reprint=1', '_blank', 'noopener');
    opened.mockRestore();
  });

  it('sends the receipt by e-mail to the customer address and reloads the history', async () => {
    const f = await render();
    http.expectOne(URL).flush(detail());
    await settle(f);
    button(f, 'Enviar por correo').click();
    await settle(f);
    const input = el(f).querySelector<HTMLInputElement>('#sale-detail-email')!;
    expect(input.value).toBe('ventas@demo.bo');
    Array.from(el(f).querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Enviar')!.click();
    const post = http.expectOne({ method: 'POST', url: `${URL}/receipt/email` });
    expect(post.request.body).toEqual({ email: 'ventas@demo.bo' });
    post.flush({ queued: true });
    http.expectOne(URL).flush(detail());
    await settle(f);
  });

  it('says there is no permission or that it could not load', async () => {
    const f = await render();
    http.expectOne(URL).flush({ code: 'SALE_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(f);
    expect(el(f).querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar la venta');
    expect(el(f).textContent).toContain('La venta no existe.');
  });

  describe('cancellation (HU-VEN-14)', () => {
    const noCancellation = { canRequest: false, windowEndsAt: null, pending: null, lastDecision: null, impact: { warehouseName: 'Huayna Kapac', registerName: 'Caja 1' } };
    const pendingSale = (over: { canWithdraw?: boolean } = {}) =>
      detail({
        status: 'CANCELLATION_PENDING',
        cancellation: {
          ...noCancellation,
          pending: {
            id: 'r1',
            reason: 'CUSTOMER_DATA_ERROR',
            comment: 'Nombre mal escrito',
            requestedBy: 'Alberto Andia',
            requestedAt: '2026-10-14T15:15:00.000Z',
            canWithdraw: over.canWithdraw ?? true,
          },
        },
      });
    const testId = (f: Fixture, id: string) => el(f).querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

    it('offers "Solicitar anulación" to who may ask when the sale can be cancelled', async () => {
      const f = await render();
      http.expectOne(URL).flush(detail());
      await settle(f);
      expect(testId(f, 'sale-cancel-request')).not.toBeNull();
      expect(testId(f, 'sale-cancel-pending')).toBeNull();
      expect(testId(f, 'sale-cancel-withdraw')).toBeNull();
    });

    it('hides it without the permission', async () => {
      const f = await render({ permissions: ['sales.pos.use'] });
      http.expectOne(URL).flush(detail());
      await settle(f);
      expect(testId(f, 'sale-cancel-request')).toBeNull();
    });

    it('hides it when the sale cannot be asked to be cancelled (cancelled, or past the deadline)', async () => {
      const f = await render();
      http.expectOne(URL).flush(detail({ status: 'CANCELLED', cancellation: noCancellation }));
      await settle(f);
      expect(testId(f, 'sale-cancel-request')).toBeNull();
      expect(el(f).textContent).toContain('Anulada');
    });

    it('opens the request dialog and reloads the sale once it is sent', async () => {
      const f = await render();
      http.expectOne(URL).flush(detail());
      await settle(f);
      testId(f, 'sale-cancel-request')!.click();
      await settle(f);
      expect(el(f).textContent).toContain('Solicitar anulación de la venta V-000124');
      el(f).querySelector<HTMLButtonElement>('rs-filter-chip button')!.click();
      f.detectChanges();
      const input = el(f).querySelector<HTMLTextAreaElement>('#sale-cancellation-comment')!;
      input.value = 'Nombre mal escrito';
      input.dispatchEvent(new Event('input'));
      f.detectChanges();
      testId(f, 'cancellation-send')!.click();
      http.expectOne({ method: 'POST', url: `${URL}/cancellation-request` }).flush({ saleId: 's1', status: 'CANCELLATION_PENDING' });
      http.expectOne(URL).flush(pendingSale());
      await settle(f);
      expect(testId(f, 'sale-cancel-pending')?.textContent).toContain('Anulación pendiente de aprobación');
      expect(testId(f, 'sale-cancel-request')).toBeNull();
    });

    it('opens the dialog at once when the row menu sent the user here', async () => {
      const f = await render({ query: { cancel: '1' } });
      http.expectOne(URL).flush(detail());
      await settle(f);
      expect(el(f).textContent).toContain('Solicitar anulación de la venta V-000124');
    });

    it('does not open it from the URL for who may not ask for cancellations', async () => {
      const f = await render({ permissions: ['sales.pos.use'], query: { cancel: '1' } });
      http.expectOne(URL).flush(detail());
      await settle(f);
      expect(el(f).textContent).not.toContain('Solicitar anulación de la venta');
    });

    it('does not open it from the row menu when the sale can no longer be asked', async () => {
      const f = await render({ query: { cancel: '1' } });
      http.expectOne(URL).flush(pendingSale());
      await settle(f);
      expect(el(f).textContent).not.toContain('Solicitar anulación de la venta');
    });

    it('shows who asked, when and why while the sale waits, with the pill and the comment', async () => {
      const f = await render();
      http.expectOne(URL).flush(pendingSale());
      await settle(f);
      const banner = testId(f, 'sale-cancel-pending')?.textContent ?? '';
      expect(banner).toContain('Anulación pendiente de aprobación');
      expect(banner).toContain('Solicitada por Alberto Andia');
      expect(banner).toContain('motivo: error en datos del cliente');
      expect(banner).toContain('La factura sigue válida.');
      expect(banner).toContain('Comentario: Nombre mal escrito');
      expect(el(f).querySelector('rs-status-pill')?.textContent).toContain('Anulación pendiente');
    });

    it('lets who may withdraw take the request back, after confirming', async () => {
      const f = await render();
      http.expectOne(URL).flush(pendingSale());
      await settle(f);
      testId(f, 'sale-cancel-withdraw')!.click();
      await settle(f);
      expect(el(f).textContent).toContain('¿Retirar la solicitud de anulación?');
      testId(f, 'sale-cancel-withdraw-confirm')!.click();
      http.expectOne({ method: 'POST', url: `${URL}/cancellation-request/withdraw` }).flush({ saleId: 's1', status: 'COMPLETED' });
      http.expectOne(URL).flush(detail());
      await settle(f);
      expect(testId(f, 'sale-cancel-pending')).toBeNull();
    });

    it('hides "Retirar solicitud" from who may not withdraw it', async () => {
      const f = await render();
      http.expectOne(URL).flush(pendingSale({ canWithdraw: false }));
      await settle(f);
      expect(testId(f, 'sale-cancel-withdraw')).toBeNull();
      expect(testId(f, 'sale-cancel-pending')).not.toBeNull();
    });

    it('when the withdrawal fails it reloads the sale to show what it is now', async () => {
      const f = await render();
      http.expectOne(URL).flush(pendingSale());
      await settle(f);
      testId(f, 'sale-cancel-withdraw')!.click();
      await settle(f);
      testId(f, 'sale-cancel-withdraw-confirm')!.click();
      http
        .expectOne({ method: 'POST', url: `${URL}/cancellation-request/withdraw` })
        .flush({ code: 'CANCELLATION_NOT_PENDING', message: 'x' }, { status: 409, statusText: 'Conflict' });
      http.expectOne(URL).flush(detail());
      await settle(f);
      expect(testId(f, 'sale-cancel-pending')).toBeNull();
      expect(el(f).textContent).toContain('Esta venta no tiene una solicitud de anulación pendiente.');
    });

    it('shows the request and the withdrawal in the history', async () => {
      const f = await render();
      http.expectOne(URL).flush(
        detail({
          history: [
            { action: 'sales.sale.complete', at: '2026-10-14T14:24:00.000Z', userName: 'Alberto Andia', email: null },
            { action: 'sales.sale.cancellation-request', at: '2026-10-14T15:15:00.000Z', userName: 'Alberto Andia', email: null },
            { action: 'sales.sale.cancellation-withdraw', at: '2026-10-14T15:20:00.000Z', userName: 'Alberto Andia', email: null },
          ],
        }),
      );
      await settle(f);
      expect(el(f).textContent).toContain('Anulación solicitada · esperando a Gerencia');
      expect(el(f).textContent).toContain('Solicitud de anulación retirada');
    });
  });

  describe('cancellation decision (HU-VEN-15)', () => {
    const place = { warehouseName: 'Huayna Kapac', registerName: 'Caja 1' };
    const base = { canRequest: false, windowEndsAt: null, pending: null, impact: place };
    const testId = (f: Fixture, id: string) => el(f).querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const pending = {
      id: 'r1',
      reason: 'CUSTOMER_DATA_ERROR' as const,
      comment: 'Nombre mal escrito',
      requestedBy: 'Alberto Andia',
      requestedAt: '2026-10-14T15:15:00.000Z',
      canWithdraw: false,
    };

    it('offers "Ver solicitud (Gerencia)" only to who may approve, while the request is pending', async () => {
      const f = await render({ permissions: ['sales.pos.use', 'sales.cancellations.approve'] });
      http.expectOne(URL).flush(detail({ status: 'CANCELLATION_PENDING', cancellation: { ...base, lastDecision: null, pending } }));
      await settle(f);
      expect(testId(f, 'sale-cancel-review')).not.toBeNull();
    });

    it('hides it without the approve permission', async () => {
      const f = await render();
      http.expectOne(URL).flush(detail({ status: 'CANCELLATION_PENDING', cancellation: { ...base, lastDecision: null, pending } }));
      await settle(f);
      expect(testId(f, 'sale-cancel-review')).toBeNull();
    });

    it('hides it when nothing is pending', async () => {
      const f = await render({ permissions: ['sales.pos.use', 'sales.cancellations.approve'] });
      http.expectOne(URL).flush(detail({ cancellation: { ...base, canRequest: true, lastDecision: null } }));
      await settle(f);
      expect(testId(f, 'sale-cancel-review')).toBeNull();
    });

    it('says how a cancelled sale ended: invoice, units back, refund and who approved', async () => {
      const f = await render();
      http.expectOne(URL).flush(
        detail({
          status: 'CANCELLED',
          invoice: { status: 'CANCELLED', number: 1528 },
          cancellation: { ...base, lastDecision: { status: 'APPROVED', decidedBy: 'María Quispe', decidedAt: '2026-10-14T15:40:00.000Z', comment: 'Aprobado' } },
        }),
      );
      await settle(f);
      const note = testId(f, 'sale-cancel-decision')!.textContent ?? '';
      expect(note).toContain('Venta anulada');
      expect(note).toContain('Factura 1528 anulada');
      expect(note).toContain('2 piezas devueltas a Huayna Kapac');
      expect(note).toContain('reembolso Bs 490,00 registrado en Caja 1');
      expect(note).toContain('Aprobada por María Quispe');
      expect(note).toContain('Respuesta: Aprobado');
      expect(el(f).textContent).toContain('Factura 1528 anulada');
    });

    it('shows the manager reply when the request was rejected and the sale is paid again', async () => {
      const f = await render();
      http.expectOne(URL).flush(
        detail({
          cancellation: {
            ...base,
            canRequest: true,
            lastDecision: { status: 'REJECTED', decidedBy: 'María Quispe', decidedAt: '2026-10-14T15:40:00.000Z', comment: 'La factura ya se entregó' },
          },
        }),
      );
      await settle(f);
      const note = testId(f, 'sale-cancel-decision')!.textContent ?? '';
      expect(note).toContain('Anulación rechazada');
      expect(note).toContain('Rechazada por María Quispe');
      expect(note).toContain('Respuesta: La factura ya se entregó');
    });

    it('shows nothing when the last decision no longer matches the status', async () => {
      const f = await render();
      http.expectOne(URL).flush(
        detail({ cancellation: { ...base, canRequest: true, lastDecision: { status: 'APPROVED', decidedBy: 'x', decidedAt: '2026-10-14T15:40:00.000Z', comment: '' } } }),
      );
      await settle(f);
      expect(testId(f, 'sale-cancel-decision')).toBeNull();
    });
  });
  describe('returns (HU-VEN-21)', () => {
    const tid = (f: Fixture, id: string) => el(f).querySelector<HTMLElement>(`[data-testid="${id}"]`);

    it('offers "Registrar devolución" with the permission when something can still come back', async () => {
      const f = await render({ permissions: ['sales.pos.use', 'sales.returns.manage'] });
      http.expectOne(URL).flush(detail());
      await settle(f);
      expect(tid(f, 'sale-return')).not.toBeNull();
    });

    it('hides it without the permission or when nothing can come back', async () => {
      const denied = await render();
      http.expectOne(URL).flush(detail());
      await settle(denied);
      expect(tid(denied, 'sale-return')).toBeNull();
      TestBed.resetTestingModule();
      const done = await render({ permissions: ['sales.pos.use', 'sales.returns.manage'] });
      http.expectOne(URL).flush(detail({ returnable: false }));
      await settle(done);
      expect(tid(done, 'sale-return')).toBeNull();
    });

    it('lists the returns and no longer offers the cancellation', async () => {
      const f = await render();
      http
        .expectOne(URL)
        .flush(detail({ returns: [{ id: 'r1', number: 'DEV-000001', status: 'APPROVED', total: '100.00', createdAt: '2026-10-15T10:00:00.000Z' }] }));
      await settle(f);
      expect(tid(f, 'sale-returns')?.textContent).toContain('DEV-000001');
      expect(tid(f, 'sale-cancel-request')).toBeNull();
    });
  });
});
