import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  CashRegisterOption,
  CurrentCashShift,
  PosCheckoutLine,
  PosCheckoutView,
  PosEquivalentItem,
  PosEquivalentsResponse,
  PosProductResult,
  PosProductSheet,
} from '@rodasoft/domain';
import { ContextStore } from '../../../core/context.store';
import { POS_SEARCH_DEBOUNCE_MS, PosPage } from './pos.page';

const CURRENT = '/api/v1/sales/cash-shifts/current';
const REGISTERS = '/api/v1/sales/cash-registers';
const CATEGORIES = '/api/v1/sales/pos/categories';
const SEARCH = '/api/v1/sales/pos/product-search';
const CHECKOUT = '/api/v1/sales/pos/checkout';
const ITEMS = '/api/v1/sales/pos/checkout/items';

const shift: CurrentCashShift = {
  id: 's1',
  openingFloat: '500.00',
  openedAt: '2026-11-04T12:00:00.000Z',
  openedBy: { id: 'u1', name: 'Ana Cajera' },
  register: { id: 'r1', name: 'Caja 1' },
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Central' },
};

const register = (over: Partial<CashRegisterOption> = {}): CashRegisterOption => ({
  id: 'r1',
  name: 'Caja 1',
  branch: { id: 'b1', name: 'Huayna Kapac' },
  warehouse: { id: 'w1', name: 'Central' },
  openShift: null,
  lastClose: null,
  ...over,
});

const product = (over: Partial<PosProductResult> = {}): PosProductResult => ({
  id: 'p1',
  sku: 'RL-000001',
  code: '6205-2RS',
  name: 'Rodamiento rígido de bolas',
  brand: { name: 'SKF', initials: 'SK' },
  salePrice: '245.00',
  available: 24,
  stockStatus: 'ok',
  maxQuantity: 24,
  warehouse: { id: 'w1', name: 'Central' },
  ...over,
});

const equivalentsUrl = (id: string) => `/api/v1/sales/pos/products/${id}/equivalents`;

const equivalent = (over: Partial<PosEquivalentItem> = {}): PosEquivalentItem => ({
  productId: 'e1',
  code: '6208-2RSR',
  name: 'Rodamiento 6208-2RSR',
  brand: { name: 'FAG', initials: 'FA' },
  salePrice: '245.00',
  available: 8,
  kind: 'WITH_DIFFERENCES',
  differences: [{ key: 'seal', label: 'Sello', source: '2RS', other: '2Z' }],
  substitute: false,
  notes: 'blindaje metálico en vez de sello',
  measures: { innerDiameter: '40', outerDiameter: '80', width: '18' },
  ...over,
});

const equivalents = (over: Partial<PosEquivalentsResponse> = {}): PosEquivalentsResponse => ({
  original: { id: 'p3', code: '6208-2RS', available: 0 },
  warehouse: { id: 'w1', name: 'Central' },
  items: [equivalent()],
  otherBranches: [],
  ...over,
});

const sheetUrl = (id: string) => `/api/v1/sales/pos/products/${id}/sheet`;

const sheetOf = (over: Partial<PosProductSheet> = {}): PosProductSheet => ({
  product: {
    id: 'p1',
    sku: 'RL-000124',
    manufacturerCode: '6205-2RS',
    name: 'Rodamiento rígido de bolas',
    unit: 'UN',
    status: 'ACTIVE',
    brand: { id: 'b', name: 'SKF', logoUrl: null },
    country: null,
    category: { id: 'c', name: 'Rodamientos', icon: 'bearing' },
    subcategory: null,
    dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15', weight: null },
    specs: [],
    salePrice: '245.00',
    sectors: [],
    totalStock: 24,
    stockByBranch: [],
    photos: [],
    datasheetUrl: null,
  },
  available: 24,
  stockStatus: 'ok',
  maxQuantity: 24,
  warehouse: { id: 'w1', name: 'Central' },
  branchId: 'b1',
  equivalents: [],
  ...over,
});

const line = (over: Partial<PosCheckoutLine> = {}): PosCheckoutLine => ({
  id: 'l1',
  productId: 'p1',
  code: '6205-2RS',
  name: 'Rodamiento rígido de bolas',
  brandName: 'SKF',
  quantity: 2,
  unitPrice: '245.00',
  lineTotal: '490.00',
  maxQuantity: 24,
  sortOrder: 0,
  ...over,
});

