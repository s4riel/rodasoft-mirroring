import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { TransferListItem } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { TransfersIncomingPage } from './transfers-incoming.page';

const BASE = '/api/v1/inventory/transfers/incoming';

const item = (over: Partial<TransferListItem> = {}): TransferListItem => ({
  id: 't1',
  number: 'TR-000123',
  status: 'IN_TRANSIT',
  origin: { id: 'w1', name: 'Almacén Central', branch: { id: 'b1', name: 'Central' } },
  destination: { id: 'w2', name: 'Almacén Norte', branch: { id: 'b2', name: 'Norte' } },
  products: 2,
  pieces: 14,
  value: null,
  createdBy: 'Ana',
  sentBy: 'Ana',
  createdAt: '2026-10-28T15:00:00.000Z',
  sentAt: '2026-10-28T16:00:00.000Z',
  pendingAdjustment: null,
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('TransfersIncomingPage', () => {
  let http: HttpTestingController;

  async function open(granted = ['inventory.transfers.receive']) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'inventory/transfers/incoming', component: TransfersIncomingPage },
          { path: 'inventory/transfers/:id', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), branches: () => [] } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/inventory/transfers/incoming', TransfersIncomingPage);
    return harness;
  }
  const el = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => el(h).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const flush = (body: object) => http.expectOne((r) => r.url === BASE).flush(body);

  afterEach(() => http.verify());

  it('lists the transfers on their way with their status and a Recibir button', async () => {
    const h = await open();
    flush({ items: [item(), item({ id: 't2', number: 'TR-000124', status: 'PARTIALLY_RECEIVED' })], total: 2, page: 1, pageSize: 10 });
    await settle(h);
    expect(text(h)).toContain('TR-000123');
    expect(text(h)).toContain('En tránsito');
    expect(text(h)).toContain('Recibida parcialmente');
    expect(text(h)).toContain('Central → Norte');
    expect(text(h)).toContain('Recibir');
  });

  it('opens the receipt from the Recibir button', async () => {
    const h = await open();
    flush({ items: [item()], total: 1, page: 1, pageSize: 10 });
    await settle(h);
    (el(h).querySelector('button[aria-label="Recibir TR-000123"]') as HTMLButtonElement).click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/transfers/t1?receive=1');
  });

  it('shows the empty state when nothing is on its way', async () => {
    const h = await open();
    flush({ items: [], total: 0, page: 1, pageSize: 10 });
    await settle(h);
    expect(text(h)).toContain('No hay transferencias por recibir');
  });

  it('shows the error state with a retry', async () => {
    const h = await open();
    http.expectOne((r) => r.url === BASE).flush({ code: 'INTERNAL', message: 'Falló' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar las transferencias');
    expect(text(h)).toContain('Reintentar');
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open(['inventory.transfers.create']);
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para recibir transferencias');
  });

  it('asks the API for the chosen status', async () => {
    const h = await open();
    flush({ items: [item()], total: 1, page: 1, pageSize: 10 });
    await settle(h);
    await TestBed.inject(Router).navigate([], { queryParams: { status: 'PARTIALLY_RECEIVED' } });
    await settle(h);
    const req = http.expectOne((r) => r.url === BASE);
    expect(req.request.params.get('status')).toBe('PARTIALLY_RECEIVED');
    req.flush({ items: [], total: 0, page: 1, pageSize: 10 });
  });
});
