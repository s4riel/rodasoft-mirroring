import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import type { CancellationReview } from '@rodasoft/domain';
import { SaleCancellationReviewPage } from './sale-cancellation-review.page';

const URL = '/api/v1/sales/sales/s1/cancellation-request';

const review = (over: Partial<CancellationReview['impact']> = {}): CancellationReview => ({
  saleId: 's1',
  saleNumber: 'V-000124',
  request: {
    id: 'r1',
    reason: 'CUSTOMER_DATA_ERROR',
    comment: 'El cliente pidió la factura a nombre de Industrias Demo Ltda., no S.A.',
    requestedBy: 'Alberto Andia',
    requestedAt: '2026-10-14T15:15:00.000Z',
  },
  sale: { total: '1280.00', createdAt: '2026-10-14T14:24:00.000Z', invoice: { status: 'VALID', number: 1528 } },
  impact: {
    invoiceAction: 'REQUEST_SIAT_CANCELLATION',
    stockUnits: 8,
    cashRefund: '1280.00',
    manualRefunds: [],
    warehouseName: 'Huayna Kapac',
    registerName: 'Caja 1',
    shiftOpen: true,
    ...over,
  },
  audit: [{ action: 'sales.sale.cancellation-request', at: '2026-10-14T15:15:00.000Z', userName: 'Alberto Andia' }],
});

