import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EquivalenceListItem, EquivalenceListProduct, EquivalenceListResponse, ProductFilterOptions } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { ContextStore } from '../../../core/context.store';
import { EquivalencesPage } from './equivalences.page';

const LIST_URL = '/api/v1/inventory/equivalences';
const OPTIONS_URL = '/api/v1/inventory/filter-options';

const options: ProductFilterOptions = {
  countries: [],
  brands: [{ id: 'b-nsk', name: 'NSK', logoUrl: null, countryId: null }],
  categories: [{ id: 'k-1', name: 'Rodamientos', icon: 'bearing', subcategories: [] }],
};

const product = (over: Partial<EquivalenceListProduct> = {}): EquivalenceListProduct => ({
  id: 'p1',
  manufacturerCode: '6205-2RS',
  brand: { id: 'b-skf', name: 'SKF', logoUrl: null },
  country: { id: 'c-se', code: 'SE', name: 'Suecia' },
  photoUrl: null,
  categoryIcon: 'bearing',
  dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15' },
  totalStock: 24,
  status: 'ACTIVE',
  ...over,
});

const item = (over: Partial<EquivalenceListItem> = {}): EquivalenceListItem => ({
  id: 'e1',
  productA: product(),
  productB: product({ id: 'p2', manufacturerCode: '6205-DDU', brand: { id: 'b-nsk', name: 'NSK', logoUrl: null }, totalStock: 0 }),
  kind: 'WITH_DIFFERENCES',
  differences: [{ key: 'seal', label: 'Sello', source: '2RS', other: 'DDU' }],
  createdBy: null,
  createdAt: '2026-10-24T10:00:00.000Z',
  approvalState: 'APPROVED',
  substitute: false,
  notes: null,
  ...over,
});

const response = (items: EquivalenceListItem[], over: Partial<EquivalenceListResponse> = {}): EquivalenceListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  linksEmpty: false,
  ...over,
});

@Component({ template: '' })
class SheetStubPage {}

const VIEW = 'inventory.products.view';
const LINK = 'inventory.equivalences.link';

