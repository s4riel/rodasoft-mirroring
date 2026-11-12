import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { RS_PERMISSIONS, ToastService } from '@rodasoft/ui';
import { ContextStore } from '../../core/context.store';
import { SalesLayoutPage } from './sales-layout.page';
import { SALES_ROUTES } from './sales.routes';

@Component({ template: '<p>page</p>' })
class StubPage {}

const CASHIER = ['sales.pos.use', 'sales.cash-register.open', 'sales.quotes.manage', 'sales.orders.manage', 'sales.cancellations.request', 'sales.returns.manage'];
const ALL = [...CASHIER, 'sales.customers.manage', 'sales.prices.edit', 'sales.cancellations.approve', 'sales.cash-register.review'];

describe('sales section', () => {
  const warning = jest.fn();

  function setup(granted: string[], loaded = true) {
    warning.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'sales', children: SALES_ROUTES }, { path: '', component: StubPage }]),
        // the POS and Caja tabs are real screens now: they call the API when opened
        provideHttpClient(),
        provideHttpClientTesting(),
        // Ventas realizadas is a real screen now, and its `*rsCan` buttons read the permissions
        { provide: RS_PERMISSIONS, useValue: signal(new Set(granted)) },
        { provide: ToastService, useValue: { warning, toasts: () => [], dismiss: jest.fn() } },
        {
          provide: ContextStore,
          useValue: {
            can: (p: string) => granted.includes(p),
            currentBranch: () => null,
            context: signal(loaded ? { user: { name: 'Ana' } } : null),
            permissions: signal(new Set(granted)),
          },
        },
      ],
    });
  }

  const tabsText = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).querySelector('rs-sub-nav')?.textContent ?? '';
  const hasTab = (h: RouterTestingHarness, route: string) =>
    (h.routeNativeElement as HTMLElement).querySelector(`rs-sub-nav a[href="${route}"]`) !== null;

  it('shows every tab to a user with every permission', async () => {
    setup(ALL);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/history', SalesLayoutPage);
    h.detectChanges();
    for (const label of ['Punto de venta', 'Cotizaciones', 'Pedidos', 'Ventas realizadas', 'Devoluciones', 'Caja', 'Clientes', 'Precios y descuentos', 'Aprobaciones']) {
      expect(tabsText(h)).toContain(label);
    }
  });

  it('hides the tabs the permissions do not allow: a cashier does not see Precios or Aprobaciones', async () => {
    setup(CASHIER);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/history', SalesLayoutPage);
    h.detectChanges();
    expect(tabsText(h)).toContain('Punto de venta');
    expect(hasTab(h, '/sales/prices')).toBe(false);
    expect(hasTab(h, '/sales/customers')).toBe(false);
    expect(hasTab(h, '/sales/approvals')).toBe(false);
  });

  it('shows Aprobaciones with either approval permission', async () => {
    for (const permission of ['sales.cancellations.approve', 'sales.cash-register.review']) {
      TestBed.resetTestingModule();
      setup([permission, 'sales.pos.use']);
      const h = await RouterTestingHarness.create();
      await h.navigateByUrl('/sales/history', SalesLayoutPage);
      h.detectChanges();
      expect(hasTab(h, '/sales/approvals')).toBe(true);
    }
  });

  it('shows Caja to who only reviews cash differences, and opens it on the shift history (HU-VEN-24, HU-VEN-25)', async () => {
    setup(['sales.cash-register.review']);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/cash-register');
    h.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/history');
    expect(hasTab(h, '/sales/cash-register')).toBe(true);
    TestBed.inject(HttpTestingController).expectOne((r) => r.url === '/api/v1/sales/cash-shifts');
  });

  it('keeps a cashier on their own shift when opening Caja', async () => {
    setup(CASHIER);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/cash-register');
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register');
    TestBed.inject(HttpTestingController).expectOne('/api/v1/sales/cash-shifts/current');
  });

  it('opens Precios y descuentos on the price list (HU-VEN-26)', async () => {
    setup(['sales.prices.edit']);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/prices');
    h.detectChanges();
    expect(TestBed.inject(Router).url).toBe('/sales/prices');
    expect((h.routeNativeElement as HTMLElement).querySelector('rs-price-list-page')).not.toBeNull();
    TestBed.inject(HttpTestingController).expectOne((r) => r.url === '/api/v1/sales/prices');
  });

  it('opens /sales on the first tab the user may see', async () => {
    setup(['sales.quotes.manage', 'sales.prices.edit']);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales');
    expect(TestBed.inject(Router).url).toBe('/sales/quotes');
  });

  it('a role with only the permission to see every sale still reaches Ventas realizadas', async () => {
    setup(['sales.history.view-all']);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales');
    expect(TestBed.inject(Router).url).toBe('/sales/history');
  });

  it('sends a user without any sales permission home, from /sales and from a tab', async () => {
    setup(['inventory.products.view']);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales');
    expect(TestBed.inject(Router).url).toBe('/');
    await h.navigateByUrl('/sales/prices');
    expect(TestBed.inject(Router).url).toBe('/');
    expect(warning).toHaveBeenCalledWith('No tienes permiso para acceder a esta sección de ventas.');
  });

  it('refuses a tab by URL without its permission, and lets one with it through', async () => {
    setup(CASHIER);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/prices');
    expect(TestBed.inject(Router).url).toBe('/');
    await h.navigateByUrl('/sales/quotes');
    expect(TestBed.inject(Router).url).toBe('/sales/quotes');
  });

  it('shows a no-access note instead of an empty tab bar when the role holds no sales permission', async () => {
    setup(['inventory.products.view']);
    TestBed.inject(Router).resetConfig([{ path: 'bare', component: SalesLayoutPage }]);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/bare', SalesLayoutPage);
    h.detectChanges();
    const el = h.routeNativeElement as HTMLElement;
    expect(el.textContent).toContain('Sin acceso a ventas');
    expect(el.querySelector('rs-sub-nav')).toBeNull();
  });

  it('lets the route through while the context is still loading: the API checks the permission', async () => {
    setup([], false);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/prices');
    expect(TestBed.inject(Router).url).toBe('/sales/prices');
    expect(warning).not.toHaveBeenCalled();
  });
});
