import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { TransferListItem, TransferListResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { TransfersPage } from './transfers.page';

const LIST_URL = '/api/v1/inventory/transfers';
const WAREHOUSES_URL = `${LIST_URL}/warehouses`;

const item = (over: Partial<TransferListItem> = {}): TransferListItem => ({
  id: 't1',
  number: 'TR-000123',
  status: 'IN_TRANSIT',
  origin: { id: 'w1', name: 'Almacén Central', branch: { id: 'b1', name: 'Huayna Kapac' } },
  destination: { id: 'w2', name: 'Almacén Norte', branch: { id: 'b2', name: 'Sacaba' } },
  products: 12,
  pieces: 340,
  value: '1280.00',
  createdBy: 'Ana',
  sentBy: 'Alberto Andia',
  createdAt: '2026-10-28T15:00:00.000Z',
  sentAt: '2026-10-28T16:00:00.000Z',
  ...over,
});

const response = (items: TransferListItem[], over: Partial<TransferListResponse> = {}): TransferListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  ...over,
});

@Component({ template: '' })
class StubPage {}

const CREATE = 'inventory.transfers.create';
const RECEIVE = 'inventory.transfers.receive';

describe('TransfersPage', () => {
  let http: HttpTestingController;

  async function open(url = '/transfers', granted = [CREATE]) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'transfers', component: TransfersPage },
          { path: 'inventory/transfers/new', component: StubPage },
          { path: 'inventory/transfers/:id', component: StubPage },
          { path: 'inventory/transfers/:id/edit', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), branches: () => [] } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, TransfersPage);
    if (permissions.has(CREATE)) http.expectOne(WAREHOUSES_URL).flush({ items: [] });
    return harness;
  }

  const flushList = (body: TransferListResponse) => http.expectOne((r) => r.url === LIST_URL).flush(body);
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

  it('lists the transfers with number, route, detail, status pill and a total row', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 't2', number: 'TR-000124', status: 'DRAFT', sentAt: null })]));
    await settle(h);

    expect(text(h)).toContain('TR-000123');
    expect(text(h)).toContain('Huayna Kapac → Sacaba');
    expect(text(h)).toContain('Enviada por Alberto Andia');
    expect(text(h)).toContain('Total');
    expect(text(h)).toContain('En tránsito');
    expect(text(h)).toContain('Borrador');
    expect(text(h)).toContain('Borrador de Ana');
    expect(text(h)).toContain('1–2 de 2 transferencias');
  });

  it('links a draft to the editor and every other transfer to its detail', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 't2', number: 'TR-000124', status: 'DRAFT' })]));
    await settle(h);
    const links = Array.from(root(h).querySelectorAll<HTMLAnchorElement>('a.number')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/inventory/transfers/t1', '/inventory/transfers/t2/edit']);
  });

  it('opens a transfer from the ⋯ menu of its row: a draft in the editor, anything else in its detail', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 't2', number: 'TR-000124', status: 'DRAFT' })]));
    await settle(h);

    const kebab = (label: string) => root(h).querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) as HTMLButtonElement;
    kebab('Acciones de TR-000123').click();
    h.detectChanges();
    expect(root(h).querySelector('rs-row-menu')?.textContent).toContain('Ver detalle');
    root(h).querySelector<HTMLButtonElement>('rs-row-menu [role="menuitem"]')?.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/transfers/t1');

    await h.navigateByUrl('/transfers', TransfersPage);
    http.expectOne((r) => r.url === WAREHOUSES_URL).flush({ items: [] });
    flushList(response([item({ id: 't2', number: 'TR-000124', status: 'DRAFT' })]));
    await settle(h);
    kebab('Acciones de TR-000124').click();
    h.detectChanges();
    expect(root(h).querySelector('rs-row-menu')?.textContent).toContain('Editar borrador');
  });

  describe('Exportar', () => {
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    let saved: Blob[];
    let clicked: string[];

    beforeEach(() => {
      saved = [];
      clicked = [];
      URL.createObjectURL = ((blob: Blob) => (saved.push(blob), 'blob:test')) as typeof URL.createObjectURL;
      URL.revokeObjectURL = () => undefined;
      jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.download);
      });
    });
    afterEach(() => {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      jest.restoreAllMocks();
    });

    it('reads every page the filters leave and saves them as one CSV', async () => {
      const h = await open('/transfers?status=IN_TRANSIT');
      flushList(response([item()], { total: 150 }));
      await settle(h);

      Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Exportar'))?.click();
      const first = http.expectOne((r) => r.url === LIST_URL && r.params.get('pageSize') === '100' && r.params.get('page') === '1');
      expect(first.request.params.get('status')).toBe('IN_TRANSIT');
      first.flush(response([item({ number: 'TR-000001' })], { total: 150, pageSize: 100 }));
      await Promise.resolve();
      const second = http.expectOne((r) => r.url === LIST_URL && r.params.get('page') === '2');
      second.flush(response([item({ number: 'TR-000002' })], { total: 2, pageSize: 100 }));
      await settle(h);

      expect(clicked[0]).toMatch(/^transferencias-\d{4}-\d{2}-\d{2}\.csv$/);
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(saved[0]);
      });
      expect(text).toContain('N.º;Origen;Destino');
      expect(text).toContain('TR-000001');
    });

    it('is disabled when there is nothing to export', async () => {
      const h = await open();
      flushList(response([]));
      await settle(h);
      const button = Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Exportar'));
      expect(button?.disabled).toBe(true);
    });
  });

  it('shows the first-use empty state with the create action', async () => {
    const h = await open();
    flushList(response([]));
    await settle(h);
    expect(text(h)).toContain('Aún no hay transferencias');
    expect(text(h)).toContain('Nueva transferencia');
  });

  it('does not offer to create without permission', async () => {
    const h = await open('/transfers', [RECEIVE]);
    flushList(response([item()]));
    await settle(h);
    expect(text(h)).not.toContain('Nueva transferencia');
    expect(text(h)).toContain('TR-000123');
  });

  it('opens the editor from "Nueva transferencia"', async () => {
    const h = await open();
    flushList(response([item()]));
    await settle(h);
    const button = Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Nueva transferencia'));
    button?.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/transfers/new');
  });

  it('puts the filters in the URL, asks the server for them and offers "Limpiar filtros" when nothing matches', async () => {
    const h = await open('/transfers?status=DRAFT&q=TR-9&page=2');
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.get('status')).toBe('DRAFT');
    expect(req.request.params.get('q')).toBe('TR-9');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush(response([], { page: 2 }));
    await settle(h);
    expect(text(h)).toContain('No encontramos transferencias');
    expect(text(h)).toContain('Limpiar filtros');
  });

  it('ignores a status in the URL that is not one of the eight', async () => {
    await open('/transfers?status=NOPE');
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.has('status')).toBe(false);
    req.flush(response([]));
  });

  it('shows the error with a retry that loads again', async () => {
    const h = await open();
    http.expectOne((r) => r.url === LIST_URL).flush({ code: 'ERROR', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar las transferencias');

    Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Reintentar'))?.click();
    flushList(response([item()]));
    await settle(h);
    expect(text(h)).toContain('TR-000123');
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open('/transfers', []);
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver transferencias');
  });
});
