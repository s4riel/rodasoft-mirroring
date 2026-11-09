import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { CashMovementDetail } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { CashExpenseReviewPage } from './cash-expense-review.page';
import { movementDetail } from './cash.testing';

const URL = '/api/v1/sales/cash-movements/m3';

/** Revisión de un egreso de caja (HU-VEN-22, decision #16). */
describe('CashExpenseReviewPage', () => {
  let http: HttpTestingController;

  async function open(opts: { permissions?: string[]; detail?: CashMovementDetail | { status: number } } = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(opts.permissions ?? ['sales.cash-expenses.approve'])) },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'm3' }) } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(CashExpenseReviewPage);
    fixture.detectChanges();
    const detail = opts.detail ?? movementDetail();
    const req = http.expectOne(URL);
    if ('status' in detail && typeof detail.status === 'number') req.flush({ message: 'x' }, { status: detail.status, statusText: 'Error' });
    else req.flush(detail);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';
  const click = (el: HTMLElement, id: string) => (el.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click();

  afterEach(() => http.verify());

  it('shows the expense: amount, concept, cashier, time, detail and receipt', async () => {
    const { el } = await open();
    expect(text(el)).toContain('Egreso de caja');
    expect(text(el)).toContain('Por aprobar');
    expect(el.querySelector('[data-testid="expense-subtitle"]')?.textContent).toContain('Ana Cajera · Caja 1');
    const kpis = Array.from(el.querySelectorAll('rs-kpi-card')).map((k) => k.textContent?.replace(/\s+/g, ' '));
    expect(kpis[0]).toContain('Bs 150,00');
    expect(kpis[1]).toContain('Servicios');
    expect(text(el)).toContain('Reparación de la puerta');
    expect(el.querySelector('[data-testid="expense-receipt"]')).not.toBeNull();
  });

  it('shows the decision card to who approves, and not to a cashier', async () => {
    const approver = await open();
    expect(approver.el.querySelector('[data-testid="expense-approval"]')).not.toBeNull();
    TestBed.resetTestingModule();

    const cashier = await open({ permissions: ['sales.cash-register.open'], detail: movementDetail({ canDecide: false, canWithdraw: true }) });
    expect(cashier.el.querySelector('[data-testid="expense-approval"]')).toBeNull();
    expect(cashier.el.querySelector('[data-testid="expense-withdraw"]')).not.toBeNull();
  });

  it('hides the decision card once the expense was decided and shows who decided', async () => {
    const decided = movementDetail({
      status: 'POSTED',
      canDecide: false,
      approval: { requestId: 'a1', requestedBy: { id: 'u1', name: 'Ana Cajera' }, decidedBy: { id: 'u9', name: 'Gerardo' }, decidedAt: '2026-11-04T17:00:00.000Z', comment: 'Autorizado' },
    });
    const { el } = await open({ detail: decided });
    expect(el.querySelector('[data-testid="expense-approval"]')).toBeNull();
    expect(el.querySelector('[data-testid="expense-decision"]')?.textContent).toContain('Aprobado por Gerardo');
    expect(el.querySelector('[data-testid="expense-decision"]')?.textContent).toContain('Autorizado');
  });

  it('approves, with the reply when there is one', async () => {
    const { fixture, el } = await open();
    const reply = el.querySelector('#expense-reply') as HTMLTextAreaElement;
    reply.value = ' Autorizado ';
    reply.dispatchEvent(new Event('input'));
    click(el, 'expense-approve');

    const req = http.expectOne(`${URL}/approve`);
    expect(req.request.body).toEqual({ comment: 'Autorizado' });
    req.flush(movementDetail({ status: 'POSTED', canDecide: false }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(el)).not.toContain('Por aprobar');
    expect(el.querySelector('[data-testid="expense-approval"]')).toBeNull();
  });

  it('does not reject without a reply', async () => {
    const { fixture, el } = await open();
    click(el, 'expense-reject');
    fixture.detectChanges();
    expect(text(el)).toContain('Escribe la respuesta para el cajero antes de rechazar.');
    http.expectNone(`${URL}/reject`);
  });

  it('rejects with the reply', async () => {
    const { el } = await open();
    const reply = el.querySelector('#expense-reply') as HTMLTextAreaElement;
    reply.value = 'Sin factura';
    reply.dispatchEvent(new Event('input'));
    click(el, 'expense-reject');
    const req = http.expectOne(`${URL}/reject`);
    expect(req.request.body).toEqual({ comment: 'Sin factura' });
    req.flush(movementDetail({ status: 'REJECTED', canDecide: false }));
  });

  it('lets the requester withdraw the request', async () => {
    const { el } = await open({ permissions: ['sales.cash-register.open'], detail: movementDetail({ canDecide: false, canWithdraw: true }) });
    click(el, 'expense-withdraw');
    http.expectOne(`${URL}/withdraw`).flush(movementDetail({ status: 'WITHDRAWN', canDecide: false, canWithdraw: false }));
  });

  it('shows the message and the current state when someone decided first', async () => {
    const { fixture, el } = await open();
    click(el, 'expense-approve');
    http.expectOne(`${URL}/approve`).flush({ code: 'CASH_MOVEMENT_NOT_PENDING', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    http.expectOne(URL).flush(movementDetail({ status: 'REJECTED', canDecide: false }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="expense-action-error"]')?.textContent).toContain('Este egreso ya no espera una decisión');
    expect(el.querySelector('[data-testid="expense-approval"]')).toBeNull();
  });

  it.each([
    [403, 'No tienes permiso para ver este egreso'],
    [404, 'Este egreso ya no existe'],
    [500, 'No pudimos cargar el egreso'],
  ])('shows the state for a %s answer', async (status, message) => {
    const { el } = await open({ detail: { status } });
    expect(text(el)).toContain(message);
  });
});
