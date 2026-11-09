import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { SaleReturnList, SaleReturnSummary } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ReturnsPage } from './returns.page';

const item = (over: Partial<SaleReturnSummary> = {}): SaleReturnSummary => ({
  id: 'r1',
  number: 'DEV-000001',
  saleId: 's1',
  saleNumber: 'V-000231',
  customerName: 'Industrias Demo',
  pieces: 2,
  total: '245.00',
  status: 'APPROVED',
  creditNoteStatus: 'PENDING',
  createdAt: '2026-11-09T15:00:00.000Z',
  ...over,
});
const response = (items: SaleReturnSummary[]): SaleReturnList => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  totalAmount: '245.00',
  kpis: { monthCount: 3, monthAmount: '600.00', pendingCount: 1, scrapPieces: 4 },
});

describe('ReturnsPage', () => {
  let http: HttpTestingController;

  async function open(url = '/returns', permissions = ['sales.returns.manage']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'returns', component: ReturnsPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(permissions)) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, ReturnsPage);
    return harness;
  }
  const flush = (h: RouterTestingHarness, body: SaleReturnList, init?: { status: number; statusText: string }) => {
    http.expectOne((r) => r.url === '/api/v1/sales/returns').flush(body, init);
    h.detectChanges();
  };
  const text = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).textContent ?? '';
  afterEach(() => http.verify());

  it('lists the returns with the four KPIs and the Spanish status', async () => {
    const h = await open();
    expect(h.routeNativeElement?.querySelector('[aria-busy="true"]')).not.toBeNull();
    flush(h, response([item(), item({ id: 'r2', number: 'DEV-000002', status: 'PENDING_APPROVAL', creditNoteStatus: null }), item({ id: 'r3', number: 'DEV-000003', creditNoteStatus: 'VALID' })]));
    const t = text(h);
    expect(t).toContain('DEV-000001');
    expect(t).toContain('V-000231');
    expect(t).toContain('2 piezas');
    expect(t).toContain('Aprobada');
    expect(t).toContain('Por aprobar');
    expect(t).toContain('Nota emitida');
    expect(t).toContain('Este mes');
    expect(t).toContain('Monto devuelto');
    expect(t).toContain('A merma');
  });

  it('sends the status filter of the URL', async () => {
    const h = await open('/returns?status=PENDING_APPROVAL');
    const request = http.expectOne((r) => r.url === '/api/v1/sales/returns');
    expect(request.request.params.get('status')).toBe('PENDING_APPROVAL');
    request.flush(response([]));
    h.detectChanges();
    expect(text(h)).toContain('No encontramos devoluciones');
  });

  it('explains that a return is born from a sale when there are none', async () => {
    const h = await open();
    flush(h, response([]));
    expect(text(h)).toContain('Aún no hay devoluciones');
  });

  it('shows the new-return button only with the permission', async () => {
    const allowed = await open();
    flush(allowed, response([]));
    expect(allowed.routeNativeElement?.querySelector('[data-testid="returns-new"]')).not.toBeNull();
    TestBed.resetTestingModule();
    const denied = await open('/returns', ['sales.returns.approve']);
    flush(denied, response([]));
    expect(denied.routeNativeElement?.querySelector('[data-testid="returns-new"]')).toBeNull();
  });

  it('shows the error state and the no-permission state', async () => {
    const failed = await open();
    flush(failed, response([]), { status: 500, statusText: 'Error' });
    expect(text(failed)).toContain('No pudimos cargar las devoluciones');
    TestBed.resetTestingModule();
    const denied = await open();
    flush(denied, response([]), { status: 403, statusText: 'Forbidden' });
    expect(text(denied)).toContain('No tienes permiso para ver las devoluciones');
  });
});
