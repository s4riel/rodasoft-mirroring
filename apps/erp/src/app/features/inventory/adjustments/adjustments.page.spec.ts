import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { AdjustmentListItem, AdjustmentListResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { AdjustmentsPage } from './adjustments.page';

const LIST_URL = '/api/v1/inventory/adjustments';
const WAREHOUSES_URL = '/api/v1/inventory/warehouses';

const item = (over: Partial<AdjustmentListItem> = {}): AdjustmentListItem => ({
  id: 'a1',
  number: 'AJ-000007',
  status: 'APPROVED',
  source: 'MANUAL',
  warehouse: { id: 'w1', name: 'Principal', branch: { id: 'b1', name: 'Huayna Kapac' } },
  reason: 'Merma',
  lines: 3,
  value: '55.00',
  createdBy: 'Ana',
  createdAt: '2026-10-28T15:00:00.000Z',
  ...over,
});

const response = (items: AdjustmentListItem[], over: Partial<AdjustmentListResponse> = {}): AdjustmentListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  ...over,
});

@Component({ template: '' })
class StubPage {}

const CREATE = 'inventory.adjustments.create';
const APPROVE = 'inventory.adjustments.approve';

describe('AdjustmentsPage', () => {
  let http: HttpTestingController;

  async function open(url = '/adjustments', granted = [CREATE]) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'adjustments', component: AdjustmentsPage },
          { path: 'inventory/adjustments/new', component: StubPage },
          { path: 'inventory/adjustments/:id', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), branches: () => [] } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, AdjustmentsPage);
    http.expectOne((r) => r.url === WAREHOUSES_URL).flush({ items: [], total: 0, page: 1, pageSize: 100 });
    return harness;
  }

  const flushList = (body: AdjustmentListResponse) => http.expectOne((r) => r.url === LIST_URL).flush(body);
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
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    flushList(response([item()]));
  });

  it('lists the adjustments with number, warehouse, reason, value, status and a total row', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 'a2', number: 'AJ-000008', status: 'PENDING_APPROVAL', reason: 'Diferencia en transferencia' })]));
    await settle(h);

    expect(text(h)).toContain('AJ-000007');
    expect(text(h)).toContain('Huayna Kapac · Principal');
    expect(text(h)).toContain('Merma');
    expect(text(h)).toContain('Bs 55,00');
    expect(text(h)).toContain('Aplicado');
    expect(text(h)).toContain('Pendiente de aprobación');
    expect(text(h)).toContain('Total');
    expect(text(h)).toContain('1–2 de 2 ajustes');
  });

  it('links each number to its detail', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 'a2', number: 'AJ-000008' })]));
    await settle(h);
    const links = Array.from(root(h).querySelectorAll<HTMLAnchorElement>('a.number')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/inventory/adjustments/a1', '/inventory/adjustments/a2']);
  });

  it('sends the filters of the URL to the API', async () => {
    const h = await open('/adjustments?status=APPROVED&reason=DAMAGE&from=2026-10-01&page=2');
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.get('status')).toBe('APPROVED');
    expect(req.request.params.get('reason')).toBe('DAMAGE');
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush(response([item()], { total: 12, page: 2 }));
    await settle(h);
  });

  it('shows the first-use empty state with "Nuevo ajuste" for those who can create', async () => {
    const h = await open();
    flushList(response([]));
    await settle(h);
    expect(text(h)).toContain('No hay ajustes registrados');
    expect(Array.from(root(h).querySelectorAll('button')).filter((b) => b.textContent?.includes('Nuevo ajuste')).length).toBeGreaterThan(0);
  });

  it('shows "Limpiar filtros" when the filters leave nothing', async () => {
    const h = await open('/adjustments?status=REJECTED');
    flushList(response([]));
    await settle(h);
    expect(text(h)).toContain('No encontramos ajustes');
    expect(text(h)).toContain('Limpiar filtros');
  });

  it('shows the error state with a retry that loads again', async () => {
    const h = await open();
    http.expectOne((r) => r.url === LIST_URL).flush({ code: 'SERVER', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar los ajustes');
    const retry = Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar'));
    retry?.click();
    flushList(response([item()]));
    await settle(h);
    expect(text(h)).toContain('AJ-000007');
  });

  it('shows the no-permission state without calling the list when the member cannot see adjustments', async () => {
    const h = await open('/adjustments', []);
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver ajustes');
    http.expectNone((r) => r.url === LIST_URL);
  });

  it('lets an approver read the list but hides "Nuevo ajuste"', async () => {
    const h = await open('/adjustments', [APPROVE]);
    flushList(response([item()]));
    await settle(h);
    expect(text(h)).toContain('AJ-000007');
    expect(Array.from(root(h).querySelectorAll('button')).some((b) => b.textContent?.includes('Nuevo ajuste'))).toBe(false);
  });
});
