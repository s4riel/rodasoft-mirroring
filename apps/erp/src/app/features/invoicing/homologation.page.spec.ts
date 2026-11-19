import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { HomologationResponse, HomologationRow } from '@rodasoft/domain';
import { HomologationPage } from './homologation.page';

const URL = '/api/v1/invoicing/homologation';

const row = (over: Partial<HomologationRow> = {}): HomologationRow => ({
  id: 'r1',
  sku: 'RL-000001',
  code: '6205-2RS',
  name: 'Rodamiento 6205-2RS',
  brand: 'SKF',
  sinProductCode: null,
  sinActivityCode: null,
  sinUnitCode: null,
  sinDescription: null,
  status: 'PENDING',
  ...over,
});

const response = (items: HomologationRow[] = [row(), row({ id: 'r2', sku: 'RL-000002', sinProductCode: '84821', sinDescription: 'RODAMIENTOS DE BOLAS', sinUnitCode: 58, status: 'DONE' })], over: Partial<HomologationResponse> = {}): HomologationResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  progress: { total: 8, done: 6, pending: 2, percent: 75 },
  units: [{ code: 58, description: 'UNIDAD (BIENES)' }],
  catalogsSynced: true,
  withoutUnit: 1,
  syncedAt: '2026-11-16T14:00:00.000Z',
  ...over,
});

describe('HomologationPage (FS-35)', () => {
  let http: HttpTestingController;

  async function open() {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'invoicing/settings/homologation', component: HomologationPage }]), provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/settings/homologation', HomologationPage);
    return harness;
  }
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness, ms = 250) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const request = () => http.expectOne((r) => r.url === URL);

  afterEach(() => http.verify());

  it('starts with the pending products and shows the progress', async () => {
    const h = await open();
    await settle(h);
    const req = request();
    expect(req.request.params.get('status')).toBe('PENDING');
    req.flush(response());
    await settle(h, 0);
    const text = root(h).textContent ?? '';
    expect(text).toContain('RL-000001');
    expect(text).toContain('Pendiente');
    expect(text).toContain('84821 · RODAMIENTOS DE BOLAS');
    expect(root(h).querySelector('[data-testid="homologation-kpis"]')?.textContent).toContain('6 de 8');
    expect(root(h).querySelector('[data-testid="homologation-kpis"]')?.textContent).toContain('Sin unidad de medida');
    expect(root(h).querySelector('[data-testid="homologation-kpis"]')?.textContent).toContain('Última sincronización');
  });

  it('warns and blocks the import while the catalogues are not synced', async () => {
    const h = await open();
    await settle(h);
    request().flush(response([], { catalogsSynced: false }));
    await settle(h, 0);
    expect(root(h).querySelector('[data-testid="homologation-not-synced"]')).not.toBeNull();
    expect(root(h).querySelector<HTMLButtonElement>('[data-testid="homologation-import"]')?.disabled).toBe(true);
  });

  it('filters by what is typed and by status', async () => {
    const h = await open();
    await settle(h);
    request().flush(response());
    await settle(h, 0);
    const page = h.routeDebugElement!.componentInstance as { setSearch(v: string): void; setStatus(v: unknown): void };
    page.setSearch('6205');
    await settle(h);
    const searched = request();
    expect(searched.request.params.get('q')).toBe('6205');
    searched.flush(response());
    page.setStatus('DONE');
    await settle(h);
    expect(request().request.params.get('status')).toBe('DONE');
  });

  it('shows the empty state when no product matches, and the error and no-permission states', async () => {
    const h = await open();
    await settle(h);
    request().flush(response([]));
    await settle(h, 0);
    expect(root(h).textContent).toContain('No encontramos productos');
    (h.routeDebugElement!.componentInstance as { reload(): void }).reload();
    await settle(h);
    request().flush({ code: 'X', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h, 0);
    expect(root(h).textContent).toContain('No pudimos cargar los productos');
    (h.routeDebugElement!.componentInstance as { reload(): void }).reload();
    await settle(h);
    request().flush({ code: 'FORBIDDEN', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h, 0);
    expect(root(h).textContent).toContain('No tienes permiso para homologar productos');
  });
});
