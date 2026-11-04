import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CashRegisterOption, CurrentCashShift } from '@rodasoft/domain';
import { ContextStore } from '../../../core/context.store';
import { PosPage } from './pos.page';

const CURRENT = '/api/v1/sales/cash-shifts/current';
const REGISTERS = '/api/v1/sales/cash-registers';

const shift: CurrentCashShift = {
  id: 's1',
  openingFloat: '500.00',
  openedAt: '2026-11-04T12:00:00.000Z',
  openedBy: { id: 'u1', name: 'Ana Cajera' },
  register: { id: 'r1', name: 'Caja 1' },
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Principal' },
};

const register = (over: Partial<CashRegisterOption> = {}): CashRegisterOption => ({
  id: 'r1',
  name: 'Caja 1',
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Principal' },
  openShift: null,
  lastClose: null,
  ...over,
});

@Component({ template: '' })
class Stub {}

describe('PosPage', () => {
  let http: HttpTestingController;

  /** `registers` is what the registers endpoint answers when the page asks for it (closed register, may open it). */
  async function open(
    granted = ['sales.pos.use', 'sales.cash-register.open'],
    current: CurrentCashShift | null | 'error' = null,
    registers: CashRegisterOption[] | 'error' = [register()],
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'sales/pos', component: PosPage },
          { path: 'sales/cash-register/open', component: Stub },
          { path: '', component: Stub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ContextStore,
          useValue: {
            can: (p: string) => granted.includes(p),
            context: signal({ user: { name: 'Ana Cajera' } }),
            currentBranch: () => ({ id: 'b1', name: 'Huayna Kapac' }),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/pos');
    if (granted.includes('sales.pos.use')) {
      const req = http.expectOne(CURRENT);
      if (current === 'error') req.flush({}, { status: 500, statusText: 'Server Error' });
      else req.flush({ shift: current });
      if (current === null && granted.includes('sales.cash-register.open')) {
        await settle(h);
        const list = http.expectOne(REGISTERS);
        if (registers === 'error') list.flush({}, { status: 500, statusText: 'Server Error' });
        else list.flush({ items: registers });
      }
    }
    await settle(h);
    return h;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  const button = (h: RouterTestingHarness, label: string, within: ParentNode = root(h)) =>
    Array.from(within.querySelectorAll('button')).find((b) => b.textContent?.includes(label));
  const dialog = (h: RouterTestingHarness) => root(h).querySelector<HTMLElement>('[role=dialog]');
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows the "Caja cerrada" card over a dimmed backdrop and blocks the page behind it when there is no open shift', async () => {
    const h = await open();
    expect(dialog(h)).not.toBeNull();
    expect(dialog(h)!.getAttribute('aria-modal')).toBe('true');
    expect(dialog(h)!.querySelector('rs-illustration')).not.toBeNull();
    expect(dialog(h)!.querySelector('h2')!.textContent).toContain('Caja cerrada');
    expect(button(h, 'Salir del POS', dialog(h)!)).toBeDefined();
    expect(button(h, 'Abrir caja', dialog(h)!)).toBeDefined();
    expect(root(h).querySelector('section.card')!.hasAttribute('inert')).toBe(true);
    // Figma VP-14 has no close button
    expect(dialog(h)!.querySelector('[aria-label="Cerrar"]')).toBeNull();
  });

  it('names the register when the branch has only one, and says so generically otherwise', async () => {
    const one = await open();
    expect(text(one)).toContain('No tienes un turno abierto en la Caja 1. Abre tu turno para empezar a vender.');

    TestBed.resetTestingModule();
    const many = await open(undefined, null, [register(), register({ id: 'r2', name: 'Caja 2' })]);
    expect(text(many)).toContain('No tienes un turno abierto. Abre tu turno para empezar a vender.');

    TestBed.resetTestingModule();
    const failed = await open(undefined, null, 'error');
    expect(text(failed)).toContain('No tienes un turno abierto. Abre tu turno para empezar a vender.');
  });

  it('shows the POS header with the register, branch and user, and "Salir del POS" at its right', async () => {
    const h = await open();
    const header = root(h).querySelector<HTMLElement>('header.header')!;
    expect(header.querySelector('h1')!.textContent).toContain('Punto de venta');
    expect(header.textContent).toContain('Caja 1 · Huayna Kapac · Ana Cajera');
    expect(button(h, 'Salir del POS', header)).toBeDefined();
  });

  it('puts the focus on "Abrir caja" and keeps it inside the card with Tab', async () => {
    const h = await open();
    const salir = button(h, 'Salir del POS', dialog(h)!)!;
    const abrir = button(h, 'Abrir caja', dialog(h)!)!;
    expect(document.activeElement).toBe(abrir);

    abrir.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(salir);
    salir.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(abrir);
  });

  it('keeps the card after Escape: it is only left through its two buttons', async () => {
    const h = await open();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    dialog(h)!.dispatchEvent(event);
    await settle(h);
    expect(event.defaultPrevented).toBe(true);
    expect(dialog(h)).not.toBeNull();
  });

  it('"Abrir caja" goes to the opening form and "Salir del POS" goes home', async () => {
    const h = await open();
    button(h, 'Abrir caja', dialog(h)!)!.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/open');

    await h.navigateByUrl('/sales/pos');
    http.expectOne(CURRENT).flush({ shift: null });
    await settle(h);
    http.expectOne(REGISTERS).flush({ items: [register()] });
    await settle(h);
    button(h, 'Salir del POS', dialog(h)!)!.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('does not offer "Abrir caja" to a user who may not open the register, and does not ask for the registers', async () => {
    const h = await open(['sales.pos.use']);
    expect(button(h, 'Salir del POS', dialog(h)!)).toBeDefined();
    expect(button(h, 'Abrir caja')).toBeUndefined();
    expect(text(h)).toContain('Pide a un responsable de caja que abra tu turno.');
  });

  it('shows no card and names the register, branch and user when the shift is open', async () => {
    const h = await open(undefined, shift);
    expect(dialog(h)).toBeNull();
    expect(text(h)).toContain('Caja 1 · Huayna Kapac · Ana Cajera');
    expect(root(h).querySelector('section.card')!.hasAttribute('inert')).toBe(false);
  });

  it('shows the error state and retries', async () => {
    const h = await open(undefined, 'error');
    expect(text(h)).toContain('No pudimos cargar el punto de venta');
    button(h, 'Reintentar')!.click();
    http.expectOne(CURRENT).flush({ shift });
    await settle(h);
    expect(text(h)).toContain('Turno abierto');
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open(['sales.quotes.manage']);
    expect(text(h)).toContain('No tienes permiso para usar el punto de venta');
  });
});