describe('EquivalencesPage', () => {
  let http: HttpTestingController;

  async function open(url = '/equivalences', granted = [VIEW, LINK]) {
    const permissions = new Set(granted);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'equivalences', component: EquivalencesPage },
          { path: 'inventory/products/:id', component: SheetStubPage },
          { path: 'inventory/equivalences/new', component: SheetStubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(permissions) },
        { provide: ContextStore, useValue: { can: (p: string) => permissions.has(p) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, EquivalencesPage);
    return harness;
  }

  const flushList = (body: EquivalenceListResponse) => http.expectOne((r) => r.url === LIST_URL).flush(body);
  const flushOptions = () => http.expectOne(OPTIONS_URL).flush(options);
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
    expect(root(h).querySelector('[aria-busy=true]')).not.toBeNull();
    flushList(response([item()]));
    flushOptions();
    await settle(h);
    expect(root(h).querySelector('[aria-busy=true]')).toBeNull();
  });

  it('renders each link with both products, the measures, the kind and both stocks', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 'e2', kind: 'EXACT', differences: [] })], { total: 12 }));
    flushOptions();
    await settle(h);

    const rows = root(h).querySelectorAll('rs-doc-table tbody tr');
    expect(rows).toHaveLength(2);
    const first = rows[0].textContent ?? '';
    expect(first).toContain('6205-2RS');
    expect(first).toContain('6205-DDU');
    expect(first).toContain('SKF');
    expect(first).toContain('NSK');
    expect(first).toContain('25×52×15 mm');
    expect(first).toContain('Con diferencias');
    // the empty side carries the "Agotado" flag, the other does not
    expect(rows[0].querySelectorAll('rs-stock-flag')).toHaveLength(1);
    expect(rows[0].querySelector('rs-stock-flag')?.getAttribute('aria-label')).toBe('Agotado');
    expect(rows[1].textContent).toContain('Exacta');
    expect(rows[0].querySelectorAll('rs-product-thumb')).toHaveLength(2);
    expect(text(h)).toContain('1–2 de 12 vínculos');
  });

  it('asks the API with the filters of the URL, ten per page', async () => {
    const h = await open('/equivalences?brandId=b-nsk&categoryId=k-1&kind=EXACT&q=6205&page=2');
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.get('brandId')).toBe('b-nsk');
    expect(req.request.params.get('categoryId')).toBe('k-1');
    expect(req.request.params.get('kind')).toBe('EXACT');
    expect(req.request.params.get('q')).toBe('6205');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush(response([item()], { total: 11, page: 2 }));
    flushOptions();
    await settle(h);
  });

  it('puts a filter in the URL, back on page 1, and asks again', async () => {
    const h = await open('/equivalences?page=3');
    flushList(response([item()], { total: 30, page: 3 }));
    flushOptions();
    await settle(h);

    const brand = h.fixture.debugElement.queryAll((d) => d.name === 'rs-select')[1];
    brand.triggerEventHandler('valueChange', 'b-nsk');
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/equivalences?brandId=b-nsk');
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.get('brandId')).toBe('b-nsk');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(response([item()]));
    await settle(h);
  });

  it('opens the sheet of the product that is clicked', async () => {
    const h = await open();
    flushList(response([item()]));
    flushOptions();
    await settle(h);

    const buttons = root(h).querySelectorAll<HTMLButtonElement>('.product');
    buttons[1].click();
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/inventory/products/p2');
  });

  describe('IN-15b · empty', () => {
    it('shows the illustration and the link action when the company has no links', async () => {
      const h = await open();
      flushList(response([], { linksEmpty: true }));
      flushOptions();
      await settle(h);

      expect(text(h)).toContain('Aún no hay equivalencias');
      expect(root(h).querySelector('rs-empty-state-illustrated rs-illustration[data-name=no-equivalents]')).not.toBeNull();
      expect(root(h).querySelector('rs-empty-state-illustrated button')?.textContent).toContain('Vincular equivalencias');
      expect(text(h)).not.toContain('Limpiar filtros');
    });

    it('offers "Limpiar filtros" when the filters leave nothing', async () => {
      const h = await open('/equivalences?kind=EXACT');
      flushList(response([], { linksEmpty: false }));
      flushOptions();
      await settle(h);

      expect(text(h)).toContain('No encontramos equivalencias');
      const clear = Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Limpiar filtros'));
      expect(clear).toBeDefined();
      clear!.click();
      await settle(h);
      expect(TestBed.inject(Router).url).toBe('/equivalences');
      http.expectOne((r) => r.url === LIST_URL).flush(response([item()]));
      await settle(h);
    });
  });

  describe('IN-15f · read-only', () => {
    it('shows the list and the note with its illustration, and no link action', async () => {
      const h = await open('/equivalences', [VIEW]);
      flushList(response([item()]));
      flushOptions();
      await settle(h);

      expect(text(h)).toContain('Modo solo lectura');
      expect(root(h).querySelector('.readonly rs-illustration')).not.toBeNull();
      expect(root(h).querySelector('.readonly rs-note')).not.toBeNull();
      expect(root(h).querySelectorAll('rs-doc-table tbody tr')).toHaveLength(1);
      expect(text(h)).not.toContain('Vincular equivalencias');
    });

    it('hides the link action in the empty state too', async () => {
      const h = await open('/equivalences', [VIEW]);
      flushList(response([], { linksEmpty: true }));
      flushOptions();
      await settle(h);

      expect(text(h)).toContain('Aún no hay equivalencias');
      expect(text(h)).not.toContain('Vincular equivalencias');
    });

    it('does not show the note to someone who can link', async () => {
      const h = await open();
      flushList(response([item()]));
      flushOptions();
      await settle(h);
      expect(text(h)).not.toContain('Modo solo lectura');
      expect(root(h).querySelector('.header-actions')?.textContent).toContain('Vincular equivalencias');
    });
  });

  it('shows the no-permission state, without calling the API, when the user cannot view products', async () => {
    const h = await open('/equivalences', []);
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver equivalencias');
    http.expectNone(LIST_URL);
    http.expectNone(OPTIONS_URL);
  });

  it('shows the error with a retry that asks again', async () => {
    const h = await open();
    http.expectOne((r) => r.url === LIST_URL).flush({ code: 'SERVER_ERROR', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    flushOptions();
    await settle(h);

    expect(text(h)).toContain('No pudimos cargar las equivalencias');
    const retry = Array.from(root(h).querySelectorAll('button')).find((b) => b.textContent?.includes('Reintentar'));
    retry!.click();
    flushList(response([item()]));
    await settle(h);
    expect(root(h).querySelectorAll('rs-doc-table tbody tr')).toHaveLength(1);
  });

  it('shows the no-permission state when the API answers 403', async () => {
    const h = await open();
    http.expectOne((r) => r.url === LIST_URL).flush({ code: 'NO_PERMISSION', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    flushOptions();
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver equivalencias');
  });

  describe('linking (HU-INV-13)', () => {
    const APPROVE = 'inventory.equivalences.approve';
    const buttonIn = (scope: ParentNode, label: string) =>
      Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.trim().includes(label) || b.getAttribute('aria-label')?.includes(label));
    const loaded = async (items: EquivalenceListItem[], granted = [VIEW, LINK]) => {
      const h = await open('/equivalences', granted);
      flushList(response(items));
      flushOptions();
      await settle(h);
      return h;
    };
    const pending = () => item({ approvalState: 'PENDING_APPROVAL' });

    it('opens the link form from the header, with no product of its own', async () => {
      const h = await loaded([item()]);
      buttonIn(root(h), 'Vincular equivalencias')!.click();
      await settle(h);
      expect(TestBed.inject(Router).url).toBe('/inventory/equivalences/new');
    });

    it('opens the link form from the empty state too', async () => {
      const h = await open();
      flushList(response([], { linksEmpty: true }));
      flushOptions();
      await settle(h);
      buttonIn(root(h).querySelector('rs-empty-state-illustrated')!, 'Vincular equivalencias')!.click();
      await settle(h);
      expect(TestBed.inject(Router).url).toBe('/inventory/equivalences/new');
    });

    it('marks a link that waits for approval and lets who can approve do it', async () => {
      const h = await loaded([pending(), item({ id: 'e2' })], [VIEW, LINK, APPROVE]);
      const rows = root(h).querySelectorAll('rs-doc-table tbody tr');
      const pills = Array.from(rows[0].querySelectorAll('rs-status-pill')).map((p) => p.textContent?.trim());
      expect(pills).toContain('Pendiente');
      expect(rows[1].textContent).not.toContain('Pendiente');
      expect(buttonIn(rows[1], 'Aprobar')).toBeUndefined();

      buttonIn(rows[0], 'Aprobar')!.click();
      const approve = http.expectOne('/api/v1/inventory/equivalences/e1/approve');
      expect(approve.request.method).toBe('POST');
      approve.flush(null, { status: 204, statusText: 'No Content' });
      await settle(h);
      // the list is asked again
      flushList(response([item()]));
      await settle(h);
      expect(text(h)).not.toContain('Pendiente');
    });

    it('shows the pending mark but no approve action to who cannot approve', async () => {
      const h = await loaded([pending()]);
      const row = root(h).querySelector('rs-doc-table tbody tr')!;
      expect(row.textContent).toContain('Pendiente');
      expect(buttonIn(row, 'Aprobar')).toBeUndefined();
    });

    it('reports a failed approval and refreshes the list', async () => {
      const h = await loaded([pending()], [VIEW, LINK, APPROVE]);
      buttonIn(root(h), 'Aprobar')!.click();
      http
        .expectOne('/api/v1/inventory/equivalences/e1/approve')
        .flush({ code: 'EQUIVALENCE_ALREADY_APPROVED', message: 'x' }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      flushList(response([item()]));
      await settle(h);
      expect(root(h).querySelectorAll('rs-doc-table tbody tr')).toHaveLength(1);
    });

    it('asks before unlinking, names the pair, and refreshes the list afterwards', async () => {
      const h = await loaded([item()]);
      // the row action is an icon button: no text, its name names the pair, and a tooltip says what it does
      const unlink = buttonIn(root(h).querySelector('rs-doc-table tbody tr')!, 'Desvincular')!;
      expect(unlink.textContent?.trim()).toBe('');
      expect(unlink.getAttribute('aria-label')).toBe('Desvincular 6205-2RS y 6205-DDU');
      expect(unlink.querySelector('rs-icon')?.getAttribute('name')).toBe('trash');
      expect(unlink.getAttribute('rstooltip')).toBe('Desvincular equivalencia');
      unlink.click();
      await settle(h);
      const dialog = root(h).querySelector('rs-equivalence-unlink-dialog')!;
      expect(dialog.textContent).toContain('¿Desvincular equivalencia?');
      expect(dialog.textContent).toContain('6205-2RS · SKF y 6205-DDU · NSK');
      http.expectNone('/api/v1/inventory/equivalences/e1');

      buttonIn(dialog, 'Desvincular')!.click();
      const del = http.expectOne('/api/v1/inventory/equivalences/e1');
      expect(del.request.method).toBe('DELETE');
      del.flush(null, { status: 204, statusText: 'No Content' });
      await settle(h);
      flushList(response([], { linksEmpty: true }));
      await settle(h);
      expect(text(h)).toContain('Aún no hay equivalencias');
    });

    it('hides the link, approve and unlink actions from who can only view', async () => {
      const h = await loaded([pending()], [VIEW]);
      expect(buttonIn(root(h), 'Vincular equivalencias')).toBeUndefined();
      expect(buttonIn(root(h), 'Desvincular')).toBeUndefined();
      expect(buttonIn(root(h), 'Aprobar')).toBeUndefined();
    });
  });
});
