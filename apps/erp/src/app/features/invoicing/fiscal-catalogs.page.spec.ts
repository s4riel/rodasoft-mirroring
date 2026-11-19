import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { type CatalogSummary, SIAT_CATALOGS } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { FiscalCatalogsPage } from './fiscal-catalogs.page';

const BASE = '/api/v1/invoicing';

const summary = (synced = true): CatalogSummary => ({
  catalogs: SIAT_CATALOGS.map((catalog) => ({ catalog, entries: synced ? 3 : 0, syncedAt: synced ? '2026-11-16T14:00:00.000Z' : null })),
  synced,
  syncedAt: synced ? '2026-11-16T14:00:00.000Z' : null,
});

describe('FiscalCatalogsPage (FS-34)', () => {
  let http: HttpTestingController;

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'invoicing/settings/catalogs', component: FiscalCatalogsPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(['invoicing.settings.manage'])) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/settings/catalogs', FiscalCatalogsPage);
    return harness;
  }
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  /** What the page asks for after the summary: the activity and product choices and the saved activity. */
  function answerChoices() {
    http.expectOne((r) => r.url === `${BASE}/catalogs/ACTIVITY`).flush({ catalog: 'ACTIVITY', syncedAt: null, items: [{ code: '465900', description: 'VENTA', activityCode: '', active: true }], total: 1, page: 1, pageSize: 100 });
    http.expectOne((r) => r.url === `${BASE}/catalogs/PRODUCT_SERVICE`).flush({ catalog: 'PRODUCT_SERVICE', syncedAt: null, items: [], total: 0, page: 1, pageSize: 100 });
    http.expectOne(`${BASE}/fiscal-settings`).flush({ activity: { mainActivityCode: '465900', defaultProductCode: null } });
    http.expectOne((r) => r.url === `${BASE}/catalogs/LEGEND` && r.params.get('pageSize') === '100').flush({ catalog: 'LEGEND', syncedAt: null, items: [{ code: '1', description: 'Ley N° 453', activityCode: '465900', active: true }], total: 1, page: 1, pageSize: 100 });
  }

  afterEach(() => http.verify());

  it('shows each catalogue with its date and the synced state', async () => {
    const h = await open();
    http.expectOne(`${BASE}/catalogs`).flush(summary());
    answerChoices();
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(text).toContain('Actividades económicas');
    expect(text).toContain('Leyendas de facturas');
    expect(text).toContain('Sincronizado');
    expect(root(h).querySelector('[data-testid="catalogs-note"]')?.textContent).toContain('Sincronizado el');
  });

  it('says to sync first when nothing was synced', async () => {
    const h = await open();
    http.expectOne(`${BASE}/catalogs`).flush(summary(false));
    await settle(h);
    expect(root(h).textContent).toContain('Pendiente');
    expect(root(h).querySelector('[data-testid="catalogs-note"]')?.textContent).toContain('Sincroniza para poder elegir');
    expect(root(h).querySelector('#main-activity')).toBeNull();
  });

  it('syncs now and shows the new date; offline it says so and keeps the old ones', async () => {
    const h = await open();
    http.expectOne(`${BASE}/catalogs`).flush(summary(false));
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('[data-testid="catalogs-sync"]')?.click();
    http.expectOne({ method: 'POST', url: `${BASE}/catalogs/sync` }).flush({ code: 'SIAT_UNAVAILABLE', message: 'x' }, { status: 503, statusText: 'Service Unavailable' });
    await settle(h);
    expect(root(h).querySelector('[data-testid="catalogs-sync-error"]')?.textContent).toContain('Los catálogos anteriores siguen vigentes');
    root(h).querySelector<HTMLButtonElement>('[data-testid="catalogs-sync"]')?.click();
    http.expectOne({ method: 'POST', url: `${BASE}/catalogs/sync` }).flush(summary());
    answerChoices();
    await settle(h);
    expect(root(h).querySelector('[data-testid="catalogs-note"]')?.textContent).toContain('Sincronizado el');
  });

  it('opens the rows of a catalogue', async () => {
    const h = await open();
    http.expectOne(`${BASE}/catalogs`).flush(summary());
    answerChoices();
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('[data-testid="catalog-LEGEND"]')?.click();
    http.expectOne((r) => r.url === `${BASE}/catalogs/LEGEND` && r.params.get('pageSize') === '10').flush({
      catalog: 'LEGEND',
      syncedAt: '2026-11-16T14:00:00.000Z',
      items: [{ code: '1', description: 'Ley N° 453', activityCode: '465900', active: true }],
      total: 1,
      page: 1,
      pageSize: 10,
    });
    await settle(h);
    expect(root(h).querySelector('[data-testid="catalog-entries"]')?.textContent).toContain('Ley N° 453');
  });

  it('shows the error state with a retry', async () => {
    const h = await open();
    http.expectOne(`${BASE}/catalogs`).flush({ code: 'X', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(root(h).textContent).toContain('No pudimos cargar los catálogos');
  });
});
