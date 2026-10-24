import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EquivalenceComparisonColumn, EquivalenceComparisonResponse } from '@rodasoft/domain';
import { ContextStore } from '../../../../core/context.store';
import { EquivalenceComparePage } from './equivalence-compare.page';

const URL = '/api/v1/inventory/equivalences/compare';

@Component({ template: '' })
class BlankPage {}

const column = (over: Partial<EquivalenceComparisonColumn>): EquivalenceComparisonColumn => ({
  productId: 'p1',
  kind: 'EXACT',
  differences: [],
  manufacturerCode: '6205-2RS',
  brand: { id: 'b-skf', name: 'SKF', logoUrl: null },
  country: { id: 'c-se', code: 'SE', name: 'Suecia' },
  photoUrl: null,
  categoryIcon: 'bearing',
  totalStock: 24,
  salePrice: '245.00',
  status: 'ACTIVE',
  ...over,
});

const RESPONSE: EquivalenceComparisonResponse = {
  columns: [
    column({}),
    column({ productId: 'p2', manufacturerCode: '6205-2RSR', brand: { id: 'b-ntn', name: 'NTN', logoUrl: null }, country: { id: 'c-jp', code: 'JP', name: 'Japón' }, totalStock: 6, salePrice: '250.00' }),
    column({
      productId: 'p3',
      kind: 'WITH_DIFFERENCES',
      differences: [{ key: 'seal', label: 'Protección / sello', source: '2RS', other: '2Z' }],
      manufacturerCode: '6205-2Z',
      brand: { id: 'b-fag', name: 'FAG', logoUrl: null },
      country: null,
      totalStock: 0,
      salePrice: '240.00',
    }),
  ],
  rows: [
    { key: 'innerDiameter', label: 'd', unit: 'mm', group: 'MEASURES', values: ['25', '25', '25'], differs: false },
    { key: 'outerDiameter', label: 'D', unit: 'mm', group: 'MEASURES', values: ['52', '52', '52'], differs: false },
    { key: 'width', label: 'B', unit: 'mm', group: 'MEASURES', values: ['15', '15', '15'], differs: false },
    { key: 'country', label: 'country', unit: null, group: 'SPECS', values: ['Suecia', 'Japón', null], differs: true },
    { key: 'seal', label: 'Protección / sello', unit: null, group: 'SPECS', values: ['2RS', '2RS', '2Z'], differs: true },
    { key: 'cage', label: 'Material de la jaula', unit: null, group: 'SPECS', values: ['Acero', 'Acero', 'Acero'], differs: false },
    { key: 'dynamicLoad', label: 'Carga dinámica C', unit: 'kN', group: 'SPECS', values: ['14,8', '14,8', null], differs: true },
  ],
};

