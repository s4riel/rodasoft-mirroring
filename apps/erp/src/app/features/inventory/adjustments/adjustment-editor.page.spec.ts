import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { AdjustmentProductSearchItem, WarehouseListItem } from '@rodasoft/domain';
import { ALL_BRANCHES, RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { AdjustmentEditorPage } from './adjustment-editor.page';

const WAREHOUSES_URL = '/api/v1/inventory/warehouses';
const SEARCH_URL = '/api/v1/inventory/adjustments/product-search';
const CREATE_URL = '/api/v1/inventory/adjustments';

const warehouse = (over: Partial<WarehouseListItem> = {}): WarehouseListItem => ({
  id: 'w1',
  code: 'A-1',
  name: 'Principal',
  branch: { id: 'b1', name: 'Huayna Kapac' },
  isMain: true,
  visibleInStore: true,
  status: 'ACTIVE',
  productCount: 0,
  totalUnits: 0,
  ...over,
});

const product = (over: Partial<AdjustmentProductSearchItem> = {}): AdjustmentProductSearchItem => ({
  id: 'p1',
  sku: 'SKU-1',
  manufacturerCode: 'ABC-1',
  name: 'Rodamiento',
  brand: 'SKF',
  available: 10,
  unitCost: '5.0000',
  ...over,
});

@Component({ template: '' })
class StubPage {}

const CREATE = 'inventory.adjustments.create';
const COSTS = 'inventory.costs.view';

describe('AdjustmentEditorPage', () => {
  let http: HttpTestingController;

  async function open(granted = [CREATE, COSTS], warehouses = [warehouse()]) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'new', component: AdjustmentEditorPage },
          { path: 'inventory/adjustments', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), branchId: signal(ALL_BRANCHES) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/new', AdjustmentEditorPage);
    if (permissions.has(CREATE)) http.expectOne((r) => r.url === WAREHOUSES_URL).flush({ items: warehouses, total: warehouses.length, page: 1, pageSize: 100 });
    await settle(harness);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const button = (h: RouterTestingHarness, label: string) =>
    Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(label));

  /** Types a code, presses Enter and answers the search, so the product becomes a line. */
  async function addProduct(h: RouterTestingHarness, item = product()) {
    const input = root(h).querySelector<HTMLInputElement>('#adjustment-search') as HTMLInputElement;
    input.value = item.manufacturerCode;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    http.expectOne((r) => r.url === SEARCH_URL).flush({ items: [item] });
    await settle(h);
  }

  /** Picks the reason through the page, the way its select reports a choice. */
  function chooseReason(h: RouterTestingHarness, value: string) {
    (h.routeDebugElement?.componentInstance as { setReason(v: unknown): void }).setReason(value);
  }

  async function type(h: RouterTestingHarness, selector: string, value: string) {
    const input = root(h).querySelector<HTMLInputElement | HTMLTextAreaElement>(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle(h);
  }

  afterEach(() => http.verify());

  it('shows the no-permission state to someone who cannot create adjustments', async () => {
    const h = await open([]);
    expect(text(h)).toContain('No tienes permiso para registrar ajustes');
  });

  it('starts empty, with the main warehouse chosen and the lines area explaining what to do', async () => {
    const h = await open();
    expect(text(h)).toContain('Nuevo ajuste');
    expect(text(h)).toContain('Aún no hay productos en este ajuste');
    expect(text(h)).toContain('Huayna Kapac · Principal');
  });

  it('adds the product found with Enter, as an outward line that shows the stock it will leave', async () => {
    const h = await open();
    await addProduct(h);
    expect(text(h)).toContain('ABC-1');
    expect(text(h)).toContain('Rodamiento · SKF');
    await type(h, 'input[rsNumeric]', '3');
    expect(text(h)).toContain('1 producto en el ajuste');
    // current stock 10, resulting 7, value 3 × 5
    expect(text(h)).toMatch(/10\s*7/);
    expect(text(h)).toContain('Bs 15,00');
  });

  describe('the results are a checklist', () => {
    /** Types a text, waits out the typing pause and answers the search with these products. */
    async function listResults(h: RouterTestingHarness, items: AdjustmentProductSearchItem[]) {
      const input = root(h).querySelector<HTMLInputElement>('#adjustment-search') as HTMLInputElement;
      input.value = 'x1';
      input.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 300));
      http.expectOne((r) => r.url === SEARCH_URL).flush({ items });
      await settle(h);
    }
    const three = [
      product({ id: 'p1', manufacturerCode: 'A-1' }),
      product({ id: 'p2', manufacturerCode: 'A-2' }),
      product({ id: 'p3', manufacturerCode: 'A-3' }),
    ];
    const boxes = (h: RouterTestingHarness) => Array.from(root(h).querySelectorAll<HTMLInputElement>('.results-list input[type="checkbox"]'));
    const lineCodes = (h: RouterTestingHarness) => Array.from(root(h).querySelectorAll('.product .mono')).map((n) => n.textContent?.trim());

    it('shows a checkbox per result and a disabled "Agregar seleccionados" until something is ticked', async () => {
      const h = await open();
      await listResults(h, three);
      expect(boxes(h)).toHaveLength(3);
      expect(text(h)).toContain('0 seleccionados');
      expect(button(h, 'Agregar seleccionados')?.disabled).toBe(true);
      expect(lineCodes(h)).toEqual([]);
    });

    it('adds every ticked product with one button and empties the search', async () => {
      const h = await open();
      await listResults(h, three);
      boxes(h)[0].click();
      boxes(h)[2].click();
      await settle(h);
      expect(text(h)).toContain('2 seleccionados');
      button(h, 'Agregar seleccionados')?.click();
      await settle(h);
      expect(lineCodes(h)).toEqual(['A-1', 'A-3']);
      expect(root(h).querySelector('.results')).toBeNull();
      expect((root(h).querySelector('#adjustment-search') as HTMLInputElement).value).toBe('');
    });

    it('ticks and clears every result with "Seleccionar todos"', async () => {
      const h = await open();
      await listResults(h, three);
      const all = root(h).querySelector<HTMLInputElement>('.results-head input[type="checkbox"]') as HTMLInputElement;
      all.click();
      await settle(h);
      expect(boxes(h).every((b) => b.checked)).toBe(true);
      expect(text(h)).toContain('3 seleccionados');
      all.click();
      await settle(h);
      expect(text(h)).toContain('0 seleccionados');
    });

    it('keeps the product that is already in the adjustment and says so', async () => {
      const h = await open();
      await addProduct(h, three[0]);
      await listResults(h, three);
      boxes(h)[0].click();
      boxes(h)[1].click();
      await settle(h);
      button(h, 'Agregar seleccionados')?.click();
      await settle(h);
      expect(lineCodes(h)).toEqual(['A-1', 'A-2']);
      expect(text(h)).toContain('A-1 ya está en el ajuste.');
    });

    it('closes the list with "Cerrar" and forgets the ticks', async () => {
      const h = await open();
      await listResults(h, three);
      boxes(h)[0].click();
      await settle(h);
      button(h, 'Cerrar')?.click();
      await settle(h);
      expect(root(h).querySelector('.results')).toBeNull();
    });
  });

  describe('the pasted list and the Excel', () => {
    const listButtons = (h: RouterTestingHarness) => ({ paste: button(h, 'Pegar lista de códigos'), file: button(h, 'Importar Excel') });
    const lineCodes = (h: RouterTestingHarness) => Array.from(root(h).querySelectorAll('.product .mono')).map((n) => n.textContent?.trim());

    it('offers both buttons, enabled once there is a warehouse', async () => {
      const h = await open();
      expect(listButtons(h).paste?.disabled).toBe(false);
      expect(listButtons(h).file?.disabled).toBe(false);
    });

    it('opens the paste dialog and adds the read lines with their kind and quantity', async () => {
      const h = await open();
      listButtons(h).paste?.click();
      await settle(h);
      const area = document.querySelector<HTMLTextAreaElement>('#adjustment-paste') as HTMLTextAreaElement;
      area.value = 'ABC-1, 12, Entrada';
      area.dispatchEvent(new Event('input'));
      await settle(h);
      Array.from(document.querySelectorAll<HTMLButtonElement>('rs-modal button')).find((b) => b.textContent?.includes('Revisar'))?.click();
      http.expectOne('/api/v1/inventory/adjustments/resolve-lines').flush({
        lines: [{ line: 1, code: 'ABC-1', quantity: 12, kind: 'IN', group: 'RECOGNIZED', product: { id: 'p1', sku: 's', manufacturerCode: 'ABC-1', name: 'Rodamiento', brand: 'SKF' }, available: 10, unitCost: '5.0000' }],
        errors: [],
        counts: { RECOGNIZED: 1, INSUFFICIENT_STOCK: 0, NOT_FOUND: 0, INACTIVE: 0 },
      });
      await settle(h);
      Array.from(document.querySelectorAll<HTMLButtonElement>('rs-modal button')).find((b) => b.textContent?.includes('Agregar 1 producto'))?.click();
      await settle(h);

      expect(lineCodes(h)).toEqual(['ABC-1']);
      expect(text(h)).toContain('1 producto en el ajuste');
      // an entry of 12 on a stock of 10 leaves 22, value 12 × 5
      expect(text(h)).toMatch(/10\s*22/);
      expect(text(h)).toContain('Bs 60,00');
    });

    it('keeps the line a product already has and says so', async () => {
      const h = await open();
      await addProduct(h);
      const page = h.routeDebugElement?.componentInstance as { addFromList(a: unknown[]): void };
      page.addFromList([{ product: product(), kind: 'IN', quantity: 5 }]);
      await settle(h);
      expect(lineCodes(h)).toEqual(['ABC-1']);
      expect(text(h)).toContain('ABC-1 ya está en el ajuste.');
    });
  });

  it('refuses the same product twice', async () => {
    const h = await open();
    await addProduct(h);
    await addProduct(h);
    expect(text(h)).toContain('ABC-1 ya está en el ajuste.');
    expect(root(h).querySelectorAll('input[rsNumeric]')).toHaveLength(1);
  });

  it('marks an outward line that exceeds the stock', async () => {
    const h = await open();
    await addProduct(h);
    await type(h, 'input[rsNumeric]', '11');
    expect(text(h)).toContain('Supera el stock disponible');
  });

  it('removes a line', async () => {
    const h = await open();
    await addProduct(h);
    root(h).querySelector<HTMLButtonElement>('button[aria-label="Quitar ABC-1"]')?.click();
    await settle(h);
    expect(text(h)).toContain('Aún no hay productos en este ajuste');
  });

  it('asks for the reason and the products before confirming, and calls nothing', async () => {
    const h = await open();
    button(h, 'Confirmar ajuste')?.click();
    await settle(h);
    expect(text(h)).toContain('Elige el motivo del ajuste.');
    expect(text(h)).toContain('Agrega al menos un producto al ajuste.');
    http.expectNone(CREATE_URL);
  });

  it('needs a note for the reason "Otro"', async () => {
    const h = await open();
    await addProduct(h);
    await type(h, 'input[rsNumeric]', '2');
    chooseReason(h, 'OTHER');
    await settle(h);
    button(h, 'Confirmar ajuste')?.click();
    await settle(h);
    expect(text(h)).toContain('Describe el motivo cuando eliges "Otro".');
    expect(text(h)).not.toContain('¿Aplicar el ajuste?');
    http.expectNone(CREATE_URL);
  });

  it('confirms, sends the lines with the stock they were read against, and returns to the list with a toast', async () => {
    const h = await open();
    await addProduct(h);
    await type(h, 'input[rsNumeric]', '3');
    chooseReason(h, 'SHRINKAGE');
    await settle(h);

    button(h, 'Confirmar ajuste')?.click();
    await settle(h);
    expect(text(h)).toContain('¿Aplicar el ajuste?');
    http.expectNone(CREATE_URL);

    button(h, 'Aplicar ajuste')?.click();
    const req = http.expectOne(CREATE_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      warehouseId: 'w1',
      reason: 'SHRINKAGE',
      note: undefined,
      lines: [{ productId: 'p1', kind: 'OUT', quantity: 3, expectedBalance: 10 }],
    });
    req.flush({ id: 'a1', number: 'AJ-000009', status: 'APPROVED', totalValue: '15.00', movements: 1 });
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/adjustments');
  });

  it('shows the server error in Spanish and stays on the form when the stock changed', async () => {
    const h = await open();
    await addProduct(h);
    await type(h, 'input[rsNumeric]', '3');
    chooseReason(h, 'DAMAGE');
    await settle(h);
    button(h, 'Confirmar ajuste')?.click();
    await settle(h);
    button(h, 'Aplicar ajuste')?.click();
    http.expectOne(CREATE_URL).flush({ code: 'STOCK_CHANGED', message: 'x', details: { productId: 'p1', currentBalance: 8 } }, { status: 409, statusText: 'Conflict' });
    await settle(h);
    expect(text(h)).toContain('El stock de un producto cambió');
    // the line now shows the balance the server found
    expect(text(h)).toMatch(/8\s+5/);
    expect(TestBed.inject(Router).url).toBe('/new');
  });

  it('lets the user leave freely while the form is empty, and asks before dropping what was typed', async () => {
    const h = await open();
    const page = h.routeDebugElement?.componentInstance as { confirmLeave(): boolean | Promise<boolean> };
    expect(page.confirmLeave()).toBe(true);

    await addProduct(h);
    const answer = page.confirmLeave() as Promise<boolean>;
    await settle(h);
    expect(text(h)).toContain('Tienes cambios sin guardar');
    button(h, 'Seguir editando')?.click();
    expect(await answer).toBe(false);

    const again = page.confirmLeave() as Promise<boolean>;
    await settle(h);
    button(h, 'Salir sin guardar')?.click();
    expect(await again).toBe(true);
  });

  it('hides the value column and total for a viewer without inventory.costs.view', async () => {
    const h = await open([CREATE]);
    await addProduct(h, product({ unitCost: null }));
    await type(h, 'input[rsNumeric]', '2');
    expect(text(h)).not.toContain('Valor');
  });
});
