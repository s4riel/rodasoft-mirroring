import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CashShiftDetail, CurrentCashShift } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { CashRegisterPage } from './cash-register.page';
import { CURRENT_SHIFT, shiftDetail } from './cash.testing';

const CURRENT = '/api/v1/sales/cash-shifts/current';
const SHIFT = '/api/v1/sales/cash-shifts/s1';

@Component({ template: '' })
class Stub {}

/** VP-22 · the cashier's shift (HU-VEN-22). */
describe('CashRegisterPage', () => {
  let http: HttpTestingController;

  async function open(opts: { granted?: string[]; current?: CurrentCashShift | null | 'error'; detail?: CashShiftDetail | 'error' } = {}) {
    const granted = opts.granted ?? ['sales.cash-register.open'];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'sales/cash-register', component: CashRegisterPage },
          { path: 'sales/cash-register/open', component: Stub },
          { path: 'sales/cash-register/close', component: Stub },
          { path: 'sales/cash-register/movements/:id', component: Stub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { can: (p: string) => granted.includes(p), context: () => ({ user: { id: 'u1' } }) } },
        { provide: RS_PERMISSIONS, useValue: signal(new Set(granted)) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/cash-register');
    if (granted.includes('sales.cash-register.open')) {
      const current = opts.current === undefined ? CURRENT_SHIFT : opts.current;
      const req = http.expectOne(CURRENT);
      if (current === 'error') req.flush({}, { status: 500, statusText: 'Server Error' });
      else {
        req.flush({ shift: current });
        if (current) {
          const detail = opts.detail ?? shiftDetail();
          const shiftReq = http.expectOne(SHIFT);
          if (detail === 'error') shiftReq.flush({}, { status: 500, statusText: 'Server Error' });
          else shiftReq.flush(detail);
        }
      }
    }
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
    return h;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';

  afterEach(() => http.verify());

  it('goes to the opening form when the user has no open shift', async () => {
    await open({ current: null });
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/open');
  });

  it('shows the shift header with who opened it, the float and the branch', async () => {
    const h = await open();
    expect(text(h)).toContain('Caja 1 · turno abierto');
    expect(text(h)).toContain('por Ana Cajera con Bs 500,00 · Huayna Kapac');
  });

  it('shows the four KPIs: expected cash, shift sales with their count, income and expenses', async () => {
    const h = await open();
    const kpis = Array.from(root(h).querySelectorAll('rs-kpi-card')).map((el) => el.textContent?.replace(/\s+/g, ' ').trim());
    expect(kpis).toHaveLength(4);
    expect(kpis[0]).toContain('Efectivo esperado en caja');
    expect(kpis[0]).toContain('Bs 970,00');
    expect(kpis[1]).toContain('Ventas del turno');
    expect(kpis[1]).toContain('Bs 700,00');
    expect(kpis[1]).toContain('3 ventas');
    expect(kpis[2]).toContain('Bs 50,00');
    expect(kpis[3]).toContain('Bs 30,00');
  });

  it('lists the movements with the opening row first, their concept and who registered them', async () => {
    const h = await open();
    const rows = Array.from(root(h).querySelectorAll('rs-doc-table')[0].querySelectorAll('tbody tr')).map((r) => r.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('Apertura');
    expect(rows[0]).toContain('Efectivo inicial');
    expect(rows[0]).toContain('+ Bs 500,00');
    expect(rows[1]).toContain('Ingreso');
    expect(rows[1]).toContain('Cobro de saldo');
    expect(rows[1]).toContain('+ Bs 50,00');
    expect(rows[2]).toContain('Pago de flete');
    expect(rows[2]).toContain('− Bs 30,00');
  });

  it('shows the pills of a pending and a rejected expense and warns that a pending one blocks the closing', async () => {
    const detail = shiftDetail({
      pendingExpenses: 1,
      movements: [
        { ...shiftDetail().movements[1], id: 'p1', status: 'PENDING', amount: '150.00' },
        { ...shiftDetail().movements[1], id: 'p2', status: 'REJECTED', amount: '80.00' },
      ],
    });
    const h = await open({ detail });
    expect(text(h)).toContain('Por aprobar');
    expect(text(h)).toContain('Rechazada');
    expect(root(h).querySelector('[data-testid="cash-pending-note"]')?.textContent).toContain('Tienes 1 egreso');
  });

  it('shows the sales per payment method with a total, and hides credit when there is none', async () => {
    const h = await open();
    const table = root(h).querySelectorAll('rs-doc-table')[1].textContent?.replace(/\s+/g, ' ') ?? '';
    expect(table).toContain('Efectivo');
    expect(table).toContain('Bs 450,00');
    expect(table).toContain('Tarjeta');
    expect(table).toContain('Transferencia');
    expect(table).not.toContain('Crédito');
    expect(table).toContain('Total');
  });

  it('shows the cash calculation, with the refunds line only when there are refunds', async () => {
    const without = await open();
    expect(text(without)).toContain('Cálculo del efectivo');
    expect(text(without)).toContain('Efectivo inicial');
    expect(text(without)).toContain('Ventas en efectivo');
    expect(root(without).querySelector('[data-testid="cash-refunds"]')).toBeNull();
    TestBed.resetTestingModule();

    const withRefunds = await open({ detail: shiftDetail({ cash: { ...shiftDetail().cash, refunds: '25.00', expected: '945.00' } }) });
    expect(root(withRefunds).querySelector('[data-testid="cash-refunds"]')?.textContent).toContain('25,00');
  });

  it('offers the three buttons to who may operate the register, the last one going to the closing', async () => {
    const h = await open();
    expect(root(h).querySelector('[data-testid="cash-add-income"]')?.textContent).toContain('Registrar ingreso');
    expect(root(h).querySelector('[data-testid="cash-add-expense"]')?.textContent).toContain('Registrar egreso');
    expect(root(h).querySelector('a[data-testid="cash-close"]')?.getAttribute('href')).toBe('/sales/cash-register/close');
  });

  it('opens the movement dialog with the type of the button', async () => {
    const h = await open();
    (root(h).querySelector('[data-testid="cash-add-income"]') as HTMLButtonElement).click();
    h.detectChanges();
    await h.fixture.whenStable();
    expect(document.body.textContent).toContain('Registrar movimiento de efectivo');
    expect(document.body.textContent).toContain('Efectivo esperado en caja: Bs 970,00');
  });

  it('offers the receipt of a movement that has one, and the review of a pending expense to who approves', async () => {
    const detail = shiftDetail({ movements: [{ ...shiftDetail().movements[1], id: 'p1', status: 'PENDING', by: { id: 'u2', name: 'Otro' } }], pendingExpenses: 1 });
    const h = await open({ granted: ['sales.cash-register.open', 'sales.cash-expenses.approve'], detail });
    const component = h.routeDebugElement?.componentInstance as { menuOf(id: string): { key: string }[] };
    expect(component.menuOf('p1').map((i) => i.key)).toEqual(['receipt', 'review']);
  });

  it('offers to withdraw a pending expense only to who registered it', async () => {
    const detail = shiftDetail({ movements: [{ ...shiftDetail().movements[1], id: 'p1', status: 'PENDING', hasReceipt: false }], pendingExpenses: 1 });
    const h = await open({ detail });
    const component = h.routeDebugElement?.componentInstance as { menuOf(id: string): { key: string }[] };
    expect(component.menuOf('p1').map((i) => i.key)).toEqual(['withdraw']);
  });

  it('withdraws the request from the row menu and reads the shift again', async () => {
    const detail = shiftDetail({ movements: [{ ...shiftDetail().movements[1], id: 'p1', status: 'PENDING', hasReceipt: false }], pendingExpenses: 1 });
    const h = await open({ detail });
    const component = h.routeDebugElement?.componentInstance as { onMenu(id: string, key: string): void };
    component.onMenu('p1', 'withdraw');
    http.expectOne('/api/v1/sales/cash-movements/p1/withdraw').flush({});
    http.expectOne(SHIFT).flush(shiftDetail());
    h.detectChanges();
    expect(text(h)).not.toContain('Egresos esperando aprobación');
  });

  it('shows the error state with a retry', async () => {
    const h = await open({ current: 'error' });
    expect(text(h)).toContain('No pudimos cargar tu turno');
    expect(root(h).querySelector('[data-testid="cash-close"]')).toBeNull();
  });

  it('shows the error state when the shift cannot be read', async () => {
    const h = await open({ detail: 'error' });
    expect(text(h)).toContain('No pudimos cargar tu turno');
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open({ granted: ['sales.pos.use'] });
    expect(text(h)).toContain('No tienes permiso para usar la caja');
  });

  it('shows a loading skeleton while the shift loads', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'sales/cash-register', component: CashRegisterPage },
          { path: 'sales/cash-register/open', component: Stub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { can: () => true, context: () => ({ user: { id: 'u1' } }) } },
        { provide: RS_PERMISSIONS, useValue: signal(new Set(['sales.cash-register.open'])) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/cash-register');
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(CURRENT).flush({ shift: null });
  });
});
