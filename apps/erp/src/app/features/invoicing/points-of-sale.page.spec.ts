import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { PointOfSaleListItem, PointOfSaleListResponse } from '@rodasoft/domain';
import { PointsOfSalePage } from './points-of-sale.page';

const URL = '/api/v1/invoicing/points-of-sale';

const point = (over: Partial<PointOfSaleListItem> = {}): PointOfSaleListItem => ({
  id: 'p1',
  branchId: 'b1',
  branchName: 'Sucursal central',
  code: 0,
  name: 'Caja principal',
  typeCode: 5,
  registerName: 'Caja principal',
  lastInvoiceNumber: 1528,
  cuisHealth: 'OK',
  cuisExpiresAt: '2027-11-01T14:00:00.000Z',
  status: 'ACTIVE',
  ...over,
});

const list = (items: PointOfSaleListItem[] = [point(), point({ id: 'p2', code: 1, name: 'Caja anexo', registerName: null, lastInvoiceNumber: null, cuisHealth: 'EXPIRED' })]): PointOfSaleListResponse => ({
  items,
  kpis: { total: items.length, active: items.filter((i) => i.status === 'ACTIVE').length, withoutCuis: items.filter((i) => i.status === 'ACTIVE' && i.cuisHealth === 'EXPIRED').length },
  types: [{ code: 5, description: 'Caja de sucursal' }],
});

describe('PointsOfSalePage (FS-32)', () => {
  let http: HttpTestingController;

  async function open() {
    TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'invoicing/settings/points-of-sale', component: PointsOfSalePage }]), provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/settings/points-of-sale', PointsOfSalePage);
    return harness;
  }
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('lists the points with their register, last invoice and CUIS, and the indicators', async () => {
    const h = await open();
    http.expectOne(URL).flush(list());
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(text).toContain('Sucursal central');
    expect(text).toContain('Caja principal');
    expect(text).toContain('001528');
    expect(text).toContain('Vigente');
    expect(text).toContain('Vencido');
    expect(root(h).querySelector('[data-testid="pos-kpis"]')?.textContent).toContain('Con CUIS vigente');
  });

  it('filters by what is typed and says when nothing matches', async () => {
    const h = await open();
    http.expectOne(URL).flush(list());
    await settle(h);
    const search = root(h).querySelector<HTMLInputElement>('input[type="search"], input')!;
    search.value = 'anexo';
    search.dispatchEvent(new Event('input'));
    await settle(h);
    expect(root(h).textContent).toContain('Caja anexo');
    expect(root(h).textContent).not.toContain('1528');
    search.value = 'zzz';
    search.dispatchEvent(new Event('input'));
    await settle(h);
    expect(root(h).textContent).toContain('No encontramos puntos de venta');
  });

  it('shows the empty, error and no-permission states', async () => {
    const h = await open();
    http.expectOne(URL).flush(list([]));
    await settle(h);
    expect(root(h).textContent).toContain('Todavía no hay puntos de venta');
    (h.routeDebugElement!.componentInstance as { load(): void }).load();
    http.expectOne(URL).flush({ code: 'X', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(root(h).textContent).toContain('No pudimos cargar los puntos de venta');
    (h.routeDebugElement!.componentInstance as { load(): void }).load();
    http.expectOne(URL).flush({ code: 'FORBIDDEN', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(root(h).textContent).toContain('No tienes permiso para ver los puntos de venta');
  });

  it('opens the new point of sale form', async () => {
    const h = await open();
    http.expectOne(URL).flush(list());
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('[data-testid="pos-new"]')?.click();
    await settle(h);
    expect(root(h).querySelector('[data-testid="pos-save"]')).not.toBeNull();
  });
});
