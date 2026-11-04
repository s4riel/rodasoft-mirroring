import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CashRegisterOption, CurrentCashShift } from '@rodasoft/domain';
import { ToastService } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { CashOpeningPage } from './cash-opening.page';

const REGISTERS = '/api/v1/sales/cash-registers';
const CURRENT = '/api/v1/sales/cash-shifts/current';
const SHIFTS = '/api/v1/sales/cash-shifts';

const register = (over: Partial<CashRegisterOption> = {}): CashRegisterOption => ({
  id: 'r1',
  name: 'Caja 1',
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Principal' },
  openShift: null,
  lastClose: null,
  ...over,
});

const ownShift: CurrentCashShift = {
  id: 's1',
  openingFloat: '100.00',
  openedAt: '2026-11-04T12:00:00.000Z',
  openedBy: { id: 'u1', name: 'Ana Cajera' },
  register: { id: 'r1', name: 'Caja 1' },
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Principal' },
};

@Component({ template: '' })
class Stub {}

describe('CashOpeningPage', () => {
  let http: HttpTestingController;
  let toast: ToastService;

  async function open(options: { granted?: string[]; registers?: CashRegisterOption[]; current?: CurrentCashShift | null } = {}) {
    const granted = new Set(options.granted ?? ['sales.cash-register.open']);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'sales/cash-register/open', component: CashOpeningPage },
          { path: 'sales/pos', component: Stub },
          { path: 'sales', component: Stub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ContextStore,
          useValue: { can: (p: string) => granted.has(p), context: signal({ user: { name: 'Ana Cajera' } }), currentBranch: () => null },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    toast = TestBed.inject(ToastService);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/sales/cash-register/open');
    if (granted.has('sales.cash-register.open')) {
      http.expectOne(REGISTERS).flush({ items: options.registers ?? [register()] });
      http.expectOne(CURRENT).flush({ shift: options.current ?? null });
    }
    await settle(harness);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  async function typeFloat(h: RouterTestingHarness, value: string) {
    const el = root(h).querySelector<HTMLInputElement>('#cash-float')!;
    el.value = value;
    el.dispatchEvent(new Event('input'));
    await settle(h);
  }
  async function submit(h: RouterTestingHarness) {
    root(h).querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle(h);
  }

  afterEach(() => http.verify());

  it('lists the registers, preselects the only free one and shows the cashier as the logged-in user', async () => {
    const h = await open();
    expect(text(h)).toContain('Apertura de caja');
    expect(text(h)).toContain('Caja 1 · Huayna Kapac · cuenta el efectivo antes de empezar a vender');
    // the cashier is the logged-in user, in a locked select
    const cashier = root(h).querySelector<HTMLElement>('#cash-cashier')!;
    expect(cashier.textContent).toContain('Ana Cajera');
    expect(cashier.hasAttribute('disabled') || cashier.getAttribute('aria-disabled') === 'true').toBe(true);
    expect(text(h)).toContain('Fondo de caja: PENDIENTE del cliente.');
    expect(text(h)).toContain('Último cierre de esta caja');
    expect(text(h)).toContain('Sin cierres anteriores');
    expect(text(h)).toContain('Al abrir, el punto de venta queda habilitado');
  });

  it('shows the last close of the selected register with the cash left in it', async () => {
    const h = await open({
      registers: [register({ lastClose: { shiftId: 'x', closedAt: '2026-10-15T22:30:00.000Z', closedByName: 'Luis', differenceAmount: '0.00', closingFloat: '500.00' } })],
    });
    expect(text(h)).toContain('Último cierre de esta caja');
    expect(text(h)).toContain('15/10/2026 18:30 · Luis · sin diferencia · Bs 500,00 dejados en caja');
  });

  it('refuses an empty float with a message and sends nothing', async () => {
    const h = await open();
    await submit(h);
    expect(text(h)).toContain('Ingresa el efectivo inicial.');
  });

  it('refuses a float with more than 2 decimals', async () => {
    const h = await open();
    await typeFloat(h, '10,123');
    await submit(h);
    // the numeric directive only filters keystrokes; pasted or autofilled text is checked by the form
    expect(text(h)).toContain('Usa como máximo 2 decimales.');
  });

  it('opens the shift with the float as a decimal string, then goes to the POS with a toast', async () => {
    const h = await open();
    const success = jest.spyOn(toast, 'success');
    await typeFloat(h, '500,00');
    await submit(h);

    const req = http.expectOne(SHIFTS);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ registerId: 'r1', openingFloat: '500.00' });
    req.flush({ shift: ownShift, floatMismatch: false });
    await settle(h);

    expect(success).toHaveBeenCalledWith('Caja abierta');
    expect(TestBed.inject(Router).url).toBe('/sales/pos');
  });

  it('asks to choose a register when several are free', async () => {
    const h = await open({ registers: [register(), register({ id: 'r2', name: 'Caja 2' })] });
    await typeFloat(h, '100');
    await submit(h);
    expect(text(h)).toContain('Elige la caja que vas a abrir.');
  });

  it('marks the registers already in use as taken and warns when all of them are', async () => {
    const h = await open({ registers: [register({ openShift: { id: 's9', openedAt: '2026-11-04T12:00:00.000Z', openedByName: 'Luis' } })] });
    expect(text(h)).toContain('Todas las cajas de la sucursal están en uso');
  });

  it('shows the Spanish message of an API error and keeps the form', async () => {
    const h = await open();
    await typeFloat(h, '500');
    await submit(h);
    http.expectOne(SHIFTS).flush({ code: 'CASH_SHIFT_ALREADY_OPEN_FOR_USER', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await settle(h);
    expect(text(h)).toContain('Ya tienes un turno abierto en otra caja.');
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/open');
  });

  it('reloads the registers when somebody else took the one chosen', async () => {
    const h = await open();
    await typeFloat(h, '500');
    await submit(h);
    http.expectOne(SHIFTS).flush({ code: 'CASH_REGISTER_ALREADY_OPEN', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await settle(h);
    http.expectOne(REGISTERS).flush({ items: [register({ openShift: { id: 's9', openedAt: '2026-11-04T12:00:00.000Z', openedByName: 'Luis' } })] });
    http.expectOne(CURRENT).flush({ shift: null });
    await settle(h);
    expect(text(h)).toContain('Esta caja ya tiene un turno abierto');
    expect(text(h)).toContain('Todas las cajas de la sucursal están en uso');
  });

  it('tells a user who already has a shift to close it first, with a link to the POS', async () => {
    const h = await open({ current: ownShift });
    expect(text(h)).toContain('Ya tienes un turno abierto');
    expect(root(h).querySelector('form')).toBeNull();
    expect(root(h).querySelector('a[href="/sales/pos"]')).not.toBeNull();
  });

  it('shows the error state and retries', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'sales/cash-register/open', component: CashOpeningPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { can: () => true, context: signal({ user: { name: 'Ana' } }), currentBranch: () => null } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/cash-register/open');
    // forkJoin cancels the second request when the first one fails
    http.expectOne(REGISTERS).flush({}, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar las cajas');
    http.match(CURRENT); // drops the cancelled request

    Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar'))!.click();
    http.expectOne(REGISTERS).flush({ items: [register()] });
    http.expectOne(CURRENT).flush({ shift: null });
    await settle(h);
    expect(root(h).querySelector('form')).not.toBeNull();
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open({ granted: ['sales.pos.use'] });
    expect(text(h)).toContain('No tienes permiso para abrir la caja');
    expect(root(h).querySelector('form')).toBeNull();
  });
});
