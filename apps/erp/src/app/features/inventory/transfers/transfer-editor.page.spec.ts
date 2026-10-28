import { Location } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  TransferDetail,
  TransferLineDetail,
  TransferProductSearchItem,
  TransferResolveResponse,
  TransferWarehousesResponse,
} from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { TransferEditorPage } from './transfer-editor.page';
import { unsavedTransferGuard } from './unsaved-transfer.guard';

const BASE = '/api/v1/inventory/transfers';

const WAREHOUSES: TransferWarehousesResponse = {
  items: [
    { id: 'w1', code: 'C-01', name: 'Almacén Central', branch: { id: 'b1', name: 'Central' }, canSendFrom: true },
    { id: 'w2', code: 'N-01', name: 'Almacén Norte', branch: { id: 'b2', name: 'Norte' }, canSendFrom: false },
  ],
};

const found = (over: Partial<TransferProductSearchItem> = {}): TransferProductSearchItem => ({
  id: 'p1',
  sku: 'RL-1',
  manufacturerCode: '6204-2RS',
  name: 'Rodamiento rígido',
  brand: 'SKF',
  available: 10,
  unitCost: '5.0000',
  ...over,
});

const lineDetail = (over: Partial<TransferLineDetail> = {}): TransferLineDetail => ({
  productId: 'p1',
  sku: 'RL-1',
  manufacturerCode: '6204-2RS',
  name: 'Rodamiento rígido',
  brand: 'SKF',
  quantity: 2,
  receivedQuantity: 0,
  available: 10,
  unitCost: '5.0000',
  status: 'OK',
  ...over,
});

const detail = (over: Partial<TransferDetail> = {}): TransferDetail => ({
  id: 't1',
  number: 'TR-000001',
  status: 'DRAFT',
  origin: { id: 'w1', name: 'Almacén Central', branch: { id: 'b1', name: 'Central' } },
  destination: { id: 'w2', name: 'Almacén Norte', branch: { id: 'b2', name: 'Norte' } },
  note: null,
  lines: [lineDetail()],
  summary: { products: 1, pieces: 2, value: '10.00', errors: 0, withoutCost: 0 },
  needsApproval: false,
  createdAt: '2026-10-28T15:00:00.000Z',
  updatedAt: '2026-10-28T15:00:00.000Z',
  sentAt: null,
  ...over,
});

@Component({ template: '' })
class StubPage {}

/** The editor members the tests drive directly where the DOM would need the select's overlay. */
interface EditorApi {
  setOrigin(id: string): void;
  setDestination(id: string): void;
  lines(): readonly { productId: string; quantity: number }[];
  saveDraft(): void;
  send(): void;
  setFilter(filter: 'all' | 'error' | 'unchanged'): void;
  goToPage(page: number): void;
  addFromList(additions: { product: TransferProductSearchItem; quantity: number }[]): void;
  dirty(): boolean;
}