const cheapLine = (over: Partial<PosCheckoutLine> = {}) =>
  line({ id: 'l2', productId: 'p2', code: '6206-2RS', unitPrice: '0.10', quantity: 3, lineTotal: '0.30', sortOrder: 1, ...over });

const cart = (lines: PosCheckoutLine[], subtotal: string, total = subtotal): PosCheckoutView => ({
  id: 'c1',
  status: 'OPEN',
  lines,
  pricing: { roundingMode: 'NONE', discount: null },
  subtotal,
  discount: '0.00',
  total,
});

@Component({ template: '' })
class Stub {}

describe('PosPage', () => {
  let http: HttpTestingController;

  /**
   * `registers` is what the registers endpoint answers when the page asks for it (closed register, may open it); `checkout`
   * is the cart the page reads when the shift is open.
   */
  async function open(
    granted = ['sales.pos.use', 'sales.cash-register.open'],
    current: CurrentCashShift | null | 'error' = null,
    registers: CashRegisterOption[] | 'error' = [register()],
    checkout: PosCheckoutView | null = null,
  ) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'sales/pos', component: PosPage },
          { path: 'sales/cash-register/open', component: Stub },
          { path: '', component: Stub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ContextStore,
          useValue: {
            can: (p: string) => granted.includes(p),
            context: signal({ user: { name: 'Ana Cajera' } }),
            currentBranch: () => ({ id: 'b1', name: 'Huayna Kapac' }),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/pos');
    if (granted.includes('sales.pos.use')) {
      const req = http.expectOne(CURRENT);
      if (current === 'error') req.flush({}, { status: 500, statusText: 'Server Error' });
      else req.flush({ shift: current });
      if (current && current !== 'error') {
        await settle(h);
        http.expectOne(CATEGORIES).flush({ items: [{ id: 'cat1', name: 'Rodamientos', icon: 'bearing' }] });
        http.expectOne(CHECKOUT).flush({ checkout });
      }
      if (current === null && granted.includes('sales.cash-register.open')) {
        await settle(h);
        const list = http.expectOne(REGISTERS);
        if (registers === 'error') list.flush({}, { status: 500, statusText: 'Server Error' });
        else list.flush({ items: registers });
      }
    }
    await settle(h);
    return h;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  const button = (h: RouterTestingHarness, label: string, within: ParentNode = root(h)) =>
    Array.from(within.querySelectorAll('button')).find((b) => b.textContent?.includes(label) || b.getAttribute('aria-label') === label);
  const dialog = (h: RouterTestingHarness) => root(h).querySelector<HTMLElement>('[role=dialog]');
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  describe('closed register (VP-14, HU-VEN-01)', () => {
    it('shows the "Caja cerrada" card over a dimmed backdrop and blocks the page behind it when there is no open shift', async () => {
      const h = await open();
      expect(dialog(h)).not.toBeNull();
      expect(dialog(h)!.getAttribute('aria-modal')).toBe('true');
      expect(dialog(h)!.querySelector('rs-illustration')).not.toBeNull();
      expect(dialog(h)!.querySelector('h2')!.textContent).toContain('Caja cerrada');
      expect(button(h, 'Salir del POS', dialog(h)!)).toBeDefined();
      expect(button(h, 'Abrir caja', dialog(h)!)).toBeDefined();
      expect(root(h).querySelector('.pos')!.hasAttribute('inert')).toBe(true);
      // Figma VP-14 has no close button
      expect(dialog(h)!.querySelector('[aria-label="Cerrar"]')).toBeNull();
    });

    it('names the register when the branch has only one, and says so generically otherwise', async () => {
      const one = await open();
      expect(text(one)).toContain('No tienes un turno abierto en la Caja 1. Abre tu turno para empezar a vender.');

      TestBed.resetTestingModule();
      const many = await open(undefined, null, [register(), register({ id: 'r2', name: 'Caja 2' })]);
      expect(text(many)).toContain('No tienes un turno abierto. Abre tu turno para empezar a vender.');

      TestBed.resetTestingModule();
      const failed = await open(undefined, null, 'error');
      expect(text(failed)).toContain('No tienes un turno abierto. Abre tu turno para empezar a vender.');
    });

    it('shows the POS header with the register, branch and user, and "Salir del POS" at its right', async () => {
      const h = await open();
      const header = root(h).querySelector<HTMLElement>('header.header')!;
      expect(header.querySelector('h1')!.textContent).toContain('Punto de venta');
      expect(header.textContent).toContain('Caja 1 · Huayna Kapac · Ana Cajera');
      expect(button(h, 'Salir del POS', header)).toBeDefined();
    });

    it('puts the focus on "Abrir caja" and keeps it inside the card with Tab', async () => {
      const h = await open();
      const salir = button(h, 'Salir del POS', dialog(h)!)!;
      const abrir = button(h, 'Abrir caja', dialog(h)!)!;
      expect(document.activeElement).toBe(abrir);

      abrir.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(salir);
      salir.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(abrir);
    });

    it('keeps the card after Escape: it is only left through its two buttons', async () => {
      const h = await open();
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      dialog(h)!.dispatchEvent(event);
      await settle(h);
      expect(event.defaultPrevented).toBe(true);
      expect(dialog(h)).not.toBeNull();
    });

    it('"Abrir caja" goes to the opening form and "Salir del POS" goes home', async () => {
      const h = await open();
      button(h, 'Abrir caja', dialog(h)!)!.click();
      await settle(h);
      expect(TestBed.inject(Router).url).toBe('/sales/cash-register/open');

      await h.navigateByUrl('/sales/pos');
      http.expectOne(CURRENT).flush({ shift: null });
      await settle(h);
      http.expectOne(REGISTERS).flush({ items: [register()] });
      await settle(h);
      button(h, 'Salir del POS', dialog(h)!)!.click();
      await settle(h);
      expect(TestBed.inject(Router).url).toBe('/');
    });

    it('does not offer "Abrir caja" to a user who may not open the register, and does not ask for the registers', async () => {
      const h = await open(['sales.pos.use']);
      expect(button(h, 'Salir del POS', dialog(h)!)).toBeDefined();
      expect(button(h, 'Abrir caja')).toBeUndefined();
      expect(text(h)).toContain('Pide a un responsable de caja que abra tu turno.');
    });

    it('shows no card and names the register, branch and user when the shift is open', async () => {
      const h = await open(undefined, shift);
      expect(dialog(h)).toBeNull();
      expect(text(h)).toContain('Caja 1 · Huayna Kapac · Ana Cajera');
      expect(root(h).querySelector('.pos')!.hasAttribute('inert')).toBe(false);
    });

    it('shows the "Caja cerrada" card when the shift was closed elsewhere', async () => {
      const h = await open(undefined, shift, undefined, cart([line()], '490.00'));
      button(h, 'Sumar uno')!.click();
      await settle(h);
      http.expectOne(`${ITEMS}/l1`).flush({ code: 'CASH_SHIFT_NOT_OPEN', message: 'No open shift' }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      http.expectOne(REGISTERS).flush({ items: [register()] });
      await settle(h);
      expect(dialog(h)).not.toBeNull();
    });
  });

  it('shows the error state and retries', async () => {
    const h = await open(undefined, 'error');
    expect(text(h)).toContain('No pudimos cargar el punto de venta');
    button(h, 'Reintentar')!.click();
    http.expectOne(CURRENT).flush({ shift });
    await settle(h);
    http.expectOne(CATEGORIES).flush({ items: [] });
    http.expectOne(CHECKOUT).flush({ checkout: null });
    await settle(h);
    expect(text(h)).toContain('Venta actual');
  });

  it('shows the no-permission state without calling the API', async () => {
    const h = await open(['sales.quotes.manage']);
    expect(text(h)).toContain('No tienes permiso para usar el punto de venta');
  });

  describe('sale (VP-03)', () => {
    const searchBox = (h: RouterTestingHarness) => root(h).querySelector<HTMLInputElement>('input[aria-label="Buscar producto"]')!;
    const total = (h: RouterTestingHarness) => root(h).querySelector('[data-testid=pos-total]')!.textContent!.trim();
    const press = (el: HTMLElement, key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const wait = () => new Promise((resolve) => setTimeout(resolve, POS_SEARCH_DEBOUNCE_MS + 50));

    function type(h: RouterTestingHarness, q: string) {
      const input = searchBox(h);
      input.value = q;
      input.dispatchEvent(new Event('input'));
    }

    /** Types in the search box and answers the search once the debounce has passed. */
    async function search(h: RouterTestingHarness, q: string, items: PosProductResult[]) {
      type(h, q);
      await settle(h);
      await wait();
      const req = http.expectOne((r) => r.url === SEARCH);
      expect(req.request.params.get('q')).toBe(q);
      req.flush({ items });
      await settle(h);
    }

    it('shows the empty cart, the category chips, the shortcuts and the payment button disabled', async () => {
      const h = await open(undefined, shift);
      expect(text(h)).toContain('Agrega productos para empezar la venta');
      expect(total(h)).toBe('Bs 0,00');
      expect(button(h, 'Cobrar')!.disabled).toBe(true);
      expect(text(h)).toContain('F2 Buscar · Enter Agregar · Espacio Ficha · Esc Limpiar');
      expect(Array.from(root(h).querySelectorAll('rs-filter-chip')).map((c) => c.textContent?.trim())).toEqual(['Todos', 'Rodamientos']);
    });

    it('shows each result with the stock of the register warehouse, the low flag and "Agotado aquí"', async () => {
      const h = await open(undefined, shift);
      await search(h, '62', [
        product(),
        product({ id: 'p2', code: '6306-2RS', available: 3, stockStatus: 'low' }),
        product({ id: 'p3', code: '6208-2RS', available: 0, stockStatus: 'out', maxQuantity: 0 }),
      ]);
      const rows = Array.from(root(h).querySelectorAll<HTMLElement>('rs-pos-result-row'));
      expect(rows[0].textContent).toContain('24 en Central');
      expect(rows[0].textContent).toContain('Bs 245,00');
      expect(rows[1].querySelector('rs-stock-flag')?.getAttribute('data-level')).toBe('low');
      expect(rows[2].textContent).toContain('Agotado aquí');
      // an out-of-stock product cannot be added: its action is Equivalentes (HU-VEN-03)
      expect(button(h, 'Agregar 6208-2RS', rows[2])).toBeUndefined();
      expect(button(h, 'Equivalentes', rows[2])).toBeDefined();
    });

    it('filters by category', async () => {
      const h = await open(undefined, shift);
      root(h).querySelectorAll<HTMLButtonElement>('rs-filter-chip button')[1].click();
      await settle(h);
      await wait();
      const req = http.expectOne((r) => r.url === SEARCH);
      expect(req.request.params.get('categoryId')).toBe('cat1');
      req.flush({ items: [product()] });
      await settle(h);
      expect(root(h).querySelectorAll('rs-pos-result-row')).toHaveLength(1);
    });

    it('Enter adds the first result', async () => {
      const h = await open(undefined, shift);
      await search(h, '6205', [product(), product({ id: 'p2', code: '6205-2Z' })]);
      press(searchBox(h), 'Enter');
      const req = http.expectOne(ITEMS);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ productId: 'p1', quantity: 1 });
      req.flush({ checkout: cart([line({ quantity: 1, lineTotal: '245.00' })], '245.00') });
      await settle(h);
      expect(root(h).querySelector('rs-pos-cart-line')!.textContent).toContain('6205-2RS · SKF');
      expect(total(h)).toBe('Bs 245,00');
      expect(button(h, 'Cobrar')!.textContent).toContain('Cobrar Bs 245,00 (F9)');
    });

    it('Enter before the results arrive adds the first one when they do', async () => {
      const h = await open(undefined, shift);
      type(h, '6205');
      await settle(h);
      press(searchBox(h), 'Enter');
      http.expectNone(ITEMS);
      await wait();
      http.expectOne((r) => r.url === SEARCH).flush({ items: [product()] });
      await settle(h);
      expect(http.expectOne(ITEMS).request.body).toEqual({ productId: 'p1', quantity: 1 });
    });

    it('Enter does not add an out-of-stock first result (it opens its equivalents), and Esc clears the search', async () => {
      const h = await open(undefined, shift);
      await search(h, '6208', [product({ stockStatus: 'out', available: 0, maxQuantity: 0 })]);
      press(searchBox(h), 'Enter');
      http.expectNone(ITEMS);
      await settle(h);
      http.expectOne(equivalentsUrl('p1')).flush(equivalents());
      press(searchBox(h), 'Escape');
      await settle(h);
      expect(searchBox(h).value).toBe('');
      expect(text(h)).toContain('Busca un producto');
    });

    describe('equivalents of an out-of-stock product (VP-03b, HU-VEN-03)', () => {
      const out = (over: Partial<PosProductResult> = {}) =>
        product({ id: 'p3', code: '6208-2RS', available: 0, stockStatus: 'out', maxQuantity: 0, ...over });
      const panels = (h: RouterTestingHarness) => root(h).querySelectorAll('rs-pos-equivalents-panel');
      const rowOf = (h: RouterTestingHarness, code: string) =>
        Array.from(root(h).querySelectorAll<HTMLElement>('rs-pos-result-row')).find((r) => r.textContent?.includes(code))!;

      /** Presses Equivalentes of the row and answers the panel's request. */
      async function openPanel(h: RouterTestingHarness, productId: string, row?: HTMLElement) {
        button(h, 'Equivalentes', row)!.click();
        await settle(h);
        http.expectOne(equivalentsUrl(productId)).flush(equivalents());
        await settle(h);
      }

      it('offers Equivalentes only on out-of-stock rows, instead of Agregar', async () => {
        const h = await open(undefined, shift);
        await search(h, '62', [product(), out()]);
        expect(button(h, 'Equivalentes', rowOf(h, '6205-2RS'))).toBeUndefined();
        expect(button(h, 'Agregar 6205-2RS', rowOf(h, '6205-2RS'))).toBeDefined();
        expect(button(h, 'Agregar 6208-2RS')).toBeUndefined();
        expect(button(h, 'Equivalentes', rowOf(h, '6208-2RS'))).toBeDefined();
      });

      it('opens the panel under the row, shows the equivalents, and closes it on a second click', async () => {
        const h = await open(undefined, shift);
        await search(h, '62', [out(), product({ id: 'p2', code: '6306-2RS' })]);
        await openPanel(h, 'p3');
        expect(panels(h)).toHaveLength(1);
        expect(text(h)).toContain('Sin stock de 6208-2RS en Central · equivalentes disponibles');
        expect(text(h)).toContain('Con diferencias · blindaje metálico en vez de sello · FAG');
        // right under the out-of-stock row, before the next result
        const children = Array.from(root(h).querySelectorAll('.results-card > *'));
        expect(children[1].querySelector('rs-pos-equivalents-panel')).not.toBeNull();

        button(h, 'Equivalentes')!.click();
        await settle(h);
        expect(panels(h)).toHaveLength(0);
      });

      it('Enter opens the panel when the first result is out of stock', async () => {
        const h = await open(undefined, shift);
        await search(h, '6208', [out()]);
        press(searchBox(h), 'Enter');
        await settle(h);
        http.expectOne(equivalentsUrl('p3')).flush(equivalents());
        await settle(h);
        expect(panels(h)).toHaveLength(1);
        http.expectNone(ITEMS);
      });

      it('keeps one panel open at a time', async () => {
        const h = await open(undefined, shift);
        await search(h, '62', [out(), out({ id: 'p4', code: '6210-2RS' })]);
        await openPanel(h, 'p3', rowOf(h, '6208-2RS'));
        await openPanel(h, 'p4', rowOf(h, '6210-2RS'));
        expect(panels(h)).toHaveLength(1);
        expect(text(h)).toContain('Sin stock de 6210-2RS');
        expect(text(h)).not.toContain('Sin stock de 6208-2RS');
      });

      it('closes the panel when the search changes', async () => {
        const h = await open(undefined, shift);
        await search(h, '6208', [out()]);
        await openPanel(h, 'p3');
        expect(panels(h)).toHaveLength(1);

        type(h, '6209');
        await settle(h);
        expect(panels(h)).toHaveLength(0);
        await wait();
        http.expectOne((r) => r.url === SEARCH).flush({ items: [] });
        await settle(h);
      });

      it('adds the chosen equivalent to the cart', async () => {
        const h = await open(undefined, shift);
        await search(h, '6208', [out()]);
        await openPanel(h, 'p3');

        button(h, 'Agregar 6208-2RSR', panels(h)[0] as HTMLElement)!.click();
        const req = http.expectOne(ITEMS);
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual({ productId: 'e1', quantity: 1 });
        req.flush({ checkout: cart([line({ id: 'l9', productId: 'e1', code: '6208-2RSR', brandName: 'FAG', quantity: 1, lineTotal: '245.00' })], '245.00') });
        await settle(h);
        expect(root(h).querySelector('rs-pos-cart-line')!.textContent).toContain('6208-2RSR · FAG');
      });

      it('shows the panel error with a retry', async () => {
        const h = await open(undefined, shift);
        await search(h, '6208', [out()]);
        button(h, 'Equivalentes')!.click();
        await settle(h);
        http.expectOne(equivalentsUrl('p3')).flush({}, { status: 500, statusText: 'Server Error' });
        await settle(h);
        expect(text(h)).toContain('No pudimos cargar los equivalentes');
        button(h, 'Reintentar', panels(h)[0] as HTMLElement)!.click();
        http.expectOne(equivalentsUrl('p3')).flush(equivalents());
        await settle(h);
        expect(text(h)).toContain('6208-2RSR');
      });
    });

    it('says there are no results for the text', async () => {
      const h = await open(undefined, shift);
      await search(h, 'xyz', []);
      expect(text(h)).toContain('Sin resultados para «xyz»');
    });

    it('shows the search error state', async () => {
      const h = await open(undefined, shift);
      type(h, '6205');
      await wait();
      http.expectOne((r) => r.url === SEARCH).flush({}, { status: 500, statusText: 'Server Error' });
      await settle(h);
      expect(text(h)).toContain('No pudimos buscar');
    });

    it('the stepper and the trash recalculate the total before the API answers', async () => {
      const h = await open(undefined, shift, undefined, cart([line(), cheapLine()], '490.30'));
      expect(total(h)).toBe('Bs 490,30');

      button(h, 'Sumar uno')!.click();
      await settle(h);
      // the server has not answered yet
      expect(total(h)).toBe('Bs 735,30');
      const patch = http.expectOne(`${ITEMS}/l1`);
      expect(patch.request.method).toBe('PATCH');
      expect(patch.request.body).toEqual({ quantity: 3 });
      patch.flush({ checkout: cart([line({ quantity: 3, lineTotal: '735.00' }), cheapLine()], '735.30') });
      await settle(h);
      expect(total(h)).toBe('Bs 735,30');

      button(h, 'Quitar 6206-2RS')!.click();
      await settle(h);
      expect(total(h)).toBe('Bs 735,00');
      const del = http.expectOne(`${ITEMS}/l2`);
      expect(del.request.method).toBe('DELETE');
      del.flush({ checkout: cart([line({ quantity: 3, lineTotal: '735.00' })], '735.00') });
      await settle(h);
      expect(root(h).querySelectorAll('rs-pos-cart-line')).toHaveLength(1);
    });

    it('undoes the change with a toast when the API refuses it', async () => {
      const h = await open(undefined, shift, undefined, cart([line()], '490.00'));
      button(h, 'Sumar uno')!.click();
      await settle(h);
      expect(total(h)).toBe('Bs 735,00');
      http
        .expectOne(`${ITEMS}/l1`)
        .flush({ code: 'INSUFFICIENT_STOCK', message: 'Not enough stock', details: { available: 2 } }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      expect(total(h)).toBe('Bs 490,00');
      expect(root(h).querySelector<HTMLInputElement>('rs-pos-cart-line input')!.value).toBe('2');
      expect(text(h)).toContain('Solo hay 2 disponibles en Central.');
    });

    it('limits the stepper to the available stock', async () => {
      const h = await open(undefined, shift, undefined, cart([line({ maxQuantity: 2 })], '490.00'));
      expect(button(h, 'Sumar uno')!.disabled).toBe(true);
    });

    describe('technical sheet (VP-03e, HU-VEN-04)', () => {
      async function openFromEye(h: RouterTestingHarness) {
        await search(h, '6205', [product()]);
        button(h, 'Ver ficha técnica')!.click();
        await settle(h);
        http.expectOne(sheetUrl('p1')).flush(sheetOf());
        await settle(h);
      }

      it('opens the sheet from the eye button of a result', async () => {
        const h = await open(undefined, shift);
        await openFromEye(h);
        expect(dialog(h)!.textContent).toContain('Dimensiones');
        expect(dialog(h)!.textContent).toContain('Stock por sucursal');
      });

      it('opens the sheet of the first result with Space, but not while typing in the search box', async () => {
        const h = await open(undefined, shift);
        await search(h, '6205', [product()]);
        searchBox(h).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
        await settle(h);
        http.expectNone(sheetUrl('p1'));
        press(document.body, ' ');
        await settle(h);
        http.expectOne(sheetUrl('p1')).flush(sheetOf());
        await settle(h);
        expect(dialog(h)).not.toBeNull();
      });

      it('adds the chosen quantity from the sheet, updates the cart and closes the sheet', async () => {
        const h = await open(undefined, shift);
        await openFromEye(h);
        button(h, 'Sumar uno', dialog(h)!)!.click();
        await settle(h);
        button(h, 'Agregar a la venta', dialog(h)!)!.click();
        const req = http.expectOne(ITEMS);
        expect(req.request.body).toEqual({ productId: 'p1', quantity: 2 });
        req.flush({ checkout: cart([line()], '490.00') });
        await settle(h);
        expect(dialog(h)).toBeNull();
        expect(total(h)).toBe('Bs 490,00');
      });
    });

    it('F2 focuses the search', async () => {
      const h = await open(undefined, shift);
      press(document.body, 'F2');
      expect(document.activeElement).toBe(searchBox(h));
    });
  });
});
