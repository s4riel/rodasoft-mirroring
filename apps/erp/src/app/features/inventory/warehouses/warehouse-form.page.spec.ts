import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { WarehouseDetail, WarehouseListItem, WarehouseListResponse, WarehouseSaveResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS, ToastService } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { WarehouseFormPage } from './warehouse-form.page';

const BASE = '/api/v1/inventory/warehouses';
const MANAGE = 'inventory.warehouses.manage';

const detail = (over: Partial<WarehouseDetail> = {}): WarehouseDetail => ({
  id: 'w2',
  code: 'HK-02',
  name: 'Depósito',
  branch: { id: 'b1', name: 'Huayna Kapac' },
  isMain: false,
  visibleInStore: true,
  locationNote: null,
  status: 'ACTIVE',
  updatedAt: '2026-10-28T12:00:00.000Z',
  hasMovements: false,
  totalUnits: 0,
  ...over,
});

const saved = (over: Partial<WarehouseSaveResponse> = {}): WarehouseSaveResponse => ({ warehouse: detail(), demotedMain: null, ...over });

const mainItem: WarehouseListItem = {
  id: 'w1',
  code: 'HK-01',
  name: 'Principal',
  branch: { id: 'b1', name: 'Huayna Kapac' },
  isMain: true,
  visibleInStore: true,
  status: 'ACTIVE',
  productCount: 3,
  totalUnits: 9,
};

@Component({ template: '' })
class ListStub {}

