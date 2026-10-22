import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ProductDetail } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../../core/context.store';
import { PRODUCT_SHEET_ROUTE } from './product-sheet.routes';
import { ProductSheetPage } from './product-sheet.page';

const URL = '/api/v1/inventory/products/p1';

const detail = (over: Partial<ProductDetail> = {}): ProductDetail => ({
  id: 'p1',
  sku: 'RL-000001',
  manufacturerCode: '6205-2RS',
  name: 'Rodamiento rígido 6205-2RS',
  unit: 'UN',
  status: 'ACTIVE',
  brand: { id: 'b1', name: 'SKF', logoUrl: null },
  country: { id: 'c1', code: 'SE', name: 'Suecia' },
  category: { id: 'k1', name: 'Rodamientos', icon: 'bearing' },
  subcategory: { id: 'k2', name: 'Rígidos de bolas' },
  dimensions: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000', weight: '0.130' },
  specs: [
    { key: 'series', step: 2, label: 'Serie de dimensiones', type: 'TEXT', unit: null, value: '62' },
    { key: 'seal', step: 3, label: 'Protección / sello', type: 'ENUM', unit: null, value: '2RS (goma, contacto)' },
    { key: 'dynamicLoad', step: 3, label: 'Carga dinámica C', type: 'NUMBER', unit: 'kN', value: 14.8 },
  ],
  extra: { tariffCode: '8482.10.00', supplierName: null, sectors: 'Minería, Industria' },
  pricing: { salePrice: '245.00' },
  totalStock: 60,
  stockByBranch: [
    { branchId: 'a', branchName: 'Central', warehouses: ['Almacén principal'], quantity: 40, minStock: 6, maxStock: 60, location: 'A-03-2', availability: 'available' },
    { branchId: 'b', branchName: 'Norte', warehouses: ['Almacén Norte'], quantity: 4, minStock: 6, maxStock: 60, location: null, availability: 'low' },
    { branchId: 'c', branchName: 'Sur', warehouses: ['Almacén Sur'], quantity: 0, minStock: null, maxStock: null, location: null, availability: 'out' },
  ],
  photos: ['https://img.test/a.png'],
  datasheetUrl: 'https://img.test/ficha.pdf',
  createdAt: '2026-10-22T15:00:00Z',
  updatedAt: '2026-10-23T15:00:00Z',
  createdBy: { id: 'u1', name: 'Ana Rojas' },
  updatedBy: null,
  ...over,
});

