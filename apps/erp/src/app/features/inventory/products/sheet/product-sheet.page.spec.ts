import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  ProductDetail,
  ProductEquivalentItem,
  ProductEquivalentsResponse,
  ProductMovementsResponse,
} from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../../core/context.store';
import { PRODUCT_SHEET_ROUTE } from './product-sheet.routes';
import { ProductSheetPage } from './product-sheet.page';

@Component({ template: '' })
class EditStubPage {}

const URL = '/api/v1/inventory/products/p1';
const EQUIVALENTS_URL = `${URL}/equivalents`;
const MOVEMENTS: ProductMovementsResponse = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
  summary: { inLast30Days: 0, outLast30Days: 0, currentBalance: 0 },
};

const equivalent = (over: Partial<ProductEquivalentItem>): ProductEquivalentItem => ({
  productId: 'e1',
  manufacturerCode: '6205-DDU',
  brand: { id: 'b-nsk', name: 'NSK', logoUrl: null },
  country: { id: 'c-jp', code: 'JP', name: 'Japón' },
  totalStock: 18,
  salePrice: '230.00',
  status: 'ACTIVE',
  kind: 'WITH_DIFFERENCES',
  differences: [{ key: 'seal', label: 'Protección / sello', source: '2RS', other: 'DDU' }],
  ...over,
});