describe('EquivalenceComparePage', () => {
  let http: HttpTestingController;

  async function open(url = '/compare?ids=p1,p2,p3&from=p1', permissions: string[] = ['inventory.products.view']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'compare', component: EquivalenceComparePage },
          { path: 'inventory/products/:id', component: BlankPage },
          { path: 'inventory/products/:id/equivalents', component: BlankPage },
          { path: 'inventory/equivalences', component: BlankPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { can: (p: string) => permissions.includes(p) } },
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
  const loaded = async (url?: string, body: EquivalenceComparisonResponse = RESPONSE) => {
    const h = await open(url);
    http.expectOne((r) => r.url === URL).flush(body);
    await settle(h);
    return h;
  };
  const labels = (h: RouterTestingHarness) =>
    Array.from(el(h).querySelectorAll('tbody tr:not(.group) th[scope="row"]')).map((t) => t.textContent?.replace(/\s+/g, ' ').trim());

  afterEach(() => http.verify());

  it('asks for the products in the order of the URL and shows a skeleton meanwhile', async () => {
    const h = await open();
    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.params.get('ids')).toBe('p1,p2,p3');
    expect(el(h).querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
    req.flush(RESPONSE);
    await settle(h);
    expect(el(h).querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('shows one column per product and one row per attribute, in two groups', async () => {
    const h = await loaded();
    const heads = Array.from(el(h).querySelectorAll('thead th.product'));
    expect(heads.map((t) => t.querySelector('.code')?.textContent)).toEqual(['6205-2RS', '6205-2RSR', '6205-2Z']);
    expect(heads[1].textContent).toContain('NTN');
    expect(heads[1].querySelector('rs-flag')).not.toBeNull();
    expect(heads[2].querySelector('rs-flag')).toBeNull();
    expect(Array.from(el(h).querySelectorAll('tr.group th')).map((t) => t.textContent?.trim())).toEqual(['Medidas', 'Características']);
    expect(labels(h)).toEqual([
      'Diámetro interior (d)',
      'Diámetro exterior (D)',
      'Ancho (B)',
      'Industria Difiere',
      'Protección / sello Difiere',
      'Material de la jaula',
      'Carga dinámica C Difiere',
    ]);
    const seal = Array.from(el(h).querySelectorAll('tbody tr')).find((r) => r.textContent?.includes('Protección / sello')) as HTMLElement;
    expect(Array.from(seal.querySelectorAll('td')).map((t) => t.textContent?.trim())).toEqual(['2RS', '2RS', '2Z']);
  });

  it('writes the unit after the value and an em dash for a missing one', async () => {
    const h = await loaded();
    const load = Array.from(el(h).querySelectorAll('tbody tr')).find((r) => r.textContent?.includes('Carga dinámica')) as HTMLElement;
    expect(Array.from(load.querySelectorAll('td')).map((t) => t.textContent?.trim())).toEqual(['14,8 kN', '14,8 kN', '—']);
    expect(load.querySelectorAll('td.missing')).toHaveLength(1);
  });

  it('highlights the rows that differ and marks them with text, not only with colour', async () => {
    const h = await loaded();
    const differing = Array.from(el(h).querySelectorAll('tbody tr.differs'));
    expect(differing).toHaveLength(3);
    for (const r of differing) expect(r.querySelector('.marker')?.textContent).toContain('Difiere');
    expect(el(h).querySelectorAll('tbody tr:not(.differs):not(.group)')).toHaveLength(4);
    expect(text(h)).toContain('3 filas difieren del primero');
  });

  it('says whether each product is the reference, exact or has differences', async () => {
    const h = await loaded();
    const pills = Array.from(el(h).querySelectorAll('thead rs-status-pill'));
    expect(pills.map((p) => p.textContent?.trim())).toEqual(['Referencia', 'Exacta', 'Con diferencias']);
    expect(pills[2].getAttribute('data-status')).toBe('warning');
    expect(pills[2].getAttribute('tabindex')).toBe('0');
  });

  it('shows the stock (with the out-of-stock flag) and the price of each product', async () => {
    const h = await loaded();
    const heads = Array.from(el(h).querySelectorAll('thead th.product'));
    expect(heads[0].textContent).toContain('Stock 24');
    expect(heads[0].textContent).toContain('Bs 245,00');
    expect(heads[0].querySelector('rs-stock-flag')).toBeNull();
    expect(heads[2].querySelector('rs-stock-flag[data-level="out"]')).not.toBeNull();
  });

  it('hides the rows that are equal with "Solo diferencias"', async () => {
    const h = await loaded();
    const toggle = el(h).querySelector('rs-switch input') as HTMLInputElement;
    toggle.click();
    await settle(h);
    expect(labels(h)).toEqual(['Industria Difiere', 'Protección / sello Difiere', 'Carga dinámica C Difiere']);
    // the Medidas group has no differing row, so it disappears
    expect(Array.from(el(h).querySelectorAll('tr.group th')).map((t) => t.textContent?.trim())).toEqual(['Características']);
    toggle.click();
    await settle(h);
    expect(labels(h)).toHaveLength(7);
  });

  it('says so when "Solo diferencias" leaves nothing', async () => {
    const equal = { ...RESPONSE, rows: RESPONSE.rows.map((r) => ({ ...r, differs: false })) };
    const h = await loaded('/compare?ids=p1,p2,p3', equal);
    (el(h).querySelector('rs-switch input') as HTMLInputElement).click();
    await settle(h);
    expect(text(h)).toContain('Los productos no tienen diferencias.');
  });

  it('removes a column through the URL and loads the comparison again', async () => {
    const h = await loaded();
    const remove = el(h).querySelector('button[aria-label="Quitar 6205-2RSR de la comparación"]') as HTMLButtonElement;
    remove.click();
    await settle(h);
    expect(TestBed.inject(Router).url).toContain('ids=p1,p3');
    expect(TestBed.inject(Router).url).toContain('from=p1');
    const req = http.expectOne((r) => r.url === URL);
    expect(req.request.params.get('ids')).toBe('p1,p3');
    req.flush({ columns: [RESPONSE.columns[0], RESPONSE.columns[2]], rows: RESPONSE.rows.map((r) => ({ ...r, values: [r.values[0], r.values[2]] })) });
    await settle(h);
    expect(el(h).querySelectorAll('thead th.product')).toHaveLength(2);
  });

  it('cannot drop below two products', async () => {
    const h = await loaded('/compare?ids=p1,p3', { columns: [RESPONSE.columns[0], RESPONSE.columns[2]], rows: [] });
    expect(el(h).querySelector('thead button[aria-label^="Quitar"]')).toBeNull();
  });

  it('opens the sheet of a product from its header', async () => {
    const h = await loaded();
    (el(h).querySelector('thead button.open') as HTMLButtonElement).click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/products/p1');
  });

  it('goes back to the sheet the user came from, or to the equivalence table', async () => {
    const h = await loaded();
    const back = () => Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Volver')) as HTMLButtonElement;
    back().click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/products/p1/equivalents');
  });

  it('shows the invalid-selection note, with no request, when there are fewer than 2 or more than 4 products', async () => {
    for (const ids of ['p1', 'a,b,c,d,e']) {
      TestBed.resetTestingModule();
      const h = await open(`/compare?ids=${ids}`);
      http.expectNone((r) => r.url === URL);
      await settle(h);
      expect(text(h)).toContain('Selección no válida');
      expect(text(h)).toContain('Elige entre 2 y 4 productos');
      http.verify();
    }
  });

  it('shows the same note when the API refuses the selection', async () => {
    const h = await open('/compare?ids=p1,p2');
    http.expectOne((r) => r.url === URL).flush({ code: 'COMPARE_INVALID_SELECTION', message: 'bad' }, { status: 400, statusText: 'Bad Request' });
    await settle(h);
    expect(text(h)).toContain('Selección no válida');
  });

  it('shows the error state and retries', async () => {
    const h = await open();
    http.expectOne((r) => r.url === URL).flush({ code: 'PRODUCT_NOT_FOUND', message: 'nf' }, { status: 404, statusText: 'Not Found' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar la comparación');
    expect(text(h)).toContain('El producto ya no existe');
    (Array.from(el(h).querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Reintentar') as HTMLButtonElement).click();
    await settle(h);
    http.expectOne((r) => r.url === URL).flush(RESPONSE);
    await settle(h);
    expect(el(h).querySelectorAll('thead th.product')).toHaveLength(3);
  });

  it('shows the no-permission state, with no request, to a user who cannot view products', async () => {
    const h = await open('/compare?ids=p1,p2', []);
    http.expectNone((r) => r.url === URL);
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para comparar equivalentes');
    expect(el(h).querySelector('table')).toBeNull();
  });

  it('shows the no-permission state when the API answers 403', async () => {
    const h = await open('/compare?ids=p1,p2');
    http.expectOne((r) => r.url === URL).flush({ code: 'NO_PERMISSION', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para comparar equivalentes');
  });
});