describe('TransferEditorPage', () => {
  let http: HttpTestingController;
  let page: EditorApi & {
    originOptions(): { value: string }[];
    destinationOptions(): { value: string }[];
  };

  async function open(url = '/new', granted = ['inventory.transfers.create', 'inventory.costs.view'], warehouses = WAREHOUSES) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'new', component: TransferEditorPage, canDeactivate: [unsavedTransferGuard] },
          { path: ':id/edit', component: TransferEditorPage, canDeactivate: [unsavedTransferGuard] },
          { path: 'inventory/transfers', component: StubPage },
          { path: 'inventory/transfers/:id', component: StubPage },
          { path: 'inventory/transfers/:id/edit', component: StubPage },
          { path: 'other', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), branches: () => [] } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    page = (await harness.navigateByUrl(url, TransferEditorPage)) as unknown as typeof page;
    http.expectOne(`${BASE}/warehouses`).flush(warehouses);
    return harness;
  }

  /** The page the harness opened; the harness argument keeps the call sites reading like the other page specs. */
  const editor = (h: RouterTestingHarness) => {
    void h;
    return page;
  };
  const modalButton = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('rs-modal button')).find((b) => b.textContent?.includes(label));
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const searchBox = (h: RouterTestingHarness) => root(h).querySelector<HTMLInputElement>('input[type="search"][aria-label^="Buscar producto"]') as HTMLInputElement;
  const buttonByText = (h: RouterTestingHarness, label: string) =>
    Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim().includes(label));
  const searchRequest = (): TestRequest => http.expectOne((r) => r.url === `${BASE}/product-search`);

  afterEach(() => http.verify());

  describe('empty state (IN-06d)', () => {
    it('shows the illustrated empty state with the three ways to add, and Enviar disabled', async () => {
      const h = await open();
      editor(h).setOrigin('w1');
      await settle(h);

      expect(root(h).querySelector('rs-empty-state-illustrated')).not.toBeNull();
      expect(text(h)).toContain('Agrega productos');
      expect(buttonByText(h, 'Buscar producto')).toBeDefined();
      expect(buttonByText(h, 'Pegar lista')).toBeDefined();
      expect(buttonByText(h, 'Importar Excel')).toBeDefined();
      expect(buttonByText(h, 'Enviar')?.disabled).toBe(true);
      expect(buttonByText(h, 'Reponer bajo mínimo')?.disabled).toBe(true);
    });

    it('preselects the origin when the user can send from a single warehouse', async () => {
      const h = await open();
      await settle(h);
      expect(page.originOptions()).toHaveLength(1);
      expect(text(h)).not.toContain('Elige el almacén de origen para agregar productos.');
    });

    it('asks for the origin before products can be added when there is more than one to choose from', async () => {
      const both = { items: WAREHOUSES.items.map((w) => ({ ...w, canSendFrom: true })) };
      const h = await open('/new', ['inventory.transfers.create'], both);
      await settle(h);
      expect(text(h)).toContain('Elige el almacén de origen para agregar productos.');
      expect(searchBox(h).disabled).toBe(true);
    });

    it('only offers the warehouses the user can send from as origin, and never the origin as destination', async () => {
      const h = await open();
      editor(h).setOrigin('w1');
      await settle(h);
      expect(page.originOptions().map((o) => o.value)).toEqual(['w1']);
      expect(page.destinationOptions().map((o) => o.value)).toEqual(['w2']);
    });

    it('shows its own message without permission', async () => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([{ path: '', component: TransferEditorPage }]),
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: RS_PERMISSIONS, useValue: signal(new Set<string>()) },
          { provide: ContextStore, useValue: { can: () => false, branches: () => [] } },
        ],
      });
      http = TestBed.inject(HttpTestingController);
      const h = await RouterTestingHarness.create();
      await h.navigateByUrl('/', TransferEditorPage);
      await settle(h);
      expect(text(h)).toContain('No tienes permiso para crear transferencias');
    });
  });

  describe('search by code (IN-06a)', () => {
    async function withOrigin() {
      const h = await open();
      editor(h).setOrigin('w1');
      await settle(h);
      return h;
    }

    it('adds the first result when Enter is pressed', async () => {
      const h = await withOrigin();
      searchBox(h).value = '6204';
      searchBox(h).dispatchEvent(new Event('input'));
      searchBox(h).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      searchRequest().flush({ items: [found({ id: 'p1' }), found({ id: 'p2', manufacturerCode: '6204-ZZ' })] });
      await settle(h);

      expect(editor(h).lines().map((l) => l.productId)).toEqual(['p1']);
      expect(text(h)).toContain('6204-2RS');
    });

    it('adds to the quantity of a product that is already in the list instead of repeating it', async () => {
      const h = await withOrigin();
      for (let i = 0; i < 2; i++) {
        searchBox(h).value = '6204';
        searchBox(h).dispatchEvent(new Event('input'));
        searchBox(h).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
        searchRequest().flush({ items: [found()] });
        await settle(h);
      }
      expect(editor(h).lines()).toEqual([expect.objectContaining({ productId: 'p1', quantity: 2 })]);
    });

    it('says so when nothing matches, and adds nothing', async () => {
      const h = await withOrigin();
      searchBox(h).value = 'zzz';
      searchBox(h).dispatchEvent(new Event('input'));
      searchBox(h).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      searchRequest().flush({ items: [] });
      await settle(h);
      expect(editor(h).lines()).toEqual([]);
      expect(text(h)).toContain('No encontramos productos con ese código.');
    });
  });

  describe('paste and Excel (IN-06b / IN-06c)', () => {
    it('shows the three groups in the preview and adds only the recognized lines', async () => {
      const h = await open();
      editor(h).setOrigin('w1');
      await settle(h);
      buttonByText(h, 'Pegar lista')?.click();
      await settle(h);

      const area = document.querySelector<HTMLTextAreaElement>('#transfer-paste') as HTMLTextAreaElement;
      area.value = '6204-2RS, 3\n6205, 99\nNOPE, 1';
      area.dispatchEvent(new Event('input'));
      await settle(h);
      modalButton('Revisar')?.click();

      const resolved: TransferResolveResponse = {
        lines: [
          { line: 1, code: '6204-2RS', quantity: 3, group: 'RECOGNIZED', product: { id: 'p1', sku: 'RL-1', manufacturerCode: '6204-2RS', name: 'Rodamiento', brand: 'SKF' }, available: 10, unitCost: '5.0000' },
          { line: 2, code: '6205', quantity: 99, group: 'INSUFFICIENT_STOCK', product: { id: 'p2', sku: 'RL-2', manufacturerCode: '6205', name: 'Rodamiento', brand: 'FAG' }, available: 4, unitCost: '5.0000' },
          { line: 3, code: 'NOPE', quantity: 1, group: 'NOT_FOUND', product: null, available: null, unitCost: null },
        ],
        errors: [],
        counts: { RECOGNIZED: 1, INSUFFICIENT_STOCK: 1, NOT_FOUND: 1, INACTIVE: 0 },
      };
      const req = http.expectOne(`${BASE}/resolve-lines`);
      expect(req.request.body).toEqual({ warehouseId: 'w1', text: '6204-2RS, 3\n6205, 99\nNOPE, 1' });
      req.flush(resolved);
      await settle(h);

      const dialog = document.querySelector('rs-modal')?.textContent ?? '';
      expect(dialog).toContain('Reconocidos');
      expect(dialog).toContain('Sin stock suficiente');
      expect(dialog).toContain('No encontrados');
      // nothing was added yet
      expect(editor(h).lines()).toEqual([]);

      modalButton('Agregar 1 producto')?.click();
      await settle(h);
      expect(editor(h).lines()).toEqual([expect.objectContaining({ productId: 'p1', quantity: 3 })]);
    });
  });

  describe('a long list (100+ products)', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      product: found({ id: `p${i}`, manufacturerCode: `C-${String(i).padStart(3, '0')}`, available: 5 }),
      quantity: 1,
    }));

    it('pages by 10, keeps the edits across pages, and filters by error', async () => {
      const h = await open();
      editor(h).setOrigin('w1');
      editor(h).addFromList(many);
      await settle(h);

      expect(root(h).querySelectorAll('tbody tr').length).toBe(10);
      // quantity edited on page 1 survives a trip to page 3 and back
      const first = root(h).querySelector<HTMLInputElement>('input.quantity') as HTMLInputElement;
      first.value = '9';
      first.dispatchEvent(new Event('input'));
      editor(h).goToPage(3);
      await settle(h);
      expect(root(h).querySelectorAll('tbody tr').length).toBe(5);
      editor(h).goToPage(1);
      await settle(h);
      expect(editor(h).lines().find((l) => l.quantity === 9)).toBeDefined();

      // 9 > the 5 in stock: that one line is the only one with an error
      editor(h).setFilter('error');
      await settle(h);
      expect(root(h).querySelectorAll('tbody tr').length).toBe(1);
      expect(text(h)).toContain('Sin stock suficiente');
    });

    it('summarizes products, pieces, value and errors, and blocks sending while there are errors', async () => {
      const h = await open();
      editor(h).setOrigin('w1');
      editor(h).setDestination('w2');
      editor(h).addFromList([{ product: found({ id: 'a', available: 5 }), quantity: 6 }, { product: found({ id: 'b', available: 5 }), quantity: 2 }]);
      await settle(h);

      const summary = root(h).querySelector('.totals')?.textContent ?? '';
      expect(summary).toContain('Productos');
      expect(summary).toMatch(/Piezas\s*8/);
      expect(summary).toMatch(/Errores\s*1/);
      expect(summary).toContain('40,00');
      expect(buttonByText(h, 'Enviar')?.disabled).toBe(true);
      expect(text(h)).toContain('Corrige los productos con error');
    });

    it('hides the value from a user without cost permission', async () => {
      const h = await open('/new', ['inventory.transfers.create']);
      editor(h).setOrigin('w1');
      editor(h).addFromList([{ product: found({ unitCost: null }), quantity: 1 }]);
      await settle(h);
      expect(root(h).querySelector('.totals')?.textContent).not.toContain('Valor');
    });
  });

  describe('saving and sending', () => {
    it('creates the draft the first time, then updates it with the version it read', async () => {
      const h = await open();
      editor(h).setOrigin('w1');
      editor(h).setDestination('w2');
      editor(h).addFromList([{ product: found(), quantity: 2 }]);
      await settle(h);

      editor(h).saveDraft();
      const create = http.expectOne({ method: 'POST', url: BASE });
      expect(create.request.body).toEqual({
        originWarehouseId: 'w1',
        destinationWarehouseId: 'w2',
        note: null,
        lines: [{ productId: 'p1', quantity: 2 }],
      });
      create.flush(detail());
      await settle(h);
      expect(editor(h).dirty()).toBe(false);
      expect(TestBed.inject(Location).path()).toBe('/inventory/transfers/t1/edit');

      editor(h).addFromList([{ product: found({ id: 'p2', manufacturerCode: '6205' }), quantity: 1 }]);
      editor(h).saveDraft();
      const update = http.expectOne({ method: 'PUT', url: `${BASE}/t1` });
      expect(update.request.body).toMatchObject({ expectedUpdatedAt: '2026-10-28T15:00:00.000Z' });
      update.flush(detail({ updatedAt: '2026-10-28T16:00:00.000Z' }));
    });

    it('sends the draft and goes back to the list', async () => {
      const h = await open('/t1/edit');
      http.expectOne(`${BASE}/t1`).flush(detail());
      await settle(h);
      const router = TestBed.inject(Router);

      editor(h).send();
      const send = http.expectOne({ method: 'POST', url: `${BASE}/t1/send` });
      expect(send.request.body).toEqual({ expectedUpdatedAt: '2026-10-28T15:00:00.000Z' });
      send.flush(detail({ status: 'IN_TRANSIT', sentAt: '2026-10-28T17:00:00.000Z' }));
      await settle(h);
      await h.fixture.whenStable();
      expect(router.url).toBe('/inventory/transfers');
    });

    it('asks for approval instead when the server says the draft is over the limit', async () => {
      const h = await open('/t1/edit');
      http.expectOne(`${BASE}/t1`).flush(detail({ needsApproval: true }));
      await settle(h);
      expect(buttonByText(h, 'Enviar para aprobación')).toBeDefined();
    });

    it('explains a refused send in Spanish and reloads the lines the server flags', async () => {
      const h = await open('/t1/edit');
      http.expectOne(`${BASE}/t1`).flush(detail());
      await settle(h);

      editor(h).send();
      http.expectOne({ method: 'POST', url: `${BASE}/t1/send` }).flush({ code: 'INSUFFICIENT_STOCK', message: 'x' }, { status: 422, statusText: 'Unprocessable' });
      http.expectOne({ method: 'GET', url: `${BASE}/t1` }).flush(detail({ lines: [lineDetail({ available: 1, status: 'INSUFFICIENT_STOCK' })] }));
      await settle(h);
      expect(text(h)).toContain('El stock del origen cambió');
      expect(text(h)).toContain('Sin stock suficiente');
    });

    it('keeps the edits on screen when the save before the send fails', async () => {
      const h = await open('/t1/edit');
      http.expectOne(`${BASE}/t1`).flush(detail());
      await settle(h);
      editor(h).addFromList([{ product: found({ id: 'p2', manufacturerCode: '6205' }), quantity: 3 }]);
      await settle(h);

      editor(h).send();
      http.expectOne({ method: 'PUT', url: `${BASE}/t1` }).flush({ code: 'TRANSFER_MODIFIED', message: 'x' }, { status: 409, statusText: 'Conflict' });
      await settle(h);

      // no reload: the unsaved line is still there, and the editor still reports changes
      expect(editor(h).lines().map((l) => l.productId)).toContain('p2');
      expect(editor(h).dirty()).toBe(true);
      expect(text(h)).toContain('Otro usuario modificó esta transferencia');
    });

    it('opens the read-only detail when the transfer is not a draft', async () => {
      const h = await open('/t1/edit');
      http.expectOne(`${BASE}/t1`).flush(detail({ status: 'IN_TRANSIT' }));
      await settle(h);
      expect(TestBed.inject(Router).url).toBe('/inventory/transfers/t1');
    });
  });

  describe('leaving with unsaved changes', () => {
    it('asks before leaving and stays when the user keeps editing', async () => {
      const h = await open();
      editor(h).setOrigin('w1');
      editor(h).addFromList([{ product: found(), quantity: 1 }]);
      await settle(h);

      const router = TestBed.inject(Router);
      const leaving = router.navigateByUrl('/other');
      // the router waits for the guard, so the app never becomes stable until the user answers: no whenStable here
      await Promise.resolve();
      h.detectChanges();
      const modals = Array.from(document.querySelectorAll('rs-modal')).map((m) => m.textContent ?? '');
      expect(modals.join(' ')).toContain('Tienes cambios sin guardar');
      modalButton('Seguir editando')?.click();
      expect(await leaving).toBe(false);
      expect(router.url).toBe('/new');
    });

    it('leaves without asking when nothing changed', async () => {
      const h = await open();
      await settle(h);
      expect(await TestBed.inject(Router).navigateByUrl('/other')).toBe(true);
    });
  });
});
