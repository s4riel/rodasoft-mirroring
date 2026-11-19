import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SiatSystemStatus } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { SiatStatusPage } from './siat-status.page';

const URL = '/api/v1/invoicing/system-status';

const status = (over: Partial<SiatSystemStatus> = {}): SiatSystemStatus => ({
  connection: 'ONLINE',
  checkedAt: '2026-11-16T15:00:00.000Z',
  environment: 'TEST',
  modality: 'ELECTRONIC_ONLINE',
  cuis: 'OK',
  cufd: 'OK',
  lastSyncedAt: '2026-11-16T14:52:00.000Z',
  warnHours: 6,
  signatureHealth: 'OK',
  tokenHealth: 'OK',
  signatureWarnDays: 30,
  notIssued: 0,
  branches: [
    {
      branchId: 'b1',
      branchCode: 0,
      branchName: 'Huayna Kapac',
      pointsOfSale: [
        {
          id: 'p0',
          code: 0,
          name: 'Caja 1',
          cuis: { present: true, expiresAt: '2027-11-14T03:59:00.000Z', health: 'OK' },
          cufd: { present: true, expiresAt: '2026-11-17T03:59:00.000Z', health: 'OK' },
          lastSyncedAt: '2026-11-16T14:52:00.000Z',
          issuedToday: 4,
        },
        {
          id: 'p1',
          code: 1,
          name: 'Caja 2',
          cuis: { present: false, expiresAt: null, health: 'EXPIRED' },
          cufd: { present: false, expiresAt: null, health: 'EXPIRED' },
          lastSyncedAt: null,
          issuedToday: 0,
        },
      ],
    },
  ],
  ...over,
});

describe('SiatStatusPage (FS-05, FS-11)', () => {
  let http: HttpTestingController;

  async function open(permissions: string[] = ['invoicing.invoices.view', 'invoicing.settings.manage']) {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'invoicing/status', component: SiatStatusPage }]), provideHttpClient(), provideHttpClientTesting(), { provide: RS_PERMISSIONS, useValue: signal(new Set(permissions)) }],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/status', SiatStatusPage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const button = (h: RouterTestingHarness, testId: string) => root(h).querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);

  afterEach(() => http.verify());

  it('shows a skeleton while it loads', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(URL).flush(status());
  });

  it('online: the headline, the summary and one row per point of sale with the health of its codes', async () => {
    const h = await open();
    http.expectOne(URL).flush(status());
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(text).toContain('Estado del sistema SIAT');
    expect(root(h).querySelector('[data-testid="siat-headline"]')?.textContent).toContain('SIAT en línea');
    expect(text).toContain('En línea');
    expect(text).toContain('Huayna Kapac');
    expect(text).toContain('Vigente');
    expect(text).toContain('Sin código · Sin código');
    expect(text).toContain('Vencido');
    expect(text).toContain('Vence 13/11/2027');
    // the total row adds what was issued today
    expect(text).toContain('2 puntos de venta');
  });

  it('offline: the error headline says documents wait and are not retried', async () => {
    const h = await open();
    http.expectOne(URL).flush(status({ connection: 'OFFLINE', notIssued: 3 }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="siat-headline"]')?.textContent).toContain('Error de conexión con el SIAT');
    expect(root(h).querySelector('[data-testid="siat-not-issued"]')?.textContent).toContain('3 documentos');
  });

  it('warns when the SIAT answers but a code is about to expire', async () => {
    const h = await open();
    http.expectOne(URL).flush(status({ cufd: 'EXPIRING' }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="siat-headline"]')?.textContent).toContain('no implica autorización para emitir');
  });

  it('the bottom "Renovar CUFD" renews every point of sale whose CUFD is not valid, then reloads', async () => {
    const h = await open();
    http.expectOne(URL).flush(status());
    await settle(h);
    // only the second point of sale has no CUFD: the first one is fine
    button(h, 'siat-renew-all')?.click();
    http.expectOne('/api/v1/invoicing/points-of-sale/p1/renew-cufd').flush({});
    await settle(h);
    http.expectOne(URL).flush(status());
    await settle(h);
  });

  it('an offline SIAT shows its message when renewing and keeps the page', async () => {
    const h = await open();
    http.expectOne(URL).flush(status());
    await settle(h);
    button(h, 'siat-renew-all')?.click();
    http.expectOne('/api/v1/invoicing/points-of-sale/p1/renew-cufd').flush({ code: 'SIAT_UNAVAILABLE', message: 'x' }, { status: 503, statusText: 'Service Unavailable' });
    await settle(h);
    http.expectOne(URL).flush(status());
    await settle(h);
    expect(root(h).textContent).toContain('Estado del sistema SIAT');
  });

  it('the row menu renews one point of sale', async () => {
    const h = await open();
    http.expectOne(URL).flush(status());
    await settle(h);
    const page = h.routeDebugElement?.componentInstance as { onAction(point: unknown, key: string): void; points(): unknown[] };
    page.onAction((page.points() as unknown[])[0], 'renew');
    http.expectOne('/api/v1/invoicing/points-of-sale/p0/renew-cufd').flush({});
    await settle(h);
    http.expectOne(URL).flush(status());
    await settle(h);
  });

  it('tests the connection and reloads the status', async () => {
    const h = await open();
    http.expectOne(URL).flush(status({ connection: 'OFFLINE' }));
    await settle(h);
    button(h, 'siat-test-connection')?.click();
    http.expectOne('/api/v1/invoicing/test-connection').flush({ connection: 'ONLINE', checkedAt: '2026-11-16T15:05:00.000Z' });
    await settle(h);
    http.expectOne(URL).flush(status());
    await settle(h);
    expect(root(h).querySelector('[data-testid="siat-headline"]')?.textContent).toContain('SIAT en línea');
  });

  it('without the settings permission it only reads: no test or renew buttons', async () => {
    const h = await open(['invoicing.invoices.view']);
    http.expectOne(URL).flush(status());
    await settle(h);
    expect(button(h, 'siat-test-connection')).toBeNull();
    expect(button(h, 'siat-renew-all')).toBeNull();
  });

  it('shows the empty, error and no-permission states', async () => {
    const h = await open();
    http.expectOne(URL).flush(status({ branches: [] }));
    await settle(h);
    expect(root(h).textContent).toContain('No hay puntos de venta SIAT');
  });
});
