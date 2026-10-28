import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { WarehouseListItem, WarehouseListResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { WarehousesPage } from './warehouses.page';

const LIST_URL = '/api/v1/inventory/warehouses';

const item = (over: Partial<WarehouseListItem> = {}): WarehouseListItem => ({
  id: 'w1',
  code: 'HK-01',
  name: 'Principal',
  branch: { id: 'b1', name: 'Huayna Kapac' },
  isMain: true,
  visibleInStore: true,
  status: 'ACTIVE',
  productCount: 12,
  totalUnits: 340,
  ...over,
});

const response = (items: WarehouseListItem[], over: Partial<WarehouseListResponse> = {}): WarehouseListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  ...over,
});

@Component({ template: '' })
class StubPage {}

const VIEW = 'inventory.products.view';
const MANAGE = 'inventory.warehouses.manage';

describe('WarehousesPage', () => {
  let http: HttpTestingController;

  async function open(url = '/warehouses', granted = [VIEW, MANAGE]) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'warehouses', component: WarehousesPage },
          { path: 'inventory/warehouses/new', component: StubPage },
          { path: 'inventory/warehouses/:id/edit', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        {
          provide: ContextStore,
          useValue: { can: (p: string) => permissions.has(p), branches: () => [{ id: 'b1', name: 'Huayna Kapac' }, { id: 'b2', name: 'Sacaba' }] },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, WarehousesPage);
    return harness;
  }

  const flushList = (body: WarehouseListResponse) => http.expectOne((r) => r.url === LIST_URL).flush(body);
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows a skeleton while the list loads', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy=true]')).not.toBeNull();
    flushList(response([item()]));
    await settle(h);
    expect(root(h).querySelector('[aria-busy=true]')).toBeNull();
  });

  it('renders a row per warehouse with the main flag, store visibility, products, units and status', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 'w2', code: 'HK-02', name: 'Depósito', isMain: false, visibleInStore: false, status: 'INACTIVE', productCount: 0, totalUnits: 0 })], { total: 12 }));
    await settle(h);

    const rows = root(h).querySelectorAll('rs-doc-table tbody tr');
    expect(rows).toHaveLength(2);
    const first = rows[0].textContent ?? '';
    expect(first).toContain('HK-01');
    expect(first).toContain('Huayna Kapac');
    expect(first).toContain('Principal');
    expect(first).toContain('Visible');
    expect(first).toContain('340');
    expect(first).toContain('Activo');
    const second = rows[1].textContent ?? '';
    expect(second).toContain('Oculto');
    expect(second).toContain('Inactivo');
    expect(text(h)).toContain('1–2 de 12 almacenes');
  });

  it('asks the API with the filters of the URL, ten per page', async () => {
    const h = await open('/warehouses?branchId=b2&status=INACTIVE&q=dep&page=2');
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.get('branchId')).toBe('b2');
    expect(req.request.params.get('status')).toBe('INACTIVE');
    expect(req.request.params.get('q')).toBe('dep');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush(response([item()], { total: 11, page: 2 }));
    await settle(h);
  });

  it('puts a filter in the URL, back on page 1, and asks again', async () => {
    const h = await open('/warehouses?page=3');
    flushList(response([item()], { total: 30, page: 3 }));
    await settle(h);

    const branch = h.fixture.debugElement.queryAll((d) => d.name === 'rs-select')[0];
    branch.triggerEventHandler('valueChange', 'b2');
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/warehouses?branchId=b2');
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.get('branchId')).toBe('b2');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(response([item()]));
    await settle(h);
  });

  it('shows the first-use empty state with the create action', async () => {
    const h = await open();
    flushList(response([]));
    await settle(h);
    expect(text(h)).toContain('Aún no hay almacenes');
    expect(Array.from(root(h).querySelectorAll('button')).some((b) => b.textContent?.includes('Nuevo almacén'))).toBe(true);
  });

  it('shows the no-results state, with a way to clear the filters, when filters leave nothing', async () => {
    const h = await open('/warehouses?status=INACTIVE');
    flushList(response([]));
    await settle(h);
    expect(text(h)).toContain('No encontramos almacenes');
    expect(text(h)).toContain('Limpiar filtros');
  });

  it('shows the error state and retries', async () => {
    const h = await open();
    http.expectOne((r) => r.url === LIST_URL).flush({ code: 'ERROR', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(root(h).querySelector('[role=alert]')?.textContent).toContain('No pudimos cargar los almacenes');

    const retry = Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar'));
    retry?.click();
    flushList(response([item()]));
    await settle(h);
    expect(root(h).querySelectorAll('rs-doc-table tbody tr')).toHaveLength(1);
  });

  it('shows the no-permission state, and does not call the API, without the view permission', async () => {
    const h = await open('/warehouses', []);
    await settle(h);
    http.expectNone((r) => r.url === LIST_URL);
    expect(text(h)).toContain('No tienes permiso para ver almacenes');
  });

  it('hides the create and edit actions without the manage permission', async () => {
    const h = await open('/warehouses', [VIEW]);
    flushList(response([item()]));
    await settle(h);
    expect(text(h)).not.toContain('Nuevo almacén');
    expect(root(h).querySelector('[aria-label="Editar HK-01"]')).toBeNull();
  });

  it('opens the edit form of the row', async () => {
    const h = await open();
    flushList(response([item()]));
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('[aria-label="Editar HK-01"]')?.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/warehouses/w1/edit');
  });
});
