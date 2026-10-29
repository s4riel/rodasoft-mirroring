import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { KardexLedgerResponse, KardexLedgerRow, KardexResponse, KardexRow } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { KardexPage } from './kardex.page';

const KARDEX_URL = '/api/v1/inventory/kardex';
const WAREHOUSES_URL = '/api/v1/inventory/warehouses';
const PRODUCTS_URL = '/api/v1/inventory/products';
const PRODUCT = '0198a0a0-0000-7000-8000-000000000001';

const row = (over: Partial<KardexRow> = {}): KardexRow => ({
  id: 'm1',
  date: '2026-10-12T16:00:00.000Z',
  type: 'PURCHASE_RECEIPT',
  typeLabel: 'Compra',
  document: { refType: 'PURCHASE', refNumber: 'C-0001' },
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Principal' },
  user: 'Ana',
  quantityIn: 30,
  quantityOut: 0,
  balance: 50,
  warehouseBalance: 50,
  ...over,
});

const response = (items: KardexRow[], over: Partial<KardexResponse> = {}): KardexResponse => ({
  product: { id: PRODUCT, sku: 'RL-000001', manufacturerCode: '6205-2RS', name: 'Rodamiento rígido', brand: 'SKF', unit: 'unit', currentStock: 50 },
  filters: { warehouseId: null, from: '2026-10-01', to: '2026-10-31' },
  openingBalance: 20,
  totals: { quantityIn: 30, quantityOut: 4, closingBalance: 46 },
  includesCost: false,
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  ...over,
});

@Component({ template: '' })
class StubPage {}

const VIEW = 'inventory.kardex.view';

