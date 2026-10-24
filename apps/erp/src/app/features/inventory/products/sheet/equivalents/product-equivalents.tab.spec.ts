import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ProductDetail, ProductEquivalentItem, ProductEquivalentsResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../../../core/context.store';
import { PRODUCT_SHEET_ROUTE } from '../product-sheet.routes';

@Component({ template: '' })
class BlankPage {}

const DETAIL_URL = '/api/v1/inventory/products/p1';
const EQUIVALENTS_URL = `${DETAIL_URL}/equivalents`;

const detail = (): ProductDetail =>
  ({
    id: 'p1',
    sku: 'RL-000001',
    manufacturerCode: '6205-2RS',
    name: 'Rodamiento 6205-2RS',
    unit: 'UN',
    status: 'ACTIVE',
    hasMovements: false,
    brand: { id: 'b-fag', name: 'FAG', logoUrl: null },
    country: null,
    category: { id: 'k', name: 'Rodamientos', icon: 'bearing' },
    subcategory: null,
    dimensions: null,
    specs: [],
    extra: { tariffCode: null, supplierName: null, sectors: null },
    pricing: { salePrice: '245.00' },
    totalStock: 24,
    stockByBranch: [],
    photos: [],
    datasheetUrl: null,
    createdAt: '2026-10-22T15:00:00Z',
    updatedAt: '2026-10-22T15:00:00Z',
    createdBy: null,
    updatedBy: null,
  }) as ProductDetail;

