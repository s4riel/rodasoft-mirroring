import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { TransferDetail } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { TransferDetailPage } from './transfer-detail.page';

const URL = '/api/v1/inventory/transfers/t1';

const detail = (over: Partial<TransferDetail> = {}): TransferDetail => ({
  id: 't1',
  number: 'TR-000123',
  status: 'IN_TRANSIT',
  origin: { id: 'w1', name: 'Almacén Central', branch: { id: 'b1', name: 'Central' } },
  destination: { id: 'w2', name: 'Almacén Norte', branch: { id: 'b2', name: 'Norte' } },
  note: 'Urgente',
  lines: [
    { productId: 'p1', sku: 'RL-1', manufacturerCode: '6204-2RS', name: 'Rodamiento', brand: 'SKF', quantity: 6, receivedQuantity: 0, available: 4, unitCost: '5.0000', status: 'OK' },
  ],
  summary: { products: 1, pieces: 6, value: '30.00', errors: 0, withoutCost: 0 },
  needsApproval: false,
  createdAt: '2026-10-28T15:00:00.000Z',
  updatedAt: '2026-10-28T16:00:00.000Z',
  sentAt: '2026-10-28T16:00:00.000Z',
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('TransferDetailPage', () => {
  let http: HttpTestingController;

  async function open(granted = ['inventory.transfers.create']) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'inventory/transfers/:id', component: TransferDetailPage },
          { path: 'inventory/transfers/:id/edit', component: StubPage },
          { path: 'inventory/transfers', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), branches: () => [] } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/inventory/transfers/t1', TransferDetailPage);
    return harness;
  }
  const text = (h: RouterTestingHarness) => (h.routeNativeElement as HTMLElement).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows the status, the route, the lines and the totals frozen when it was sent', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);
    expect(text(h)).toContain('TR-000123');
    expect(text(h)).toContain('En tránsito');
    expect(text(h)).toContain('Central · Almacén Central');
    expect(text(h)).toContain('Norte · Almacén Norte');
    expect(text(h)).toContain('6204-2RS');
    expect(text(h)).toContain('Urgente');
    expect(text(h)).toContain('30,00');
  });

  it('leaves the value out when the viewer cannot see costs', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ summary: { products: 1, pieces: 6, value: null, errors: 0, withoutCost: null } }));
    await settle(h);
    expect(text(h)).not.toContain('Valor');
  });

  it('sends a draft to the editor instead of showing it', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ status: 'DRAFT' }));
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/transfers/t1/edit');
  });

  it('says the transfer does not exist, with a retry', async () => {
    const h = await open();
    http.expectOne(URL).flush({ code: 'TRANSFER_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(h);
    expect(text(h)).toContain('La transferencia ya no existe');
    expect(text(h)).toContain('Reintentar');
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open([]);
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver esta transferencia');
  });
});
