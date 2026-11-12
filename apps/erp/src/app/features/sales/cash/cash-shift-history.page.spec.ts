import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CashShiftListResponse } from '@rodasoft/domain';
import { RowActionComponent, RS_PERMISSIONS, SelectComponent } from '@rodasoft/ui';
import { CashShiftHistoryPage } from './cash-shift-history.page';
import { shiftList, shiftRow } from './cash.testing';

const LIST_URL = '/api/v1/sales/cash-shifts';
const REVIEW = 'sales.cash-register.review';
const OPEN = 'sales.cash-register.open';

@Component({ template: '' })
class StubPage {}

/** VP-23 · Historial de turnos (HU-VEN-25). */
describe('CashShiftHistoryPage', () => {
  let http: HttpTestingController;

  async function open(url = '/history', granted: string[] = [REVIEW]) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'history', component: CashShiftHistoryPage },
          { path: 'sales/cash-register/shifts/:id/review', component: StubPage },
          { path: 'sales/cash-register', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(granted)) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, CashShiftHistoryPage);
    return harness;
  }

  const request = () => http.expectOne((r) => r.url === LIST_URL);
  const flushList = (body: CashShiftListResponse = shiftList()) => request().flush(body);
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent?.replace(/\s+/g, ' ') ?? '';
  const bodyRows = (h: RouterTestingHarness) => Array.from(root(h).querySelectorAll('rs-doc-table tbody tr')).map((r) => r.textContent?.replace(/\s+/g, ' ') ?? '');
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const select = (h: RouterTestingHarness, testId: string) =>
    h.fixture.debugElement.queryAll(By.directive(SelectComponent)).find((s) => (s.nativeElement as HTMLElement).dataset['testid'] === testId)
      ?.componentInstance as SelectComponent;

  afterEach(() => http.verify());

  it('shows a skeleton while the list loads and asks for the first page', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    const req = request();
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('pageSize')).toBe('20');
    expect(req.request.params.has('status')).toBe(false);
    req.flush(shiftList());
  });

  it('shows the title and the four KPIs of the month', async () => {
    const h = await open();
    flushList();
    await settle(h);
    expect(text(h)).toContain('Historial de turnos');
    expect(text(h)).toContain('Aperturas y cierres de caja con sus diferencias y aprobaciones.');
    const kpis = Array.from(root(h).querySelectorAll('rs-kpi-card')).map((k) => k.textContent?.replace(/\s+/g, ' ') ?? '');
    expect(kpis).toHaveLength(4);
    expect(kpis[0]).toContain('Turnos este mes');
    expect(kpis[0]).toContain('12');
    expect(kpis[1]).toContain('Con diferencia');
    expect(kpis[1]).toContain('2');
    expect(kpis[2]).toContain('Por revisar');
    expect(kpis[2]).toContain('1');
    expect(kpis[3]).toContain('Diferencia acumulada');
    expect(kpis[3]).toContain('− Bs 35,50');
  });

  it('lists shift, cashier and register, schedule, sales, difference and status', async () => {
    const h = await open();
    flushList();
    await settle(h);
    for (const header of ['Turno', 'Cajero · caja', 'Horario', 'Ventas', 'Diferencia', 'Estado']) expect(text(h)).toContain(header);
    const rows = bodyRows(h);
    expect(rows[0]).toContain('T-0142');
    expect(rows[0]).toContain('Ana Cajera · Caja 1');
    expect(rows[0]).toContain('14/10 08:02–19:05');
    expect(rows[0]).toContain('Bs 700,00');
    expect(rows[0]).toContain('− Bs 20,00');
    expect(rows[0]).toContain('Por revisar');
    expect(rows[1]).toContain('Beto Cajero · Caja 1');
    expect(rows[1]).toContain('Cerrado');
    // an open shift has no closing time and no difference yet
    expect(rows[2]).toContain('14/10 08:02 · abierto');
    expect(rows[2]).toContain('—');
    expect(rows[2]).toContain('Abierto');
  });

  it('shows every status pill', async () => {
    const h = await open();
    flushList(
      shiftList({
        items: [
          shiftRow({ id: 'a', displayStatus: 'PENDING_REVIEW' }),
          shiftRow({ id: 'b', status: 'APPROVED', displayStatus: 'CLOSED_CLEAN' }),
          shiftRow({ id: 'c', status: 'APPROVED', displayStatus: 'DIFFERENCE_APPROVED' }),
          shiftRow({ id: 'd', status: 'OBSERVED', displayStatus: 'OBSERVED' }),
          shiftRow({ id: 'e', status: 'OPEN', displayStatus: 'OPEN', closedAt: null, difference: null }),
        ],
        total: 5,
      }),
    );
    await settle(h);
    const pills = Array.from(root(h).querySelectorAll('rs-doc-table tbody rs-status-pill')).map((p) => p.textContent?.trim());
    expect(pills).toEqual(['Por revisar', 'Cerrado', 'Diferencia aprobada', 'Observado', 'Abierto']);
  });

  it('totals every shift the filters match', async () => {
    const h = await open();
    flushList();
    await settle(h);
    const total = root(h).querySelector('rs-doc-table tfoot')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(total).toContain('Total');
    expect(total).toContain('3 turnos');
    expect(total).toContain('Bs 2.100,00');
    expect(total).toContain('− Bs 20,00');
    expect(text(h)).toContain('1–3 de 3 turnos');
  });

  it('pages through the URL', async () => {
    const h = await open('/history?page=2');
    const req = request();
    expect(req.request.params.get('page')).toBe('2');
    req.flush(shiftList({ total: 45, page: 2 }));
    await settle(h);
    expect(text(h)).toContain('21–23 de 45 turnos');
  });

  it('sends the filters of the URL and ignores a status that does not exist', async () => {
    const h = await open('/history?from=2026-10-01&to=2026-10-31&cashierId=u2&status=OBSERVED');
    const req = request();
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    expect(req.request.params.get('cashierId')).toBe('u2');
    expect(req.request.params.get('status')).toBe('OBSERVED');
    req.flush(shiftList());
    await settle(h);
    TestBed.resetTestingModule();

    await open('/history?status=NOPE&from=ayer');
    const bad = request();
    expect(bad.request.params.has('status')).toBe(false);
    expect(bad.request.params.has('from')).toBe(false);
    bad.flush(shiftList());
  });

  it('filters by status and by cashier, back on the first page', async () => {
    const h = await open('/history?page=3');
    flushList();
    await settle(h);

    select(h, 'history-status').value.set('PENDING_REVIEW');
    await settle(h);
    const byStatus = request();
    expect(byStatus.request.params.get('status')).toBe('PENDING_REVIEW');
    expect(byStatus.request.params.get('page')).toBe('1');
    byStatus.flush(shiftList());
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/history?status=PENDING_REVIEW');

    select(h, 'history-cashier').value.set('u2');
    await settle(h);
    const byCashier = request();
    expect(byCashier.request.params.get('cashierId')).toBe('u2');
    expect(byCashier.request.params.get('status')).toBe('PENDING_REVIEW');
    byCashier.flush(shiftList());
  });

  it('clears the filters', async () => {
    const h = await open('/history?status=OBSERVED&cashierId=u2');
    flushList();
    await settle(h);
    (root(h).querySelector('[data-testid="history-clear"]') as HTMLButtonElement).click();
    await settle(h);
    const req = request();
    expect(req.request.params.has('status')).toBe(false);
    expect(req.request.params.has('cashierId')).toBe(false);
    req.flush(shiftList());
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/history');
  });

  it('offers "Revisar cierre" for a closing waiting, "Ver cierre" for a decided one and nothing for an open shift', async () => {
    const h = await open();
    flushList();
    await settle(h);
    const menus = h.fixture.debugElement.queryAll(By.directive(RowActionComponent)).map((m) => m.componentInstance as RowActionComponent);
    // the open shift has no menu
    expect(menus).toHaveLength(2);
    expect(menus[0].items().map((i) => i.label)).toEqual(['Revisar cierre']);
    expect(menus[1].items().map((i) => i.label)).toEqual(['Ver cierre']);

    menus[0].selected.emit('review');
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/shifts/s1/review');
  });

  it('links the number of a closed shift to its closing, and not the one of an open shift', async () => {
    const h = await open();
    flushList();
    await settle(h);
    const links = Array.from(root(h).querySelectorAll('rs-doc-table tbody a')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/sales/cash-register/shifts/s1/review', '/sales/cash-register/shifts/s2/review']);
  });

  it('shows a cashier only "Ver cierre", no cashier filter, and the way back to the current shift', async () => {
    const h = await open('/history', [OPEN]);
    flushList(shiftList({ canReview: false, cashiers: [], registers: [], items: [shiftRow()], total: 1 }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="history-cashier"]')).toBeNull();
    expect(root(h).querySelector('[data-testid="history-status"]')).not.toBeNull();
    const menu = h.fixture.debugElement.query(By.directive(RowActionComponent)).componentInstance as RowActionComponent;
    expect(menu.items().map((i) => i.label)).toEqual(['Ver cierre']);
    expect(root(h).querySelector('[data-testid="history-current"]')?.getAttribute('href')).toBe('/sales/cash-register');
  });

  it('hides "Ir al turno actual" from who only reviews', async () => {
    const h = await open();
    flushList();
    await settle(h);
    expect(root(h).querySelector('[data-testid="history-current"]')).toBeNull();
    expect(root(h).querySelector('[data-testid="history-cashier"]')).not.toBeNull();
  });

  it('shows the first-use empty state, and another one when the filters leave nothing', async () => {
    const empty = await open();
    flushList(shiftList({ items: [], total: 0 }));
    await settle(empty);
    expect(text(empty)).toContain('Aún no hay turnos de caja');
    TestBed.resetTestingModule();

    const filtered = await open('/history?status=OBSERVED');
    flushList(shiftList({ items: [], total: 0 }));
    await settle(filtered);
    expect(text(filtered)).toContain('No encontramos turnos');
    expect(text(filtered)).toContain('Limpiar filtros');
  });

  it('shows the error state with a retry, and the no-permission state', async () => {
    const h = await open();
    request().flush({ code: 'INVALID_FILTER', message: 'x' }, { status: 400, statusText: 'Bad Request' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar los turnos');
    expect(text(h)).toContain('Los filtros no son válidos');
    (Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar')) as HTMLButtonElement).click();
    flushList();
    await settle(h);
    expect(bodyRows(h)).toHaveLength(3);
    TestBed.resetTestingModule();

    const forbidden = await open();
    request().flush({ code: 'NO_PERMISSION', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await settle(forbidden);
    expect(text(forbidden)).toContain('No tienes permiso para ver los turnos de caja');
    expect(forbidden.routeNativeElement?.querySelector('rs-doc-table')).toBeNull();
  });
});