const item = (over: Partial<ProductEquivalentItem>): ProductEquivalentItem => ({
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

const ORIGINAL = item({ productId: 'p1', manufacturerCode: '6205-2RS', brand: { id: 'b-fag', name: 'FAG', logoUrl: null }, country: { id: 'c-de', code: 'DE', name: 'Alemania' }, kind: 'EXACT', differences: [], totalStock: 24, salePrice: '245.00' });

const response = (items: ProductEquivalentItem[], over: Partial<ProductEquivalentsResponse> = {}): ProductEquivalentsResponse => ({
  source: ORIGINAL,
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  summary: { brandCount: 2, exact: 1, withDifferences: 2, incompatible: 0 },
  totals: { codes: items.length + 1, stock: 42 },
  ...over,
});

const ITEMS = [
  item({ productId: 'e0', manufacturerCode: '6205-2RSR', brand: { id: 'b-ntn', name: 'NTN', logoUrl: null }, kind: 'EXACT', differences: [], totalStock: 6, salePrice: '250.00' }),
  item({}),
  item({
    productId: 'e2',
    manufacturerCode: '6205-2Z',
    brand: { id: 'b-skf', name: 'SKF', logoUrl: null },
    country: { id: 'c-se', code: 'SE', name: 'Suecia' },
    totalStock: 0,
    salePrice: '240.00',
    differences: [
      { key: 'seal', label: 'Protección / sello', source: '2RS', other: '2Z' },
      { key: 'cage', label: 'Material de la jaula', source: 'Acero', other: 'Poliamida' },
    ],
  }),
];

describe('ProductEquivalentsTab', () => {
  let http: HttpTestingController;

  async function open(url = '/inventory/products/p1/equivalents') {
    const permissions = new Set(['inventory.products.view']);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'inventory', children: [PRODUCT_SHEET_ROUTE] }, { path: 'inventory/equivalences/compare', component: BlankPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), branchId: signal('b') } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return harness;
  }
  const el = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => el(h).textContent ?? '';
  const settle = async (h: RouterTestingHarness) => {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  };
  /** The sheet loads the detail and the first equivalents; the tab then asks for its own page. */
  const answer = async (h: RouterTestingHarness, tab: ProductEquivalentsResponse | { status: number; body: object }) => {
    http.expectOne(DETAIL_URL).flush(detail());
    http.match((r) => r.url === EQUIVALENTS_URL && r.params.get('pageSize') === '3').forEach((r) => r.flush(response(ITEMS)));
    await settle(h);
    const req = http.expectOne((r) => r.url === EQUIVALENTS_URL && r.params.get('pageSize') === '10');
    if ('status' in tab) req.flush(tab.body, { status: tab.status, statusText: 'Error' });
    else req.flush(tab);
    await settle(h);
    return req;
  };

  afterEach(() => http.verify());

  it('shows the original first, the equivalents with their pills, the total and the range', async () => {
    const h = await open();
    await answer(h, response(ITEMS));

    expect(text(h)).toContain('Equivalentes por marca');
    expect(Array.from(el(h).querySelectorAll('rs-doc-table thead th')).map((t) => t.textContent?.trim())).toEqual([
      'Seleccionar para comparar',
      'Código',
      'Marca',
      'Industria',
      'Stock',
      'Precio (Bs)',
      'Diferencia',
    ]);
    const rows = Array.from(el(h).querySelectorAll('rs-doc-table tbody tr'));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.querySelector('td.code')?.textContent?.trim())).toEqual(['6205-2RS', '6205-2RSR', '6205-DDU', '6205-2Z']);
    expect(rows[0].querySelector('rs-status-pill')?.textContent).toContain('Original');
    expect(rows[1].querySelector('rs-status-pill')?.textContent).toContain('Exacta');
    expect(rows[2].querySelector('rs-status-pill')?.textContent).toContain('Protección / sello');
    expect(rows[3].querySelector('rs-status-pill')?.textContent).toContain('Protección / sello +1');
    // the original is not an equivalent of itself: its brand and price are still shown
    expect(rows[0].textContent).toContain('FAG');
    expect(rows[0].textContent).toContain('245,00');
    // the brand is plain text; the industry has the flag and the country name
    expect(rows[0].querySelector('td:nth-child(3) rs-flag')).toBeNull();
    expect(rows[0].querySelector('td:nth-child(4) rs-flag')).not.toBeNull();
    expect(rows[0].querySelector('td:nth-child(4)')?.textContent).toContain('Alemania');
    expect(rows[2].querySelector('td:nth-child(4)')?.textContent).toContain('Japón');
    expect(rows[3].querySelector('td:nth-child(4)')?.textContent).toContain('Suecia');
    // out of stock gets a flag
    expect(rows[3].querySelector('rs-stock-flag[data-level="out"]')).not.toBeNull();
    expect(rows[2].querySelector('rs-stock-flag')).toBeNull();

    const total = el(h).querySelector('rs-doc-table tfoot')?.textContent ?? '';
    expect(total).toContain('Total');
    expect(total).toContain('4 códigos');
    expect(total).toContain('42');
    expect(text(h)).toContain('1–4 de 4 registros');
  });

  it('gives the pill of a difference the full list in its tooltip host and a keyboard stop', async () => {
    const h = await open();
    await answer(h, response(ITEMS));
    const pills = Array.from(el(h).querySelectorAll('rs-doc-table rs-status-pill'));
    expect(pills[0].getAttribute('tabindex')).toBeNull();
    expect(pills[3].getAttribute('tabindex')).toBe('0');
    expect(pills[3].getAttribute('data-status')).toBe('warning');
  });

  it('shows an equivalent without industry with a dash', async () => {
    const h = await open();
    await answer(h, response([item({ country: null })]));
    const row = el(h).querySelectorAll('rs-doc-table tbody tr')[1];
    expect(row.querySelector('td:nth-child(4)')?.textContent?.trim()).toBe('–');
    expect(row.querySelector('td:nth-child(4) rs-flag')).toBeNull();
  });

  it('words the header and the price KPI as IN-02b does', async () => {
    const h = await open();
    await answer(h, response(ITEMS));
    // brand · measures · type (the sheet fixture has no measures)
    expect(text(h)).toContain('FAG · Rodamientos');
    expect(text(h)).not.toContain('registrado el');
    const price = Array.from(el(h).querySelectorAll('rs-kpi-card')).find((k) => k.textContent?.includes('Precio'));
    expect(price?.querySelector('.label')?.textContent).toBe('Precio (Bs)');
    expect(price?.querySelector('.value')?.textContent).toBe('245,00');
  });

  it('shows the KPI row with the equivalents summary', async () => {
    const h = await open();
    await answer(h, response(ITEMS));
    const kpi = Array.from(el(h).querySelectorAll('rs-kpi-card')).find((k) => k.textContent?.includes('Equivalentes'));
    expect(kpi?.querySelector('.value')?.textContent).toBe('2 marcas');
    expect(el(h).querySelector('rs-product-kpis')).not.toBeNull();
  });

  it('shows the illustrated empty state when there are no equivalents', async () => {
    const h = await open();
    await answer(h, response([], { summary: { brandCount: 0, exact: 0, withDifferences: 0, incompatible: 0 }, totals: { codes: 1, stock: 24 } }));
    expect(text(h)).toContain('Sin equivalentes registrados');
    expect(el(h).querySelector('rs-doc-table')).toBeNull();
  });

  it('shows the error state and retries', async () => {
    const h = await open();
    await answer(h, { status: 500, body: { code: 'INTERNAL', message: 'boom' } });
    expect(text(h)).toContain('No pudimos cargar los equivalentes');
    const retry = Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Reintentar') as HTMLButtonElement;
    retry.click();
    await settle(h);
    http.expectOne((r) => r.url === EQUIVALENTS_URL && r.params.get('pageSize') === '10').flush(response(ITEMS));
    await settle(h);
    expect(el(h).querySelectorAll('rs-doc-table tbody tr')).toHaveLength(4);
  });

  it('asks for the page of the URL and counts the original only on the first page', async () => {
    const h = await open('/inventory/products/p1/equivalents?page=2');
    http.expectOne(DETAIL_URL).flush(detail());
    http.match((r) => r.url === EQUIVALENTS_URL && r.params.get('pageSize') === '3').forEach((r) => r.flush(response(ITEMS)));
    await settle(h);
    const req = http.expectOne((r) => r.url === EQUIVALENTS_URL && r.params.get('pageSize') === '10');
    expect(req.request.params.get('page')).toBe('2');
    req.flush(response([ITEMS[1]], { page: 2, total: 11 }));
    await settle(h);
    expect(el(h).querySelectorAll('rs-doc-table tbody tr')).toHaveLength(1);
    expect(text(h)).toContain('12–12 de 12 registros');
  });

  it('goes to another page through the URL', async () => {
    const h = await open();
    await answer(h, response(ITEMS, { total: 25 }));
    const next = Array.from(el(h).querySelectorAll('rs-pagination button')).find((b) => b.textContent?.includes('Siguiente')) as HTMLButtonElement;
    next.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toContain('page=2');
    http.expectOne((r) => r.url === EQUIVALENTS_URL && r.params.get('page') === '2').flush(response([], { page: 2, total: 25 }));
    await settle(h);
  });

  describe('compare selection (HU-INV-12)', () => {
    const boxes = (h: RouterTestingHarness) => Array.from(el(h).querySelectorAll<HTMLInputElement>('rs-doc-table tbody input[type="checkbox"]'));
    const compareButton = (h: RouterTestingHarness) =>
      Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Comparar')) as HTMLButtonElement;
    const pick = async (h: RouterTestingHarness, ...indexes: number[]) => {
      for (const i of indexes) {
        boxes(h)[i].click();
        await settle(h);
      }
    };
    const FIVE = [
      ...ITEMS,
      item({ productId: 'e3', manufacturerCode: '6205-ZZ', brand: { id: 'b-ina', name: 'INA', logoUrl: null } }),
      item({ productId: 'e4', manufacturerCode: '6205-RS', brand: { id: 'b-koy', name: 'KOYO', logoUrl: null } }),
    ];

    it('adds a checkbox per row, original included, named after the code, and the Comparar button counts them', async () => {
      const h = await open();
      await answer(h, response(ITEMS));
      expect(boxes(h)).toHaveLength(4);
      expect(el(h).querySelector('rs-doc-table tbody tr .rs-visually-hidden')?.textContent?.trim()).toBe('6205-2RS');
      expect(compareButton(h).textContent).toContain('Comparar (0)');
      expect(compareButton(h).disabled).toBe(true);
      await pick(h, 1);
      expect(compareButton(h).textContent).toContain('Comparar (1)');
      expect(compareButton(h).disabled).toBe(true);
      await pick(h, 2);
      expect(compareButton(h).textContent).toContain('Comparar (2)');
      expect(compareButton(h).disabled).toBe(false);
    });

    it('disables the unchecked rows at four and frees them when one is unchecked', async () => {
      const h = await open();
      await answer(h, response(FIVE));
      await pick(h, 0, 1, 2, 3);
      expect(compareButton(h).disabled).toBe(false);
      expect(boxes(h).map((b) => b.disabled)).toEqual([false, false, false, false, true, true]);
      await pick(h, 3);
      expect(boxes(h).some((b) => b.disabled)).toBe(false);
    });

    it('opens the comparator with the checked products, the original first, and remembers the sheet', async () => {
      const h = await open();
      await answer(h, response(ITEMS));
      await pick(h, 2, 0, 3);
      compareButton(h).click();
      await settle(h);
      const url = TestBed.inject(Router).parseUrl(TestBed.inject(Router).url);
      expect(url.root.children['primary'].segments.map((s) => s.path)).toEqual(['inventory', 'equivalences', 'compare']);
      expect(url.queryParams).toEqual({ ids: 'p1,e1,e2', from: 'p1' });
    });

    it('does not offer the comparator when there are no equivalents', async () => {
      const h = await open();
      await answer(h, response([], { summary: { brandCount: 0, exact: 0, withDifferences: 0, incompatible: 0 }, totals: { codes: 1, stock: 24 } }));
      expect(compareButton(h)).toBeUndefined();
    });
  });
});
