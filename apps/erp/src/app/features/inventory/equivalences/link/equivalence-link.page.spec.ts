import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EquivalenceValidationResponse, ProductDetail, ProductListItem } from '@rodasoft/domain';
import { RS_PERMISSIONS, ToastService } from '@rodasoft/ui';
import { ContextStore } from '../../../../core/context.store';
import { EquivalenceLinkPage } from './equivalence-link.page';

const PRODUCTS_URL = '/api/v1/inventory/products';
const DETAIL_URL = `${PRODUCTS_URL}/p1`;
const VALIDATE_URL = '/api/v1/inventory/equivalences/validate';
const LINK_URL = '/api/v1/inventory/equivalences';

const detail = (): ProductDetail =>
  ({
    id: 'p1',
    manufacturerCode: '6205-2RS',
    brand: { id: 'b-skf', name: 'SKF', logoUrl: null },
    country: { id: 'c-se', code: 'SE', name: 'Suecia' },
    photos: [],
    category: { id: 'k1', name: 'Rodamientos', icon: 'bearing' },
    dimensions: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000', weight: null },
  }) as unknown as ProductDetail;

const listItem = (id: string, code: string, brand = 'NSK', dims = { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000' }): ProductListItem =>
  ({
    id,
    sku: `RL-${id}`,
    manufacturerCode: code,
    name: `Rodamiento ${code}`,
    photoUrl: null,
    brand: { id: `b-${brand.toLowerCase()}`, name: brand, logoUrl: null },
    country: { id: 'c-jp', code: 'JP', name: 'Japón' },
    category: { id: 'k1', name: 'Rodamientos', icon: 'bearing' },
    subcategory: null,
    dimensions: dims,
    specs: [],
    totalStock: 3,
    branchStock: null,
    salePrice: '10.00',
    status: 'ACTIVE',
    hasMovements: false,
  }) as ProductListItem;

const verdict = (over: Partial<EquivalenceValidationResponse> = {}): EquivalenceValidationResponse => ({
  selfLink: false,
  exists: false,
  equivalenceId: null,
  typeDiffers: false,
  kind: 'EXACT',
  measureDifferences: [],
  differences: [],
  ...over,
});

@Component({ template: '' })
class BlankPage {}

describe('EquivalenceLinkPage', () => {
  let http: HttpTestingController;

  async function open(url = '/equivalences/new?productId=p1') {
    const permissions = new Set(['inventory.products.view', 'inventory.equivalences.link']);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'equivalences/new', component: EquivalenceLinkPage },
          { path: 'inventory/equivalences', component: BlankPage },
          { path: 'inventory/products/:id/equivalents', component: BlankPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p), context: () => ({ user: { name: 'Alberto Andia' } }) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, EquivalenceLinkPage);
    if (url.includes('productId')) http.expectOne(DETAIL_URL).flush(detail());
    await settle(harness);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    // what the origin is already linked to: one product, which the search must not offer again
    http.match((r) => /\/products\/[^/]+\/equivalents$/.test(r.url)).forEach((r) => r.flush({ items: [{ productId: 'p-linked' }] }));
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  /** The search waits 250 ms after the last key before it asks. */
  const debounced = async (h: RouterTestingHarness) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle(h);
  };
  const button = (h: RouterTestingHarness, label: string) =>
    Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim().includes(label));
  const click = async (h: RouterTestingHarness, label: string) => {
    button(h, label)!.click();
    await settle(h);
  };

  async function search(h: RouterTestingHarness, side: 'origen' | 'equivalente', query: string, found: ProductListItem[]) {
    const input = root(h).querySelector<HTMLInputElement>(`input[type=search][aria-label="Buscar rodamiento ${side === 'origen' ? 'de origen' : 'equivalente'}"]`)!;
    input.value = query;
    input.dispatchEvent(new Event('input'));
    await debounced(h);
    const req = http.expectOne((r) => r.url === PRODUCTS_URL);
    expect(req.request.params.get('search')).toBe(query);
    expect(req.request.params.get('status')).toBe('ACTIVE');
    req.flush({ items: found, page: 1, pageSize: 6, total: found.length, catalogEmpty: false });
    await settle(h);
  }

  /** Picks the equivalent and answers the check of the pair. */
  async function pickEquivalent(h: RouterTestingHarness, found: ProductListItem, answer: EquivalenceValidationResponse = verdict()) {
    await search(h, 'equivalente', found.manufacturerCode, [found]);
    root(h).querySelector<HTMLButtonElement>('.result')!.click();
    await settle(h);
    http.expectOne(VALIDATE_URL).flush(answer);
    await settle(h);
  }


  afterEach(() => http.verify());

  describe('IN-15c · the form', () => {
    it('lays out the screen of the design: header, card, fields with their hints, info note and action bar', async () => {
      const h = await open();
      expect(root(h).querySelector('rs-page-header')?.textContent).toContain('Vincular equivalencia');
      expect(root(h).querySelector('rs-page-header')?.textContent).toContain('Relaciona un rodamiento con su equivalente de otra marca y registra en qué se diferencian.');
      const crumbs = text(h);
      for (const label of ['Inicio', 'Inventario', 'Equivalencias']) expect(crumbs).toContain(label);
      expect(text(h)).toContain('Datos de la equivalencia');
      for (const label of ['Rodamiento de origen', 'Rodamiento equivalente', 'Tipo de equivalencia', 'Registrada por', 'Diferencias observadas']) {
        expect(text(h)).toContain(label);
      }
      for (const hint of [
        'Busca por código, medida o marca.',
        'Debe ser de una marca distinta al origen.',
        'Exacta, con diferencias o sustituto.',
        'Se muestra al vendedor antes de ofrecer el equivalente.',
      ]) {
        expect(text(h)).toContain(hint);
      }
      expect(root(h).querySelector('rs-note[data-type=info]')?.textContent).toContain('Se registra con usuario y fecha');
      expect(button(h, 'Cancelar')).toBeDefined();
      expect(button(h, 'Guardar equivalencia')!.disabled).toBe(true);
    });

    it('fills the origin with the product of the sheet, fixed, and registers who links', async () => {
      const h = await open();
      expect(root(h).querySelector('#link-origin')?.textContent).toContain('6205-2RS · SKF');
      // the measures are in the tooltip: the field is one line, as in the design
      expect(root(h).querySelector('#link-origin .chosen-text')?.getAttribute('title')).toBe('25×52×15 mm');
      // only the equivalent is searched
      expect(root(h).querySelectorAll('input[type=search]')).toHaveLength(1);
      expect(button(h, 'Cambiar')).toBeUndefined();
      expect((root(h).querySelector('#link-registered-by') as HTMLInputElement).value).toMatch(/^Alberto Andia · \d{1,2} \p{L}+ \d{4}$/u);
    });

    it('searches the origin too when the form has no product to start from', async () => {
      const h = await open('/equivalences/new');
      expect(root(h).querySelectorAll('input[type=search]')).toHaveLength(2);
      await search(h, 'origen', '6205-2RS', [listItem('p1', '6205-2RS', 'SKF')]);
      root(h).querySelector<HTMLButtonElement>('.result')!.click();
      await settle(h);
      expect(root(h).querySelectorAll('input[type=search]')).toHaveLength(1);
      expect(button(h, 'Cambiar')).toBeDefined();
      await click(h, 'Cambiar');
      expect(root(h).querySelectorAll('input[type=search]')).toHaveLength(2);
    });

    it('asks nothing until a product is picked, and lists the matches with code, brand and measures', async () => {
      const h = await open();
      await search(h, 'equivalente', '6205', [listItem('p2', '6205-DDU'), listItem('p3', '6205-2Z', 'FAG')]);
      const results = Array.from(root(h).querySelectorAll('.result'));
      expect(results).toHaveLength(2);
      expect(results[0].textContent).toContain('6205-DDU · NSK');
      expect(results[0].textContent).toContain('25×52×15 mm');
      expect(results[0].querySelector('rs-flag')).not.toBeNull();
    });

    it('says when the search finds nothing, and when it fails', async () => {
      const h = await open();
      await search(h, 'equivalente', 'zzz', []);
      expect(text(h)).toContain('No encontramos productos con esa búsqueda.');
      const input = root(h).querySelector<HTMLInputElement>('input[type=search]')!;
      input.value = 'abc';
      input.dispatchEvent(new Event('input'));
      await debounced(h);
      http.expectOne((r) => r.url === PRODUCTS_URL).flush({}, { status: 500, statusText: 'Error' });
      await settle(h);
      expect(text(h)).toContain('No pudimos buscar productos. Intenta de nuevo.');
    });

    it('checks the pair as soon as the equivalent is picked, and shows the computed type', async () => {
      const h = await open();
      await search(h, 'equivalente', '6205-DDU', [listItem('p2', '6205-DDU')]);
      root(h).querySelector<HTMLButtonElement>('.result')!.click();
      await settle(h);
      const req = http.expectOne(VALIDATE_URL);
      expect(req.request.body).toEqual({ productAId: 'p1', productBId: 'p2' });
      // while the API answers: a skeleton, and nothing can be saved
      expect(root(h).querySelector('[aria-label="Comprobando el vínculo"]')).not.toBeNull();
      expect(button(h, 'Guardar equivalencia')!.disabled).toBe(true);
      req.flush(verdict({ kind: 'WITH_DIFFERENCES', differences: [{ key: 'seal', label: 'Protección / sello', source: '2RS', other: 'DDU' }] }));
      await settle(h);
      expect(root(h).querySelector('#link-type')?.textContent).toContain('Con diferencias');
      expect(root(h).querySelector('.differences')?.textContent).toContain('Protección / sello: 2RS → DDU');
      expect(button(h, 'Guardar equivalencia')!.disabled).toBe(false);
    });

    it('saves an exact pair, tells the user, and goes back to the sheet it came from', async () => {
      const h = await open();
      const success = jest.spyOn(TestBed.inject(ToastService), 'success');
      await pickEquivalent(h, listItem('p2', '6205-2RSR', 'NTN'));
      expect(root(h).querySelector('#link-type')?.textContent).toContain('Exacta');
      await click(h, 'Guardar equivalencia');
      const req = http.expectOne(LINK_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ productAId: 'p1', productBId: 'p2', substitute: false });
      req.flush({ id: 'e1', productAId: 'p1', productBId: 'p2' });
      await settle(h);
      expect(success).toHaveBeenCalledWith('Equivalencia vinculada');
      expect(TestBed.inject(Router).url).toBe('/inventory/products/p1/equivalents');
    });

    it('sends the observed differences, trimmed, and the substitute classification', async () => {
      const h = await open();
      await pickEquivalent(h, listItem('p2', '6205-DDU'), verdict({ kind: 'WITH_DIFFERENCES' }));
      const notes = root(h).querySelector<HTMLTextAreaElement>('#link-notes')!;
      notes.value = '  Sello de contacto frente a escudo metálico.  ';
      notes.dispatchEvent(new Event('input'));
      root(h).querySelector<HTMLElement>('#link-type')!.click();
      await settle(h);
      Array.from(root(h).querySelectorAll<HTMLElement>('[role=option]')).find((o) => o.textContent?.includes('Sustituto'))!.click();
      await settle(h);
      expect(root(h).querySelector('#link-type')?.textContent).toContain('Sustituto');
      await click(h, 'Guardar equivalencia');
      const req = http.expectOne(LINK_URL);
      expect(req.request.body).toEqual({ productAId: 'p1', productBId: 'p2', substitute: true, notes: 'Sello de contacto frente a escudo metálico.' });
      req.flush({ id: 'e1', productAId: 'p1', productBId: 'p2' });
      await settle(h);
    });

    it('limits the observed differences to 500 characters', async () => {
      const h = await open();
      const notes = root(h).querySelector<HTMLTextAreaElement>('#link-notes')!;
      expect(notes.getAttribute('maxlength')).toBe('500');
    });

    it('shows the error and stays when saving fails', async () => {
      const h = await open();
      await pickEquivalent(h, listItem('p2', '6205-2RSR', 'NTN'));
      await click(h, 'Guardar equivalencia');
      http.expectOne(LINK_URL).flush({ code: 'ERROR', message: 'boom' }, { status: 500, statusText: 'Error' });
      await settle(h);
      expect(root(h).querySelector('rs-note[data-type=danger]')?.textContent).toContain('No se pudo guardar');
      expect(root(h).querySelector('rs-note[data-type=danger]')?.textContent).toContain('boom');
      expect(TestBed.inject(Router).url).toContain('/equivalences/new');
    });

    it('cancels back to the sheet, or to the table when it did not come from one', async () => {
      const h = await open();
      await click(h, 'Cancelar');
      expect(TestBed.inject(Router).url).toBe('/inventory/products/p1/equivalents');

      TestBed.resetTestingModule();
      const fresh = await open('/equivalences/new');
      await click(fresh, 'Cancelar');
      expect(TestBed.inject(Router).url).toBe('/inventory/equivalences');
    });

    it('reports a product of origin that cannot be opened', async () => {
      TestBed.configureTestingModule({
        providers: [
          provideRouter([{ path: 'equivalences/new', component: EquivalenceLinkPage }]),
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: RS_PERMISSIONS, useValue: signal(new Set(['inventory.equivalences.link'])) },
          { provide: ContextStore, useValue: { can: () => true, context: () => ({ user: { name: 'A' } }) } },
        ],
      });
      http = TestBed.inject(HttpTestingController);
      const h = await RouterTestingHarness.create();
      await h.navigateByUrl('/equivalences/new?productId=p1', EquivalenceLinkPage);
      http.expectOne(DETAIL_URL).flush({}, { status: 404, statusText: 'Not Found' });
      await settle(h);
      expect(text(h)).toContain('No pudimos abrir el producto de origen');
    });
  });

  describe('IN-15d · the link already exists', () => {
    it('shows the error under the equivalent, the red note, and blocks saving', async () => {
      const h = await open();
      await pickEquivalent(h, listItem('p2', '6205-DDU'), verdict({ exists: true, equivalenceId: 'e9' }));
      expect(text(h)).toContain('Ya existe el vínculo 6205-2RS → 6205-DDU. Edítalo desde la lista.');
      const note = root(h).querySelector('rs-note[data-type=danger]')!;
      expect(note.textContent).toContain('No se pudo guardar');
      expect(note.textContent).toContain('Este equivalente ya está vinculado al rodamiento de origen.');
      expect(root(h).querySelector('rs-note[data-type=info]')).toBeNull();
      expect(button(h, 'Guardar equivalencia')!.disabled).toBe(true);
    });

    it('checks the pair again when saving is refused because someone linked it meanwhile', async () => {
      const h = await open();
      await pickEquivalent(h, listItem('p2', '6205-DDU'));
      await click(h, 'Guardar equivalencia');
      http.expectOne(LINK_URL).flush({ code: 'EQUIVALENCE_EXISTS', message: 'x' }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      http.expectOne(VALIDATE_URL).flush(verdict({ exists: true, equivalenceId: 'e9' }));
      await settle(h);
      expect(text(h)).toContain('Ya existe el vínculo 6205-2RS → 6205-DDU.');
      expect(button(h, 'Guardar equivalencia')!.disabled).toBe(true);
    });
  });

  describe('IN-15e · incompatible measures', () => {
    const incompatible = verdict({
      kind: 'INCOMPATIBLE',
      typeDiffers: true,
      measureDifferences: [
        { key: 'D', a: '52.000', b: '62.000' },
        { key: 'B', a: '15.000', b: '17.000' },
      ],
    });
    // the search only offers products of the same type and measures; the API can still answer that they differ (a stale list)
    const bigger = listItem('p3', '6305-2RS', 'NSK');

    it('shows the measures error under the equivalent, the red note, and blocks saving with no override', async () => {
      const h = await open();
      await pickEquivalent(h, bigger, incompatible);
      expect(text(h)).toContain('Medidas: 25×52×15 mm (origen) frente a');
      const note = root(h).querySelector('rs-note[data-type=danger]')!;
      expect(note.textContent).toContain('No se pudo guardar');
      expect(note.textContent).toContain('Las medidas no coinciden. Revisa el rodamiento equivalente antes de continuar.');
      expect(button(h, 'Guardar equivalencia')!.disabled).toBe(true);
      expect(button(h, 'Vincular de todos modos')).toBeUndefined();
      http.expectNone(LINK_URL);
    });

    it('says it is another type when the measures are the same', async () => {
      const h = await open();
      await pickEquivalent(h, listItem('p4', 'NU205', 'FAG'), verdict({ kind: 'INCOMPATIBLE', typeDiffers: true, measureDifferences: [] }));
      expect(text(h)).toContain('No son del mismo tipo de rodamiento.');
      expect(button(h, 'Guardar equivalencia')!.disabled).toBe(true);
    });

    it('lets the user pick another product, which clears the error', async () => {
      const h = await open();
      await pickEquivalent(h, bigger, incompatible);
      await click(h, 'Cambiar');
      expect(text(h)).not.toContain('Las medidas no coinciden');
      expect(root(h).querySelector('rs-note[data-type=info]')).not.toBeNull();
    });

    it('checks the pair again when the API says the verdict changed', async () => {
      const h = await open();
      await pickEquivalent(h, listItem('p2', '6205-DDU'));
      await click(h, 'Guardar equivalencia');
      http.expectOne(LINK_URL).flush({ code: 'EQUIVALENCE_INCOMPATIBLE', message: 'x' }, { status: 422, statusText: 'Unprocessable' });
      await settle(h);
      http.expectOne(VALIDATE_URL).flush(incompatible);
      await settle(h);
      expect(text(h)).toContain('Las medidas no coinciden.');
    });
  });

  describe('the origin and what it is linked to are not offered as the equivalent', () => {
    it('leaves out the origin itself and the products it is already linked to, and offers the rest', async () => {
      const h = await open();
      await search(h, 'equivalente', '6205', [
        listItem('p1', '6205-2RS', 'SKF'),
        listItem('p-linked', '6205-2Z', 'FAG'),
        listItem('p2', '6205-DDU'),
        listItem('p7', '6305-2RS', 'NTN'),
      ]);
      const codes = Array.from(root(h).querySelectorAll('.result .code')).map((c) => c.textContent?.trim());
      expect(codes).toEqual(['6205-DDU · NSK', '6305-2RS · NTN']);
    });

    it('says nothing was found when only the origin and linked products match', async () => {
      const h = await open();
      await search(h, 'equivalente', '6205', [listItem('p1', '6205-2RS', 'SKF'), listItem('p-linked', '6205-2Z', 'FAG')]);
      expect(root(h).querySelector('.result')).toBeNull();
      expect(text(h)).toContain('No encontramos productos con esa búsqueda.');
    });

    it('does not leave anything out of the equivalent search while the origin is not chosen', async () => {
      const h = await open('/equivalences/new');
      await search(h, 'equivalente', '6205', [listItem('p1', '6205-2RS', 'SKF'), listItem('p2', '6205-DDU')]);
      expect(root(h).querySelectorAll('.result')).toHaveLength(2);
    });
  });
});