describe('SaleCancellationReviewPage', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 's1' }) } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SaleCancellationReviewPage);
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
  const byId = (f: Fixture, id: string) => el(f).querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const type = (f: Fixture, text: string) => {
    const input = el(f).querySelector<HTMLInputElement>('#review-reply')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  afterEach(() => http.verify());

  it('shows a skeleton while it loads', async () => {
    const f = await render();
    expect(el(f).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(URL).flush(review());
  });

  it('shows the amount, the invoice, the reason, the time, the comment, what will happen and the audit', async () => {
    const f = await render();
    http.expectOne(URL).flush(review());
    await settle(f);
    const text = el(f).textContent ?? '';
    expect(text).toContain('Aprobar anulación · Venta V-000124');
    expect(text).toContain('Por aprobar');
    expect(text).toContain('Solicitada por Alberto Andia');
    expect(text).toContain('Bs 1.280,00');
    expect(text).toContain('Factura 1528');
    expect(text).toContain('Error en datos del cliente');
    expect(text).toContain('Tiempo desde la venta');
    expect(byId(f, 'review-comment')?.textContent).toContain('Industrias Demo Ltda.');
    expect(byId(f, 'review-impact')?.textContent).toContain('Se anula la factura en el SIAT, el stock (8 piezas) vuelve a Huayna Kapac');
    expect(byId(f, 'review-impact')?.textContent).toContain('reembolso de Bs 1.280,00 en Caja 1');
    expect(text).toContain('Anulación solicitada · esperando a Gerencia');
    expect(text).toContain('Pendiente: aprobación de Gerencia');
  });

  it('approves after confirming, with the reply, and goes to the sale', async () => {
    const f = await render();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    http.expectOne(URL).flush(review());
    await settle(f);
    type(f, 'Aprobado. Volver a emitir con la razón social correcta.');
    byId(f, 'review-approve')!.click();
    await settle(f);
    expect(el(f).textContent).toContain('¿Aprobar la anulación?');
    byId(f, 'review-approve-confirm')!.click();
    const post = http.expectOne({ method: 'POST', url: `${URL}/approve` });
    expect(post.request.body).toEqual({ comment: 'Aprobado. Volver a emitir con la razón social correcta.' });
    post.flush({ saleId: 's1', status: 'CANCELLED' });
    await settle(f);
    expect(navigate).toHaveBeenCalledWith(['/sales/history', 's1']);
  });

  it('approves without a reply', async () => {
    const f = await render();
    jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    http.expectOne(URL).flush(review());
    await settle(f);
    byId(f, 'review-approve')!.click();
    await settle(f);
    byId(f, 'review-approve-confirm')!.click();
    const post = http.expectOne({ method: 'POST', url: `${URL}/approve` });
    expect(post.request.body).toEqual({ comment: undefined });
    post.flush({ saleId: 's1', status: 'CANCELLED' });
  });

  it('does not reject without a reply and says so', async () => {
    const f = await render();
    http.expectOne(URL).flush(review());
    await settle(f);
    byId(f, 'review-reject')!.click();
    await settle(f);
    http.expectNone({ method: 'POST', url: `${URL}/reject` });
    expect(el(f).textContent).toContain('Escribe la respuesta para el cajero antes de rechazar.');
    type(f, 'No procede');
    await settle(f);
    expect(el(f).textContent).not.toContain('Escribe la respuesta para el cajero antes de rechazar.');
  });

  it('rejects with the reply and goes to the sale', async () => {
    const f = await render();
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    http.expectOne(URL).flush(review());
    await settle(f);
    type(f, 'La factura ya se entregó');
    byId(f, 'review-reject')!.click();
    const post = http.expectOne({ method: 'POST', url: `${URL}/reject` });
    expect(post.request.body).toEqual({ comment: 'La factura ya se entregó' });
    post.flush({ saleId: 's1', status: 'COMPLETED' });
    await settle(f);
    expect(navigate).toHaveBeenCalledWith(['/sales/history', 's1']);
  });

  it('blocks the approval and says why when the register has no open shift', async () => {
    const f = await render();
    http.expectOne(URL).flush(review({ shiftOpen: false }));
    await settle(f);
    expect(byId(f, 'review-shift-closed')?.textContent).toContain('Caja 1 no tiene un turno abierto');
    expect(byId(f, 'review-approve')!.disabled).toBe(true);
    expect(byId(f, 'review-reject')!.disabled).toBe(false);
  });

  it('does not need a shift when no cash goes back', async () => {
    const f = await render();
    http.expectOne(URL).flush(review({ shiftOpen: false, cashRefund: '0.00', manualRefunds: [{ method: 'CARD', amount: '1280.00' }] }));
    await settle(f);
    expect(byId(f, 'review-shift-closed')).toBeNull();
    expect(byId(f, 'review-approve')!.disabled).toBe(false);
    expect(byId(f, 'review-impact')?.textContent).toContain('Reembolso de tarjeta Bs 1.280,00 a gestionar manualmente');
  });

  it('blocks the approval when the invoice cannot be cancelled', async () => {
    const f = await render();
    http.expectOne(URL).flush(review({ invoiceAction: 'BLOCKED' }));
    await settle(f);
    expect(byId(f, 'review-invoice-blocked')).not.toBeNull();
    expect(byId(f, 'review-approve')!.disabled).toBe(true);
  });

  it('says "en el SIAT" only when the invoice was already issued', async () => {
    const f = await render();
    http.expectOne(URL).flush(review());
    await settle(f);
    expect(byId(f, 'review-approve')!.textContent).toContain('Aprobar y anular en el SIAT');
  });

  it('says it plainly when the invoice is only voided here', async () => {
    const f = await render();
    http.expectOne(URL).flush(review({ invoiceAction: 'VOID' }));
    await settle(f);
    expect(byId(f, 'review-approve')!.textContent?.trim()).toBe('Aprobar anulación');
  });

  it('shows the translated error when the decision fails and keeps the page', async () => {
    const f = await render();
    http.expectOne(URL).flush(review());
    await settle(f);
    byId(f, 'review-approve')!.click();
    await settle(f);
    byId(f, 'review-approve-confirm')!.click();
    http
      .expectOne({ method: 'POST', url: `${URL}/approve` })
      .flush({ code: 'CASH_SHIFT_NOT_OPEN_FOR_REFUND', message: 'x' }, { status: 409, statusText: 'Conflict' });
    http.expectOne(URL).flush(review({ shiftOpen: false }));
    await settle(f);
    expect(byId(f, 'review-action-error')?.textContent).toContain('no tiene un turno abierto para registrar el reembolso');
  });

  it('says the request is gone when someone decided first', async () => {
    const f = await render();
    http.expectOne(URL).flush({ code: 'CANCELLATION_NOT_PENDING', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await settle(f);
    expect(el(f).textContent).toContain('Esta solicitud ya no espera una decisión');
  });

  it('says there is no permission and that it could not load', async () => {
    const f = await render();
    http.expectOne(URL).flush({ code: 'FORBIDDEN', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await settle(f);
    expect(el(f).textContent).toContain('No tienes permiso para decidir anulaciones');
  });

  it('offers to retry when it fails to load', async () => {
    const f = await render();
    http.expectOne(URL).flush({ code: 'ERROR', message: 'x' }, { status: 500, statusText: 'Server Error' });
    await settle(f);
    expect(el(f).querySelector('[role="alert"]')?.textContent).toContain('No pudimos cargar la solicitud');
  });
});