describe('WarehouseFormPage', () => {
  let http: HttpTestingController;
  let toast: ToastService;

  async function open(url: string, granted = [MANAGE]) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'warehouses/new', component: WarehouseFormPage },
          { path: 'warehouses/:id/edit', component: WarehouseFormPage },
          { path: 'inventory/warehouses', component: ListStub },
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
    toast = TestBed.inject(ToastService);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const input = (h: RouterTestingHarness, id: string) => root(h).querySelector<HTMLInputElement>(`#${id}`)!;
  async function type(h: RouterTestingHarness, id: string, value: string) {
    const el = input(h, id);
    el.value = value;
    el.dispatchEvent(new Event('input'));
    await settle(h);
  }
  const submit = async (h: RouterTestingHarness) => {
    root(h).querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
    await settle(h);
  };
  const button = (h: RouterTestingHarness, label: string) => Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes(label));
  /** Opens the branch select and clicks the option, as the user would. */
  const pickBranch = async (h: RouterTestingHarness, label: string) => {
    root(h).querySelector<HTMLButtonElement>('#warehouse-branch')!.click();
    await settle(h);
    Array.from(root(h).querySelectorAll<HTMLElement>('[role=option]')).find((o) => o.textContent?.trim() === label)!.click();
    await settle(h);
  };

  afterEach(() => http.verify());

  describe('new', () => {
    it('refuses an empty form with inline messages and sends nothing', async () => {
      const h = await open('/warehouses/new');
      await submit(h);
      expect(text(h)).toContain('Ingresa el código del almacén.');
      expect(text(h)).toContain('Ingresa el nombre del almacén.');
      expect(text(h)).toContain('Elige la sucursal del almacén.');
      http.expectNone(BASE);
    });

    it('rejects a malformed code', async () => {
      const h = await open('/warehouses/new');
      await type(h, 'warehouse-code', 'HK_02');
      await submit(h);
      expect(text(h)).toContain('Usa de 2 a 12 letras mayúsculas, números o guiones');
    });

    it('creates the warehouse with the code in upper case, then goes back to the list with a toast', async () => {
      const h = await open('/warehouses/new');
      const success = jest.spyOn(toast, 'success');
      await type(h, 'warehouse-code', ' hk-02 ');
      await type(h, 'warehouse-name', 'Depósito Central');
      await pickBranch(h, 'Huayna Kapac');
      await submit(h);

      const req = http.expectOne((r) => r.method === 'POST' && r.url === BASE);
      expect(req.request.body).toEqual({
        code: 'HK-02',
        name: 'Depósito Central',
        branchId: 'b1',
        isMain: false,
        visibleInStore: true,
        locationNote: null,
      });
      req.flush(saved());
      await settle(h);
      expect(success).toHaveBeenCalledWith('Almacén creado');
      expect(TestBed.inject(Router).url).toBe('/inventory/warehouses');
    });

    it('puts a duplicate code under the code field and stays on the form', async () => {
      const h = await open('/warehouses/new');
      await type(h, 'warehouse-code', 'HK-01');
      await type(h, 'warehouse-name', 'Otro');
      await pickBranch(h, 'Huayna Kapac');
      await submit(h);
      http.expectOne((r) => r.method === 'POST').flush({ code: 'WAREHOUSE_CODE_EXISTS', message: 'dup' }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      expect(text(h)).toContain('Ya existe un almacén con este código.');
      expect(TestBed.inject(Router).url).toBe('/warehouses/new');
    });

    it('names the warehouse that loses the main flag and saves only after confirming', async () => {
      const h = await open('/warehouses/new');
      await type(h, 'warehouse-code', 'HK-02');
      await type(h, 'warehouse-name', 'Nuevo principal');
      await pickBranch(h, 'Huayna Kapac');
      const main = root(h).querySelector<HTMLInputElement>('#warehouse-main')!;
      main.click();
      await settle(h);
      await submit(h);

      const lookup = http.expectOne((r) => r.method === 'GET' && r.url === BASE);
      expect(lookup.request.params.get('branchId')).toBe('b1');
      expect(lookup.request.params.get('status')).toBe('ACTIVE');
      lookup.flush({ items: [mainItem], total: 1, page: 1, pageSize: 100 } satisfies WarehouseListResponse);
      await settle(h);

      expect(text(h)).toContain('Se quitará como principal a HK-01.');
      http.expectNone((r) => r.method === 'POST');

      button(h, 'Cambiar principal')!.click();
      const req = http.expectOne((r) => r.method === 'POST');
      expect(req.request.body).toMatchObject({ isMain: true });
      req.flush(saved({ demotedMain: { id: 'w1', code: 'HK-01' } }));
      await settle(h);
    });
  });

  describe('edit', () => {
    it('loads the warehouse into the form', async () => {
      const h = await open('/warehouses/w2/edit');
      expect(root(h).querySelector('[aria-busy=true]')).not.toBeNull();
      http.expectOne(`${BASE}/w2`).flush(detail({ locationNote: 'Calle 1' }));
      await settle(h);
      expect(input(h, 'warehouse-code').value).toBe('HK-02');
      expect(input(h, 'warehouse-name').value).toBe('Depósito');
      expect(text(h)).toContain('Editar almacén');
      expect(text(h)).toContain('Estado del almacén');
    });

    it('sends only what changed, with the updatedAt it loaded', async () => {
      const h = await open('/warehouses/w2/edit');
      const success = jest.spyOn(toast, 'success');
      http.expectOne(`${BASE}/w2`).flush(detail());
      await settle(h);
      expect(button(h, 'Guardar cambios')!.disabled).toBe(true);

      await type(h, 'warehouse-name', 'Depósito Norte');
      await submit(h);
      const req = http.expectOne((r) => r.method === 'PATCH' && r.url === `${BASE}/w2`);
      expect(req.request.body).toEqual({ expectedUpdatedAt: '2026-10-28T12:00:00.000Z', name: 'Depósito Norte' });
      req.flush(saved());
      await settle(h);
      expect(success).toHaveBeenCalledWith('Almacén actualizado');
    });

    it('locks the branch once there are movements, and the main flag and status of the main warehouse', async () => {
      const h = await open('/warehouses/w1/edit');
      http.expectOne(`${BASE}/w1`).flush(detail({ id: 'w1', code: 'HK-01', isMain: true, hasMovements: true, totalUnits: 5 }));
      await settle(h);
      expect(text(h)).toContain('No se puede cambiar: el almacén ya tiene movimientos.');
      expect(text(h)).toContain('Para cambiar el principal, marca otro almacén');
      expect(input(h, 'warehouse-main').disabled).toBe(true);
      expect(input(h, 'warehouse-active').disabled).toBe(true);
      expect(text(h)).toContain('Tiene stock');
    });

    it('offers to reload when somebody else edited the warehouse meanwhile', async () => {
      const h = await open('/warehouses/w2/edit');
      http.expectOne(`${BASE}/w2`).flush(detail());
      await settle(h);
      await type(h, 'warehouse-name', 'Mío');
      await submit(h);
      http.expectOne((r) => r.method === 'PATCH').flush({ code: 'WAREHOUSE_MODIFIED', message: 'modified' }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      expect(text(h)).toContain('Otro usuario modificó este almacén.');

      button(h, 'Recargar')!.click();
      http.expectOne(`${BASE}/w2`).flush(detail({ name: 'Cambiado por otro' }));
      await settle(h);
      expect(input(h, 'warehouse-name').value).toBe('Cambiado por otro');
    });

    it('shows a message above the buttons for a refusal that belongs to no field', async () => {
      const h = await open('/warehouses/w2/edit');
      http.expectOne(`${BASE}/w2`).flush(detail());
      await settle(h);
      await type(h, 'warehouse-name', 'x');
      await submit(h);
      http.expectOne((r) => r.method === 'PATCH').flush({ code: 'WAREHOUSE_HAS_STOCK', message: 'stock' }, { status: 422, statusText: 'Unprocessable' });
      await settle(h);
      expect(root(h).querySelector('[role=alert]')?.textContent).toContain('No se puede desactivar: el almacén todavía tiene stock.');
    });

    it('shows the not-found and error states', async () => {
      const h = await open('/warehouses/w9/edit');
      http.expectOne(`${BASE}/w9`).flush({ code: 'WAREHOUSE_NOT_FOUND', message: 'nf' }, { status: 404, statusText: 'Not Found' });
      await settle(h);
      expect(text(h)).toContain('No encontramos este almacén');
    });

    it('shows the error state with a retry when the load fails', async () => {
      const h = await open('/warehouses/w2/edit');
      http.expectOne(`${BASE}/w2`).flush({ code: 'ERROR', message: 'boom' }, { status: 500, statusText: 'Server Error' });
      await settle(h);
      expect(text(h)).toContain('No pudimos cargar el almacén');
      button(h, 'Reintentar')!.click();
      http.expectOne(`${BASE}/w2`).flush(detail());
      await settle(h);
      expect(input(h, 'warehouse-code').value).toBe('HK-02');
    });
  });

  it('shows the no-permission state, and calls nothing, without the manage permission', async () => {
    const h = await open('/warehouses/w2/edit', []);
    await settle(h);
    http.expectNone(`${BASE}/w2`);
    expect(text(h)).toContain('No tienes permiso para gestionar almacenes');
  });
});