const equivalents = (items: ProductEquivalentItem[] = []): ProductEquivalentsResponse => ({
  source: equivalent({ productId: 'p1', manufacturerCode: '6205-2RS', kind: 'EXACT', differences: [], totalStock: 24 }),
  items,
  total: items.length,
  page: 1,
  pageSize: 3,
  summary: {
    brandCount: new Set(items.map((i) => i.brand.id)).size,
    exact: items.filter((i) => i.kind === 'EXACT').length,
    withDifferences: items.filter((i) => i.kind === 'WITH_DIFFERENCES').length,
    incompatible: items.filter((i) => i.kind === 'INCOMPATIBLE').length,
  },
  totals: { codes: items.length + 1, stock: 24 + items.reduce((sum, i) => sum + i.totalStock, 0) },
});

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
        provideRouter([
          { path: 'inventory/products/:id/edit', component: EditStubPage },
          { path: 'inventory', children: [PRODUCT_SHEET_ROUTE] },
        ]),
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

  /** Answers the detail request and then the equivalents request of the sheet. */
  const respond = (body: object, opts?: { status: number; statusText: string }, eq: ProductEquivalentsResponse | null = equivalents()) => {
    http.expectOne(URL).flush(body, opts);
    http.match((r) => r.url === EQUIVALENTS_URL).forEach((req) => {
      if (req.cancelled) return;
      if (eq) req.flush(eq);
      else req.flush({ code: 'ERROR', message: 'x' }, { status: 500, statusText: 'Server Error' });
    });
  };

  afterEach(() => http.verify());

  it('shows a skeleton while loading', async () => {
    const h = await open();
    h.detectChanges();
    expect(el(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    respond(detail());
  });

  it('renders identity, industry flag, KPIs, dimensions, specs, stock per branch and record', async () => {
    const h = await open();
    respond(detail());
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
    respond(detail({ dimensions: null, specs: [] }));
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
    respond(detail({ dimensions: null }));
    await settle(h);
    expect(el(h).querySelector('.diagram')).toBeNull();
    expect(el(h).querySelector('[aria-labelledby="dimensions-title"]')?.textContent).toContain('Serie de dimensiones');
  });

  it('gives every data field an icon', async () => {
    const h = await open();
    respond(detail());
    await settle(h);
    const fields = Array.from(el(h).querySelectorAll('rs-data-field'));
    expect(fields.length).toBeGreaterThan(10);
    expect(fields.every((f) => f.querySelector('rs-icon[aria-hidden="true"]'))).toBe(true);
  });

  it('hides cost and margin when the API does not send them', async () => {
    const h = await open();
    respond(detail());
    await settle(h);
    expect(text(h)).not.toContain('Costo');
    expect(text(h)).not.toContain('Margen');
  });

  it('shows the restricted cost and the margin when the API sends them', async () => {
    const h = await open();
    respond(detail({ pricing: { salePrice: '245.00', cost: '147.0000', marginPercent: '40.0' } }));
    await settle(h);
    expect(text(h)).toContain('Costo (restringido)');
    expect(text(h)).toContain("Bs 147,00");
    expect(text(h)).toContain('40,0 %');
    expect(text(h)).toContain('Costo Bs 147,00 · margen 40,0 %');
  });

  it('falls back to the code and hides the flag for an industry without one', async () => {
    const h = await open();
    respond(detail({ country: { id: 'c9', code: 'ZZ', name: 'Otro país' } }));
    await settle(h);
    expect(text(h)).toContain('Otro país');
    expect(el(h).querySelector('.identity rs-flag')).toBeNull();
  });

  it('shows the brand name in the media slot when it has no logo', async () => {
    const h = await open();
    respond(detail());
    await settle(h);
    expect(el(h).querySelector('.identity rs-chip-media')?.textContent).toContain('SKF');
  });

  it('offers Editar and Ajustar stock only with their permissions', async () => {
    const h = await open(['inventory.products.view']);
    respond(detail());
    await settle(h);
    expect(text(h)).not.toContain('Editar');
    expect(text(h)).not.toContain('Duplicar');
    expect(text(h)).not.toContain('Ajustar stock');
  });

  it('opens the duplicate dialog with this product from Duplicar and lands on the copy', async () => {
    const h = await open();
    respond(detail());
    await settle(h);
    const duplicate = Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Duplicar')) as HTMLButtonElement;
    duplicate.click();
    http.expectOne('/api/v1/inventory/filter-options').flush({
      countries: [{ id: 'c1', code: 'SE', name: 'Suecia' }],
      brands: [{ id: 'b1', name: 'SKF', logoUrl: null, countryId: 'c1' }],
      categories: [],
    });
    await settle(h);
    const dialog = el(h).querySelector('rs-duplicate-product-dialog [role=dialog]');
    expect(dialog?.textContent).toContain('Crea una copia de 6205-2RS · SKF');

    const code = el(h).querySelector('#duplicate-code') as HTMLInputElement;
    code.value = '6205-2RS-B';
    code.dispatchEvent(new Event('input'));
    (el(h).querySelector('button[type=submit]') as HTMLButtonElement).click();
    await settle(h);
    const req = http.expectOne('/api/v1/inventory/products/p1/duplicate');
    expect(req.request.body).toMatchObject({ manufacturerCode: '6205-2RS-B', brandId: 'b1', countryId: 'c1' });
    req.flush({ id: 'p2', sku: 'RL-000002', status: 'ACTIVE' });
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/products/p2/edit');
  });

  it('opens the edit wizard from Editar', async () => {
    const h = await open();
    respond(detail());
    await settle(h);
    const edit = Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Editar')) as HTMLButtonElement;
    edit.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/products/p1/edit');
  });

  it('keeps the coming-soon toast for Ajustar stock', async () => {
    const h = await open();
    respond(detail());
    await settle(h);
    const adjust = Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Ajustar stock')) as HTMLButtonElement;
    adjust.click();
    await settle(h);
    expect(text(h)).toContain('Esta acción estará disponible próximamente.');
  });

  it('opens the Movimientos and Stock por almacén tabs with their own requests', async () => {
    const h = await open();
    respond(detail());
    await settle(h);
    const tab = (label: string) =>
      Array.from(el(h).querySelectorAll('[role="tab"]')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement;

    tab('Movimientos').click();
    await settle(h);
    http.expectOne((r) => r.url === `${URL}/movements`).flush(MOVEMENTS);
    await settle(h);
    expect(text(h)).toContain('Sin movimientos registrados');
    expect(el(h).querySelector('rs-branch-stock-table')).toBeNull();

    tab('Stock por almacén').click();
    await settle(h);
    http.expectOne(`${URL}/stock`).flush({ items: [], total: 0 });
    await settle(h);
    expect(text(h)).toContain('Sin stock registrado');
  });

  describe('equivalents on the sheet', () => {
    const ITEMS = [
      equivalent({ productId: 'e0', manufacturerCode: '6205-2RSR', brand: { id: 'b-ntn', name: 'NTN', logoUrl: null }, kind: 'EXACT', differences: [] }),
      equivalent({}),
      equivalent({ productId: 'e2', manufacturerCode: '6205-2Z', brand: { id: 'b-skf', name: 'SKF', logoUrl: null } }),
    ];

    it('fills the Equivalentes KPI with the brands and the kinds', async () => {
      const h = await open();
      respond(detail(), undefined, equivalents(ITEMS));
      await settle(h);
      const kpi = Array.from(el(h).querySelectorAll('rs-kpi-card')).find((k) => k.textContent?.includes('Equivalentes'));
      expect(kpi?.querySelector('.value')?.textContent).toBe('3 marcas');
      expect(kpi?.querySelector('.note')?.textContent).toBe('1 exacta · 2 con diferencias');
    });

    it('lists the first equivalents in the card with a short pill and a link to the tab', async () => {
      const h = await open();
      respond(detail(), undefined, equivalents(ITEMS));
      await settle(h);
      const card = el(h).querySelector('[aria-labelledby="equivalents-card-title"]') as HTMLElement;
      expect(card.textContent).toContain('3 referencias de otras marcas');
      const rows = Array.from(card.querySelectorAll('.eq-list li'));
      expect(rows.map((r) => r.querySelector('.eq-code')?.textContent)).toEqual(['6205-2RSR', '6205-DDU', '6205-2Z']);
      expect(rows[0].querySelector('rs-status-pill')?.textContent).toContain('Exacta');
      expect(rows[1].querySelector('rs-status-pill')?.textContent).toContain('Con diferencias');
      expect(rows[1].querySelector('rs-status-pill')?.getAttribute('data-status')).toBe('warning');
      expect(card.querySelector('a.eq-link')?.getAttribute('href')).toContain('/equivalents');
      expect(card.querySelector('a.eq-link')?.textContent).toContain('Ver todas las equivalencias');
    });

    it('says there are no equivalents when the product has none', async () => {
      const h = await open();
      respond(detail());
      await settle(h);
      const card = el(h).querySelector('[aria-labelledby="equivalents-card-title"]') as HTMLElement;
      expect(card.textContent).toContain('Sin equivalentes registrados.');
      expect(card.querySelector('a.eq-link')).toBeNull();
      const kpi = Array.from(el(h).querySelectorAll('rs-kpi-card')).find((k) => k.textContent?.includes('Equivalentes'));
      expect(kpi?.querySelector('.value')?.textContent).toBe('–');
      expect(kpi?.querySelector('.note')?.textContent).toBe('Sin equivalentes registrados');
    });

    it('still shows the sheet when the equivalents cannot be loaded', async () => {
      const h = await open();
      respond(detail(), undefined, null);
      await settle(h);
      expect(text(h)).toContain('Rodamiento rígido 6205-2RS');
      // a failed request must not read as "no equivalents"
      const card = el(h).querySelector('[aria-labelledby="equivalents-card-title"]');
      expect(card?.textContent).toContain('No pudimos cargar los equivalentes.');
      expect(card?.textContent).not.toContain('Sin equivalentes registrados.');
    });
  });

  it('shows "Producto no encontrado" with a way back on 404', async () => {
    const h = await open();
    respond({ code: 'PRODUCT_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(h);
    expect(text(h)).toContain('Producto no encontrado');
    expect(text(h)).toContain('Volver a productos');
  });

  it('shows the no-permission state on 403', async () => {
    const h = await open();
    respond({ code: 'NO_PERMISSION', message: 'x' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver productos');
  });

  it('shows the error state and retries', async () => {
    const h = await open();
    respond({ code: 'INTERNAL', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar el producto');
    const retry = Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Reintentar') as HTMLButtonElement;
    retry.click();
    await settle(h);
    respond(detail());
    await settle(h);
    expect(text(h)).toContain('Rodamiento rígido 6205-2RS');
  });
});