describe('ProductSheetPage', () => {
  let http: HttpTestingController;

  async function open(granted = ['inventory.products.view', 'inventory.products.edit', 'inventory.adjustments.create']) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'inventory', children: [PRODUCT_SHEET_ROUTE] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), branchId: signal('b') } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/inventory/products/p1', ProductSheetPage);
    return harness;
  }
  const el = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => el(h).textContent ?? '';
  const settle = async (h: RouterTestingHarness) => {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  };

  afterEach(() => http.verify());

  it('shows a skeleton while loading', async () => {
    const h = await open();
    h.detectChanges();
    expect(el(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(URL).flush(detail());
  });

  it('renders identity, industry flag, KPIs, dimensions, specs, stock per branch and record', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);

    const t = text(h);
    expect(t).toContain('Rodamiento rígido 6205-2RS');
    expect(t).toContain('Rígidos de bolas · SKF · registrado el');
    expect(t).toContain('por Ana Rojas');
    expect(t).toContain('Código del fabricante');
    expect(t).toContain('SKU interno');
    expect(t).toContain('RL-000001');
    expect(t).toContain('Activo');
    expect(el(h).querySelector('.identity rs-flag')).not.toBeNull();
    expect(t).toContain('País de origen:');
    expect(t).toContain('Suecia');
    expect(Array.from(el(h).querySelectorAll('.tags li')).map((l) => l.textContent?.trim())).toEqual(['Minería', 'Industria']);
    expect(t).toContain('60 uds');
    expect(t).toContain('3 sucursales · mínimo 6');

    // dimensions card: d, D, B, weight and the dimension-step specs
    const dims = el(h).querySelector('[aria-labelledby="dimensions-title"]')?.textContent ?? '';
    expect(dims).toContain('Interior d');
    expect(dims).toContain('25 mm');
    expect(dims).toContain('0,13 kg');
    expect(dims).toContain('Serie de dimensiones');
    expect(dims).not.toContain('Protección / sello');
    // specifications card: the technical-step specs only
    const specs = el(h).querySelector('[aria-labelledby="specs-title"]')?.textContent ?? '';
    expect(specs).toContain('Protección / sello');
    expect(specs).toContain('14,8 kN');
    expect(specs).not.toContain('Serie de dimensiones');
    // price card: shared limits and missing supplier shown as a dash
    const price = el(h).querySelector('[aria-labelledby="price-title"]')?.textContent ?? '';
    expect(price).toContain('Piezas');
    expect(price).toContain('Partida arancelaria');
    expect(price).toContain('8482.10.00');
    expect(price).toContain('Proveedor habitual');
    expect(el(h).querySelector('rs-data-field[data-type="empty"]')?.textContent).toContain('Proveedor habitual');

    // compact stock list of the side column
    expect(el(h).querySelector('#stock-title')?.textContent).toContain('Stock por sucursal');
    expect(text(h)).toContain('Mínimo 6 · máximo 60');
    const rows = Array.from(el(h).querySelectorAll('.stock-list li'));
    expect(rows).toHaveLength(3);
    expect(rows[1].querySelector('rs-stock-flag[data-level="low"]')?.getAttribute('aria-label')).toBe('Stock bajo');
    expect(rows[2].querySelector('rs-stock-flag[data-level="out"]')?.getAttribute('aria-label')).toBe('Agotado');
    // the active branch (Norte) is the marked one
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    expect(el(h).querySelector('.stock-total')?.textContent).toContain('60');

    // datasheet and record
    expect(el(h).querySelector('a[href="https://img.test/ficha.pdf"]')?.textContent).toContain('Descargar');
    expect(text(h)).toContain('ficha.pdf');
    expect(el(h).querySelector('.record')?.textContent).toContain('Ana Rojas');
  });

  it('keeps the Dimensiones and Especificaciones cards with an explanation when the product has no data', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ dimensions: null, specs: [] }));
    await settle(h);
    expect(el(h).querySelector('[aria-labelledby="dimensions-title"]')?.textContent).toContain(
      'Este producto no tiene medidas registradas.',
    );
    expect(el(h).querySelector('[aria-labelledby="specs-title"]')?.textContent).toContain(
      'Esta categoría aún no tiene especificaciones definidas.',
    );
    expect(el(h).querySelector('.diagram')).toBeNull();
  });

  it('shows the dimension-step fields without the diagram when only they exist', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ dimensions: null }));
    await settle(h);
    expect(el(h).querySelector('.diagram')).toBeNull();
    expect(el(h).querySelector('[aria-labelledby="dimensions-title"]')?.textContent).toContain('Serie de dimensiones');
  });

  it('gives every data field an icon', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);
    const fields = Array.from(el(h).querySelectorAll('rs-data-field'));
    expect(fields.length).toBeGreaterThan(10);
    expect(fields.every((f) => f.querySelector('rs-icon[aria-hidden="true"]'))).toBe(true);
  });

  it('hides cost and margin when the API does not send them', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);
    expect(text(h)).not.toContain('Costo');
    expect(text(h)).not.toContain('Margen');
  });

  it('shows the restricted cost and the margin when the API sends them', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ pricing: { salePrice: '245.00', cost: '147.0000', marginPercent: '40.0' } }));
    await settle(h);
    expect(text(h)).toContain('Costo (restringido)');
    expect(text(h)).toContain("Bs 147,00");
    expect(text(h)).toContain('40,0 %');
    expect(text(h)).toContain('Costo Bs 147,00 · margen 40,0 %');
  });

  it('falls back to the code and hides the flag for an industry without one', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ country: { id: 'c9', code: 'ZZ', name: 'Otro país' } }));
    await settle(h);
    expect(text(h)).toContain('Otro país');
    expect(el(h).querySelector('.identity rs-flag')).toBeNull();
  });

  it('shows the brand name in the media slot when it has no logo', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);
    expect(el(h).querySelector('.identity rs-chip-media')?.textContent).toContain('SKF');
  });

  it('offers Editar and Ajustar stock only with their permissions', async () => {
    const h = await open(['inventory.products.view']);
    http.expectOne(URL).flush(detail());
    await settle(h);
    expect(text(h)).not.toContain('Editar');
    expect(text(h)).not.toContain('Ajustar stock');
  });

  it('shows the coming-soon toast from Editar', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);
    const edit = Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Editar')) as HTMLButtonElement;
    edit.click();
    await settle(h);
    expect(text(h)).toContain('Esta acción estará disponible próximamente.');
  });

  it('shows the placeholders of the Equivalentes and Movimientos tabs', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);
    const tab = (label: string) =>
      Array.from(el(h).querySelectorAll('[role="tab"]')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;
    tab('Movimientos').click();
    await settle(h);
    expect(text(h)).toContain('Disponible próximamente');
    expect(el(h).querySelector('rs-branch-stock-table')).toBeNull();
  });

  it('shows "Producto no encontrado" with a way back on 404', async () => {
    const h = await open();
    http.expectOne(URL).flush({ code: 'PRODUCT_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(h);
    expect(text(h)).toContain('Producto no encontrado');
    expect(text(h)).toContain('Volver a productos');
  });

  it('shows the no-permission state on 403', async () => {
    const h = await open();
    http.expectOne(URL).flush({ code: 'NO_PERMISSION', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver productos');
  });

  it('shows the error state and retries', async () => {
    const h = await open();
    http.expectOne(URL).flush({ code: 'INTERNAL', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar el producto');
    const retry = Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Reintentar') as HTMLButtonElement;
    retry.click();
    await settle(h);
    http.expectOne(URL).flush(detail());
    await settle(h);
    expect(text(h)).toContain('Rodamiento rígido 6205-2RS');
  });
});
