import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CurrentCashShift } from '@rodasoft/domain';
import { ContextStore } from '../../../core/context.store';
import { CashRegisterPage } from './cash-register.page';

const CURRENT = '/api/v1/sales/cash-shifts/current';

const shift: CurrentCashShift = {
  id: 's1',
  openingFloat: '500.00',
  openedAt: '2026-11-04T12:00:00.000Z',
  openedBy: { id: 'u1', name: 'Ana Cajera' },
  register: { id: 'r1', name: 'Caja 1' },
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Principal' },
};

@Component({ template: '' })
class Stub {}

describe('CashRegisterPage', () => {
  let http: HttpTestingController;

  async function open(granted = ['sales.cash-register.open'], current: CurrentCashShift | null | 'error' = null) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'sales/cash-register', component: CashRegisterPage },
          { path: 'sales/cash-register/open', component: Stub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { can: (p: string) => granted.includes(p) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/cash-register');
    if (granted.includes('sales.cash-register.open')) {
      const req = http.expectOne(CURRENT);
      if (current === 'error') req.flush({}, { status: 500, statusText: 'Server Error' });
      else req.flush({ shift: current });
    }
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
    return h;
  }

  const text = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).textContent ?? '';

  afterEach(() => http.verify());

  it('goes to the opening form when the user has no open shift', async () => {
    await open();
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/open');
  });

  it('shows a summary of the open shift with a link to the POS', async () => {
    const h = await open(undefined, shift);
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register');
    expect(text(h)).toContain('Turno abierto');
    expect(text(h)).toContain('Caja 1 · Huayna Kapac');
    expect(text(h)).toContain('Ana Cajera');
    expect(text(h)).toContain('Bs 500,00');
    expect((h.routeNativeElement as HTMLElement).querySelector('a[href="/sales/pos"]')).not.toBeNull();
  });

  it('shows the error state', async () => {
    const h = await open(undefined, 'error');
    expect(text(h)).toContain('No pudimos cargar tu turno');
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open(['sales.pos.use']);
    expect(text(h)).toContain('No tienes permiso para usar la caja');
  });
});
