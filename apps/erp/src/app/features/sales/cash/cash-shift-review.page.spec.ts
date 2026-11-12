import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import type { CashShiftReview } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { CashShiftReviewPage } from './cash-shift-review.page';
import { shiftReview } from './cash.testing';

const URL = '/api/v1/sales/cash-shifts/s1/review';
const REVIEW = 'sales.cash-register.review';

/** VP-06b · Revisar cierre (HU-VEN-24, decision #17). */
describe('CashShiftReviewPage', () => {
  let http: HttpTestingController;

  async function open(opts: { permissions?: string[]; review?: CashShiftReview | { status: number }; flush?: boolean } = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(opts.permissions ?? [REVIEW])) },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 's1' }) } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(CashShiftReviewPage);
    fixture.detectChanges();
    if (opts.flush !== false) {
      const review = opts.review ?? shiftReview();
      const req = http.expectOne(URL);
      if ('status' in review && typeof review.status === 'number') req.flush({ message: 'x' }, { status: review.status, statusText: 'Error' });
      else req.flush(review);
      await fixture.whenStable();
      fixture.detectChanges();
    }
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';
  const byId = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = (el: HTMLElement, id: string) => (byId(el, id) as HTMLButtonElement).click();
  async function typeReply(fixture: ComponentFixture<CashShiftReviewPage>, value: string) {
    const box = (fixture.nativeElement as HTMLElement).querySelector('#review-reply') as HTMLTextAreaElement;
    box.value = value;
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
    fixture.detectChanges();
  }
  async function settle(fixture: ComponentFixture<CashShiftReviewPage>) {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows a skeleton while the closing loads', async () => {
    const { el } = await open({ flush: false });
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(URL).flush(shiftReview());
  });

  it('shows the header and the four figures: expected, counted, difference and sales', async () => {
    const { el } = await open();
    expect(text(el)).toContain('Revisar cierre · Caja 1');
    expect(text(el)).toContain('Turno T-0142 de Ana Cajera · 14/10/2026 08:02 a 19:05 · Huayna Kapac');
    expect(byId(el, 'review-status')?.textContent).toContain('Por revisar');
    const kpis = Array.from(el.querySelectorAll('rs-kpi-card')).map((k) => k.textContent?.replace(/\s+/g, ' ') ?? '');
    expect(kpis).toHaveLength(4);
    expect(kpis[0]).toContain('Esperado');
    expect(kpis[0]).toContain('Bs 600,00');
    expect(kpis[1]).toContain('Contado');
    expect(kpis[1]).toContain('Bs 580,00');
    expect(kpis[2]).toContain('Diferencia');
    expect(kpis[2]).toContain('− Bs 20,00');
    expect(kpis[3]).toContain('Ventas del turno');
    expect(kpis[3]).toContain('Bs 700,00');
  });

  it("shows the cashier's justification and the deposit", async () => {
    const { el } = await open();
    expect(text(el)).toContain('Justificación del cajero');
    expect(byId(el, 'review-comment')?.textContent).toContain('Faltó un vuelto de Bs 20');
    expect(byId(el, 'review-deposit')?.textContent).toContain('Bs 480,00 a banco · Bs 100,00 quedan en caja');
  });

  it('lists system, declared and difference per payment method', async () => {
    const { el } = await open();
    expect(text(el)).toContain('Por forma de pago');
    for (const header of ['Forma', 'Sistema', 'Contado o confirmado', 'Diferencia']) expect(text(el)).toContain(header);
    const rows = Array.from(el.querySelectorAll('rs-doc-table tbody tr')).map((r) => r.textContent?.replace(/\s+/g, ' ') ?? '');
    expect(rows[0]).toContain('Efectivo');
    expect(rows[0]).toContain('Bs 600,00');
    expect(rows[0]).toContain('Bs 580,00');
    expect(rows[0]).toContain('− Bs 20,00');
    expect(rows.some((r) => r.includes('QR'))).toBe(true);
    expect(rows.some((r) => r.includes('Transferencia'))).toBe(true);
  });

  it('shows the audit trail and what is still pending', async () => {
    const { el } = await open();
    const trail = byId(el, 'review-timeline')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(trail).toContain('14/10/2026 08:02');
    expect(trail).toContain('Apertura de caja por Ana Cajera');
    expect(trail).toContain('Cierre de caja por Ana Cajera');
    expect(trail).toContain('Pendiente');
    expect(trail).toContain('Revisión de Contabilidad');
  });

  it('offers "Pedir recuento" and "Aprobar cierre" only when the closing can be decided by the caller', async () => {
    const reviewer = await open();
    expect(byId(reviewer.el, 'review-observe')?.textContent).toContain('Pedir recuento');
    expect(byId(reviewer.el, 'review-approve')?.textContent).toContain('Aprobar cierre');
    expect(reviewer.el.querySelector('#review-reply')).not.toBeNull();
    TestBed.resetTestingModule();

    // the cashier reads their own closing
    const cashier = await open({ permissions: ['sales.cash-register.open'], review: shiftReview({ canDecide: false }) });
    expect(byId(cashier.el, 'review-observe')).toBeNull();
    expect(byId(cashier.el, 'review-approve')).toBeNull();
    expect(cashier.el.querySelector('#review-reply')).toBeNull();
    expect(text(cashier.el)).toContain('Cierre de caja · Caja 1');
    expect(byId(cashier.el, 'review-comment')?.textContent).toContain('Faltó un vuelto');
    TestBed.resetTestingModule();

    // the API says it can be decided, but the session lost the permission: the buttons stay hidden
    const stale = await open({ permissions: ['sales.cash-register.open'] });
    expect(byId(stale.el, 'review-approve')).toBeNull();
  });

  it('approves without a comment and shows the decision', async () => {
    const { fixture, el } = await open();
    click(el, 'review-approve');
    const req = http.expectOne('/api/v1/sales/cash-shifts/s1/approve');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ comment: undefined });
    req.flush(
      shiftReview({
        status: 'APPROVED',
        displayStatus: 'DIFFERENCE_APPROVED',
        canDecide: false,
        review: { by: { id: 'u9', name: 'Carla Contadora' }, at: '2026-10-15T13:00:00.000Z', note: null },
      }),
    );
    await settle(fixture);

    expect(byId(el, 'review-status')?.textContent).toContain('Diferencia aprobada');
    expect(byId(el, 'review-decision')?.textContent).toContain('Cierre aprobado por Carla Contadora el 15/10/2026 09:00');
    expect(byId(el, 'review-decision')?.textContent).toContain('Sin comentario.');
    expect(byId(el, 'review-approve')).toBeNull();
    expect(byId(el, 'review-timeline')?.textContent).not.toContain('Pendiente');
  });

  it('sends the answer typed when approving', async () => {
    const { fixture, el } = await open();
    await typeReply(fixture, '  Se acepta el faltante  ');
    click(el, 'review-approve');
    const req = http.expectOne('/api/v1/sales/cash-shifts/s1/approve');
    expect(req.request.body).toEqual({ comment: 'Se acepta el faltante' });
    req.flush(shiftReview({ status: 'APPROVED', displayStatus: 'DIFFERENCE_APPROVED', canDecide: false }));
  });

  it('does not ask for a recount without a comment', async () => {
    const { fixture, el } = await open();
    click(el, 'review-observe');
    await settle(fixture);
    http.expectNone('/api/v1/sales/cash-shifts/s1/observe');
    expect(text(el)).toContain('Escribe la respuesta para el cajero antes de pedir el recuento.');

    await typeReply(fixture, 'Recontar los billetes de 20');
    expect(text(el)).not.toContain('Escribe la respuesta para el cajero antes de pedir el recuento.');
    click(el, 'review-observe');
    const req = http.expectOne('/api/v1/sales/cash-shifts/s1/observe');
    expect(req.request.body).toEqual({ comment: 'Recontar los billetes de 20' });
    req.flush(
      shiftReview({
        status: 'OBSERVED',
        displayStatus: 'OBSERVED',
        canDecide: false,
        review: { by: { id: 'u9', name: 'Carla Contadora' }, at: '2026-10-15T13:00:00.000Z', note: 'Recontar los billetes de 20' },
      }),
    );
    await settle(fixture);
    expect(byId(el, 'review-status')?.textContent).toContain('Observado');
    expect(byId(el, 'review-decision')?.textContent).toContain('Recuento pedido por Carla Contadora');
    expect(byId(el, 'review-decision')?.textContent).toContain('Recontar los billetes de 20');
  });

  it('shows the error of a refused decision in Spanish and reloads the closing', async () => {
    const { fixture, el } = await open();
    click(el, 'review-approve');
    http
      .expectOne('/api/v1/sales/cash-shifts/s1/approve')
      .flush({ code: 'CASH_SHIFT_NOT_CLOSED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    // someone else decided in between
    http.expectOne(URL).flush(shiftReview({ status: 'OBSERVED', displayStatus: 'OBSERVED', canDecide: false }));
    await settle(fixture);

    expect(byId(el, 'review-action-error')?.textContent).toContain('Este cierre ya no espera revisión');
    expect(byId(el, 'review-approve')).toBeNull();
  });

  it('shows the no-permission, not-found and error states', async () => {
    const forbidden = await open({ review: { status: 403 } });
    expect(text(forbidden.el)).toContain('No tienes permiso para ver este cierre');
    TestBed.resetTestingModule();

    const gone = await open({ review: { status: 404 } });
    expect(text(gone.el)).toContain('Este turno ya no existe');
    TestBed.resetTestingModule();

    const failed = await open({ review: { status: 500 } });
    expect(text(failed.el)).toContain('No pudimos cargar el cierre');
    (Array.from(failed.el.querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar')) as HTMLButtonElement).click();
    http.expectOne(URL).flush(shiftReview());
    await settle(failed.fixture);
    expect(text(failed.el)).toContain('Justificación del cajero');
  });
});