describe('KardexPage', () => {
  let http: HttpTestingController;

  async function open(url = '/kardex', granted = [VIEW]) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'kardex', component: KardexPage },
          { path: 'inventory/kardex', component: StubPage },
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
    await harness.navigateByUrl(url, KardexPage);
    http.expectOne((r) => r.url === WAREHOUSES_URL).flush({
      items: [{ id: 'w1', name: 'Principal', branch: { id: 'b1', name: 'Huayna Kapac' } }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    return harness;
  }

  const flushKardex = (body: KardexResponse) => http.expectOne((r) => r.url === KARDEX_URL).flush(body);
  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const headers = (h: RouterTestingHarness) => Array.from(root(h).querySelectorAll('rs-doc-table thead th')).map((th) => th.textContent?.trim());

  afterEach(() => http.verify());

  describe('ledger of every movement (no product picked)', () => {
    const lrow = (over: Partial<KardexLedgerRow> = {}): KardexLedgerRow => ({
      id: 'l1',
      date: '2026-10-14T16:00:00.000Z',
      type: 'TRANSFER_OUT',
      typeLabel: 'Salida por transferencia',
      pill: 'TRANSFER',
      document: { refType: 'TRANSFER', refNumber: 'TR-0031' },
      documentLink: { kind: 'TRANSFER', id: 't1' },
      product: { id: PRODUCT, manufacturerCode: '6205-2RS', name: 'Rodamiento rígido', brand: 'SKF' },
      branch: { id: 'b1', name: 'Huayna Kapac' },
      warehouse: { id: 'w1', name: 'Principal' },
      counterpart: { direction: 'TO', branch: 'Sacaba', warehouse: 'Principal', inTransit: true },
      user: 'Ana',
      quantity: -12,
      balance: 12,
      ...over,
    });
    const lresponse = (items: KardexLedgerRow[], over: Partial<KardexLedgerResponse> = {}): KardexLedgerResponse => ({
      filters: { warehouseId: null, branchId: null, type: null, q: null, from: '2026-10-01', to: '2026-10-31' },
      includesCost: false,
      totals: { quantityIn: 30, quantityOut: 18, net: 12 },
      items,
      total: items.length,
      page: 1,
      pageSize: 25,
      ...over,
    });
    const flushLedger = (body: KardexLedgerResponse) => http.expectOne((r) => r.url === KARDEX_URL).flush(body);

    it('loads every movement without a product and shows the Figma columns, pills and totals', async () => {
      const h = await open();
      const req = http.expectOne((r) => r.url === KARDEX_URL);
      expect(req.request.params.has('productId')).toBe(false);
      expect(req.request.params.get('pageSize')).toBe('25');
      req.flush(lresponse([lrow(), lrow({ id: 'l2', type: 'SALE', typeLabel: 'Venta', pill: 'OUT', quantity: -6, balance: 24, counterpart: null, documentLink: null, document: { refType: 'SALE', refNumber: 'V-1' } })]));
      await settle(h);

      expect(headers(h)).toEqual(['Fecha', 'Producto', 'Movimiento', 'Detalle', 'Cantidad', 'Saldo', 'Tipo', '']);
      const body = Array.from(root(h).querySelectorAll('rs-doc-table tbody tr')).map((tr) => tr.textContent?.replace(/\s+/g, ' ').trim() ?? '');
      expect(body[0]).toContain('6205-2RS');
      expect(body[0]).toContain('Salida por transferencia TR-0031');
      expect(body[0]).toContain('Huayna Kapac · Principal');
      expect(body[0]).toContain('Hacia Sacaba · Principal · en tránsito');
      expect(body[0]).toContain('−12');
      expect(body[0]).toContain('Transferencia');
      expect(body[1]).toContain('Salida');
      const footer = root(h).querySelector('rs-doc-table tfoot')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      expect(footer).toContain('Total');
      expect(footer).toContain('+12');
      expect(text(h)).toContain('1–2 de 2 movimientos');
      expect(text(h)).not.toContain('Saldo inicial');
    });

    it('sends the search, branch, type and dates of the URL', async () => {
      const h = await open('/kardex?q=TR-0031&type=TRANSFER_OUT&branchId=b1&from=2026-10-01&to=2026-10-31&page=2');
      const req = http.expectOne((r) => r.url === KARDEX_URL);
      expect(req.request.params.get('q')).toBe('TR-0031');
      expect(req.request.params.get('type')).toBe('TRANSFER_OUT');
      expect(req.request.params.get('branchId')).toBe('b1');
      expect(req.request.params.get('from')).toBe('2026-10-01');
      expect(req.request.params.get('page')).toBe('2');
      req.flush(lresponse([]));
      await settle(h);
    });

    it('ignores a type that is not a movement type', async () => {
      const h = await open('/kardex?type=GIFT');
      const req = http.expectOne((r) => r.url === KARDEX_URL);
      expect(req.request.params.has('type')).toBe(false);
      req.flush(lresponse([]));
      await settle(h);
    });

    it('says there is nothing in the period, or nothing for the filters, with a way to clear them', async () => {
      const plain = await open();
      flushLedger(lresponse([]));
      await settle(plain);
      expect(text(plain)).toContain('Sin movimientos en el período');
      TestBed.resetTestingModule();

      const h = await open('/kardex?q=zzz');
      flushLedger(lresponse([]));
      await settle(h);
      expect(text(h)).toContain('No encontramos movimientos');
      expect(text(h)).toContain('Limpiar filtros');
    });

    it('adds the cost columns when the API sends costs', async () => {
      const h = await open(`/kardex`, [VIEW, 'inventory.costs.view']);
      flushLedger(lresponse([lrow({ unitCost: '2.5000', value: '30.00' })], { includesCost: true }));
      await settle(h);
      expect(headers(h)).toEqual(['Fecha', 'Producto', 'Movimiento', 'Detalle', 'Cantidad', 'Saldo', 'Costo unit.', 'Valor', 'Tipo', '']);
      expect(text(h)).toContain('30,00');
    });

    it('searches as you type and keeps the text in the URL', async () => {
      const h = await open();
      flushLedger(lresponse([lrow()]));
      await settle(h);
      const input = root(h).querySelector<HTMLInputElement>('input[aria-label="Buscar movimiento o documento"]');
      input!.value = 'TR-0031';
      input!.dispatchEvent(new Event('input'));
      await new Promise((resolve) => setTimeout(resolve, 400));
      await settle(h);
      const req = http.expectOne((r) => r.url === KARDEX_URL);
      expect(req.request.params.get('q')).toBe('TR-0031');
      req.flush(lresponse([lrow()]));
      await settle(h);
    });

    it('opens the document of a row from its menu', async () => {
      const h = await open();
      flushLedger(lresponse([lrow()]));
      await settle(h);
      root(h).querySelector<HTMLButtonElement>('rs-row-action button')?.click();
      h.detectChanges();
      const item = Array.from(root(h).querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) => el.textContent?.includes('Ver documento'));
      expect(item).toBeDefined();
      item?.click();
      await h.fixture.whenStable();
      expect(TestBed.inject(Router).url).toBe('/inventory/transfers/t1');
    });

    it('opens the kardex of the product of a row from its menu', async () => {
      const h = await open();
      flushLedger(lresponse([lrow({ documentLink: null })]));
      await settle(h);
      root(h).querySelector<HTMLButtonElement>('rs-row-action button')?.click();
      h.detectChanges();
      const items = Array.from(root(h).querySelectorAll<HTMLElement>('[role="menuitem"]'));
      expect(items.map((i) => i.textContent?.trim())).toEqual(['Ver kardex del producto']);
      items[0]?.click();
      await h.fixture.whenStable();
      h.detectChanges();
      const req = http.expectOne((r) => r.url === KARDEX_URL);
      expect(req.request.params.get('productId')).toBe(PRODUCT);
      req.flush(response([row()]));
      await settle(h);
      expect(text(h)).toContain('Saldo inicial');
    });

    it('goes back to the ledger from the kardex of a product', async () => {
      const h = await open(`/kardex?productId=${PRODUCT}`);
      flushKardex(response([row()]));
      await settle(h);
      Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Cambiar'))?.click();
      await h.fixture.whenStable();
      h.detectChanges();
      const req = http.expectOne((r) => r.url === KARDEX_URL);
      expect(req.request.params.has('productId')).toBe(false);
      req.flush(lresponse([lrow()]));
      await settle(h);
      expect(text(h)).toContain('Salida por transferencia TR-0031');
    });
  });

  it('shows a skeleton while the kardex loads', async () => {
    const h = await open(`/kardex?productId=${PRODUCT}`);
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    flushKardex(response([]));
  });

  it('sends the product, warehouse, dates and page of the URL to the API', async () => {
    const h = await open(`/kardex?productId=${PRODUCT}&warehouseId=w1&from=2026-09-01&to=2026-09-30&page=2`);
    const req = http.expectOne((r) => r.url === KARDEX_URL);
    expect(req.request.params.get('productId')).toBe(PRODUCT);
    expect(req.request.params.get('warehouseId')).toBe('w1');
    expect(req.request.params.get('from')).toBe('2026-09-01');
    expect(req.request.params.get('to')).toBe('2026-09-30');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('25');
    req.flush(response([]));
    await settle(h);
  });

  it('ignores a date that is not YYYY-MM-DD and lets the API use its month', async () => {
    const h = await open(`/kardex?productId=${PRODUCT}&from=hoy`);
    const req = http.expectOne((r) => r.url === KARDEX_URL);
    expect(req.request.params.has('from')).toBe(false);
    req.flush(response([]));
    await settle(h);
  });

  it('lists the product, the opening row, the movements and the closing totals', async () => {
    const h = await open(`/kardex?productId=${PRODUCT}`);
    flushKardex(response([row(), row({ id: 'm2', type: 'SALE', typeLabel: 'Venta', document: { refType: 'SALE', refNumber: 'V-00231' }, quantityIn: 0, quantityOut: 4, balance: 46, warehouseBalance: 46 })]));
    await settle(h);

    expect(headers(h)).toEqual(['Fecha', 'Tipo', 'Documento', 'Almacén', 'Usuario', 'Entrada', 'Salida', 'Saldo']);
    expect(text(h)).toContain('6205-2RS');
    expect(text(h)).toContain('Stock actual');
    const body = Array.from(root(h).querySelectorAll('rs-doc-table tbody tr')).map((tr) => tr.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    expect(body[0]).toContain('Saldo inicial');
    expect(body[0]).toContain('20');
    expect(body[1]).toContain('Compra');
    expect(body[1]).toContain('C-0001');
    expect(body[1]).toContain('Huayna Kapac · Principal');
    expect(body[2]).toContain('V-00231');
    const footer = root(h).querySelector('rs-doc-table tfoot')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    expect(footer).toContain('Saldo final');
    expect(footer).toContain('46');
    expect(text(h)).toContain('1–2 de 2 movimientos');
  });

  it('hides the cost columns without permission and shows them when the API sends costs', async () => {
    const plain = await open(`/kardex?productId=${PRODUCT}`);
    flushKardex(response([row()]));
    await settle(plain);
    expect(headers(plain)).not.toContain('Costo unit.');
    TestBed.resetTestingModule();

    const h = await open(`/kardex?productId=${PRODUCT}`, [VIEW, 'inventory.costs.view']);
    flushKardex(response([row({ unitCost: '5.0000', valueIn: '150.00', valueOut: null })], { includesCost: true }));
    await settle(h);
    expect(headers(h)).toEqual(expect.arrayContaining(['Costo unit.', 'Valor']));
    expect(text(h)).toContain('150,00');
  });

  it('keeps the opening balance and says so when the range has no movements', async () => {
    const h = await open(`/kardex?productId=${PRODUCT}`);
    flushKardex(response([], { openingBalance: 50, totals: { quantityIn: 0, quantityOut: 0, closingBalance: 50 } }));
    await settle(h);
    expect(text(h)).toContain('Sin movimientos en el período');
    expect(text(h)).toContain('Saldo inicial');
    expect(text(h)).toContain('Saldo final');
  });

  it('shows the error with a retry that asks again', async () => {
    const h = await open(`/kardex?productId=${PRODUCT}`);
    http.expectOne((r) => r.url === KARDEX_URL).flush({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse not found' }, { status: 404, statusText: 'Not Found' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar el kardex');
    expect(text(h)).toContain('El almacén elegido ya no existe o no lo operas.');

    const retry = Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar'));
    retry?.click();
    h.detectChanges();
    flushKardex(response([row()]));
    await settle(h);
    expect(text(h)).toContain('C-0001');
  });

  it('offers to go back to every movement when the product no longer exists', async () => {
    const h = await open(`/kardex?productId=${PRODUCT}`);
    http.expectOne((r) => r.url === KARDEX_URL).flush({ code: 'PRODUCT_NOT_FOUND', message: 'Product not found' }, { status: 404, statusText: 'Not Found' });
    await settle(h);
    expect(text(h)).toContain('Ver todos los movimientos');
    expect(text(h)).not.toContain('Reintentar');
  });

  it('shows the no-permission state and never calls the API without the permission', async () => {
    const h = await open(`/kardex?productId=${PRODUCT}`, []);
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver el kardex');
    http.expectNone((r) => r.url === KARDEX_URL);
  });

  it('shows the no-permission state when the API answers 403', async () => {
    const h = await open(`/kardex?productId=${PRODUCT}`);
    http.expectOne((r) => r.url === KARDEX_URL).flush({ code: 'NO_PERMISSION', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver el kardex');
  });

  it('puts the dates and warehouse in the URL when they change', async () => {
    const h = await open(`/kardex?productId=${PRODUCT}`);
    flushKardex(response([row()]));
    await settle(h);
    const router = TestBed.inject(Router);

    await router.navigate([], { queryParams: { warehouseId: 'w1', page: null }, queryParamsHandling: 'merge' });
    h.detectChanges();
    const req = http.expectOne((r) => r.url === KARDEX_URL);
    expect(req.request.params.get('warehouseId')).toBe('w1');
    req.flush(response([row()]));
    await settle(h);
  });

  it('searches products by text and opens the kardex of the one picked', async () => {
    const h = await open();
    http.expectOne((r) => r.url === KARDEX_URL).flush({ filters: {}, includesCost: false, totals: { quantityIn: 0, quantityOut: 0, net: 0 }, items: [], total: 0, page: 1, pageSize: 25 });
    await settle(h);
    const input = root(h).querySelector<HTMLInputElement>('input[aria-label="Buscar producto"]');
    expect(input).not.toBeNull();
    input!.value = '6205';
    input!.dispatchEvent(new Event('input'));
    await new Promise((resolve) => setTimeout(resolve, 400));

    const search = http.expectOne((r) => r.url === PRODUCTS_URL);
    expect(search.request.params.get('search')).toBe('6205');
    search.flush({
      items: [
        {
          id: PRODUCT,
          sku: 'RL-000001',
          manufacturerCode: '6205-2RS',
          name: 'Rodamiento rígido',
          photoUrl: null,
          brand: { id: 'br1', name: 'SKF' },
          country: null,
          category: { id: 'c1', name: 'Rodamientos', icon: 'bearing' },
          subcategory: null,
          dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15' },
          specs: [],
          totalStock: 50,
          branchStock: null,
          salePrice: '10.00',
          status: 'ACTIVE',
          hasMovements: true,
        },
      ],
      page: 1,
      pageSize: 8,
      total: 1,
    });
    await settle(h);
    expect(text(h)).toContain('25 × 52 × 15 mm');

    root(h).querySelector<HTMLButtonElement>('button.result')?.click();
    await h.fixture.whenStable();
    h.detectChanges();
    const req = http.expectOne((r) => r.url === KARDEX_URL);
    expect(req.request.params.get('productId')).toBe(PRODUCT);
    req.flush(response([row()]));
    await settle(h);
  });
});
