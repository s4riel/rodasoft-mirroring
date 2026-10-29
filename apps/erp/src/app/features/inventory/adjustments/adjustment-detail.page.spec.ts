import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { AdjustmentDetail } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { AdjustmentDetailPage } from './adjustment-detail.page';

const URL = '/api/v1/inventory/adjustments/a1';

const detail = (over: Partial<AdjustmentDetail> = {}): AdjustmentDetail => ({
  id: 'a1',
  number: 'AJ-000007',
  status: 'APPROVED',
  source: 'MANUAL',
  warehouse: { id: 'w1', name: 'Principal', branch: { id: 'b1', name: 'Huayna Kapac' } },
  reason: 'Otro',
  note: 'caja mojada',
  lines: 2,
  value: '35.00',
  createdBy: 'Ana',
  createdAt: '2026-10-28T15:00:00.000Z',
  approvedBy: null,
  approvedAt: '2026-10-28T15:00:00.000Z',
  items: [
    { productId: 'p1', sku: 's1', manufacturerCode: 'ABC-1', name: 'Rodamiento', brand: 'SKF', kind: 'IN', enteredQuantity: 4, delta: 4, unitCost: '5.0000', value: '20.00' },
    { productId: 'p2', sku: 's2', manufacturerCode: 'ABC-2', name: 'Filtro', brand: 'Mann', kind: 'COUNT', enteredQuantity: 7, delta: -3, unitCost: '5.0000', value: '15.00' },
  ],
  ...over,
});

describe('AdjustmentDetailPage', () => {
  let http: HttpTestingController;

  async function open(granted = ['inventory.adjustments.create']) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'adjustments/:id', component: AdjustmentDetailPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/adjustments/a1', AdjustmentDetailPage);
    return harness;
  }

  const text = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows the header, the note and the lines with the change each made', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);

    expect(text(h)).toContain('AJ-000007');
    expect(text(h)).toContain('Aplicado');
    expect(text(h)).toContain('Huayna Kapac · Principal');
    expect(text(h)).toContain('caja mojada');
    expect(text(h)).toContain('Aplicado automáticamente');
    expect(text(h)).toContain('ABC-1');
    expect(text(h)).toContain('Entrada');
    expect(text(h)).toContain('+4');
    expect(text(h)).toContain('Conteo');
    expect(text(h)).toContain('-3');
    expect(text(h)).toContain('Bs 35,00');
  });

  it('leaves the value out when the viewer cannot see costs', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ value: null, items: detail().items.map((i) => ({ ...i, unitCost: null, value: null })) }));
    await settle(h);
    expect(text(h)).not.toContain('Valor');
  });

  it('shows a loading skeleton, then a not-found state for a missing adjustment', async () => {
    const h = await open();
    h.detectChanges();
    expect((h.routeNativeElement as HTMLElement).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(URL).flush({ code: 'ADJUSTMENT_NOT_FOUND', message: 'Adjustment not found' }, { status: 404, statusText: 'Not Found' });
    await settle(h);
    expect(text(h)).toContain('No encontramos el ajuste');
  });

  it('shows an error state with a retry', async () => {
    const h = await open();
    http.expectOne(URL).flush({ code: 'SERVER', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar el ajuste');
    const retry = Array.from((h.routeNativeElement as HTMLElement).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar'));
    retry?.click();
    http.expectOne(URL).flush(detail());
    await settle(h);
    expect(text(h)).toContain('AJ-000007');
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open([]);
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver ajustes');
    http.expectNone(URL);
  });
});
