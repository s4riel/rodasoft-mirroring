import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { VatPeriodRow, VatPeriodsResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { VatPeriodsPage } from './vat-periods.page';

const URL = '/api/v1/invoicing/vat-periods';

const row = (over: Partial<VatPeriodRow> = {}): VatPeriodRow => ({
  period: '2026-10',
  status: 'OPEN',
  salesTotal: '1280.00',
  fiscalDebit: '166.40',
  purchasesTotal: '500.00',
  vatCredit: '65.00',
  salesCount: 5,
  purchasesCount: 4,
  closedAt: null,
  filedAt: null,
  actions: ['VIEW_BOOKS', 'CLOSE'],
  ...over,
});

const periods = (items: VatPeriodRow[] = [row({ period: '2026-11', actions: ['VIEW_BOOKS'] }), row(), row({ period: '2026-09', status: 'FILED', closedAt: '2026-10-05T14:00:00.000Z', actions: ['VIEW_BOOKS'] })]): VatPeriodsResponse => ({
  items,
  kpis: { current: '2026-11', lastClosed: '2026-09', filed: 1, total: items.length },
});

@Component({ template: '' })
class StubPage {}

describe('VatPeriodsPage (FS-37)', () => {
  let http: HttpTestingController;

  async function open() {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'invoicing/books/periods', component: VatPeriodsPage }, { path: 'invoicing/books', component: StubPage }]), provideHttpClient(), provideHttpClientTesting(), { provide: RS_PERMISSIONS, useValue: signal(new Set(['invoicing.vat-books.view', 'invoicing.vat-books.close'])) }] });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/books/periods', VatPeriodsPage);
    return harness;
  }
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows a skeleton while it loads', async () => {
    const h = await open();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(URL).flush(periods());
  });

  it('lists one row per period with its status and the indicators', async () => {
    const h = await open();
    http.expectOne(URL).flush(periods());
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(text).toContain('Noviembre 2026');
    expect(text).toContain('Octubre 2026');
    expect(text).toContain('Abierto');
    expect(text).toContain('Presentado');
    expect(root(h).querySelector('[data-testid="periods-kpis"]')?.textContent).toContain('1 de 3');
    expect(root(h).querySelector('[data-testid="periods-kpis"]')?.textContent).toContain('Septiembre 2026');
    expect(root(h).querySelector('[data-testid="periods-kpis"]')?.textContent).toContain('Estado');
    expect(text).toContain('Facturas de venta');
    expect(text).toContain('3 períodos');
  });

  it('the header button closes the oldest open period whose month is over', async () => {
    const h = await open();
    http.expectOne(URL).flush(periods());
    await settle(h);
    const button = root(h).querySelector<HTMLButtonElement>('[data-testid="periods-close"]');
    expect(button?.disabled).toBe(false);
    button?.click();
    await settle(h);
    http.expectOne('/api/v1/invoicing/vat-periods/2026-10/blockers').flush({ period: '2026-10', error: null, blockers: [], cancellationRequests: 0, documents: [], purchases: [] });
    await settle(h);
    expect(root(h).textContent).toContain('Cerrar Octubre 2026');
  });

  it('says there is no last close when none was made', async () => {
    const h = await open();
    http.expectOne(URL).flush({ ...periods([row({ period: '2026-11' })]), kpis: { current: '2026-11', lastClosed: null, filed: 0, total: 1 } });
    await settle(h);
    expect(root(h).querySelector('[data-testid="periods-kpis"]')?.textContent).toContain('Ninguno');
  });

  it('shows the error state with a retry, and the no-permission state', async () => {
    const h = await open();
    http.expectOne(URL).flush({ code: 'INTERNAL', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(root(h).textContent).toContain('No pudimos cargar los períodos');
    root(h).querySelector<HTMLButtonElement>('section[role="alert"] button')?.click();
    http.expectOne(URL).flush({ code: 'FORBIDDEN', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(root(h).textContent).toContain('No tienes permiso para ver los períodos IVA');
  });
});
