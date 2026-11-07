import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type {
  CashRegisterOption,
  CurrentCashShift,
  CustomerSummary,
  PosCheckoutLine,
  CompletedSale,
  PosCheckoutView,
  PosEquivalentItem,
  PosEquivalentsResponse,
  PosProductResult,
  PosProductSheet,
  PosCardPayment,
  PosQrPayment,
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
  customer: null,
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
      expect(text(h)).toContain('F2 Buscar · F4 Cliente · F9 Cobrar · Enter Agregar · Espacio Ficha · Esc Limpiar');
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

  describe('payment and completed sale (VP-04, VP-16a, HU-VEN-07, HU-VEN-11)', () => {
    const PAY = '/api/v1/sales/pos/checkout/pay';
    const BACK = '/api/v1/sales/pos/checkout/back';
    const COMPLETE = '/api/v1/sales/pos/checkout/complete';
    const QR = '/api/v1/sales/pos/checkout/payments/qr';
    const CARD = '/api/v1/sales/pos/checkout/payments/card';
    const total = (h: RouterTestingHarness) => root(h).querySelector('[data-testid=pos-total]')!.textContent!.trim();
    const byId = (h: RouterTestingHarness, id: string) => root(h).querySelector<HTMLElement>(`[data-testid=${id}]`);
    const payDialog = (h: RouterTestingHarness) => root(h).querySelector<HTMLElement>('rs-pos-payment-dialog');
    const keydown = (key: string) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

    const sale: CompletedSale = {
      saleId: 's1',
      number: 'V-000125',
      createdAt: '2026-10-14T14:42:00.000Z',
      total: '1111.00',
      received: '1200.00',
      change: '89.00',
      customerName: 'S/N',
      invoiceStatus: 'PENDING',
      customerEmail: null,
    };

    /** A cart of Bs 1.111,00 with the shift open. */
    const withCart = () => open(undefined, shift, undefined, cart([line({ unitPrice: '555.50', quantity: 2, lineTotal: '1111.00' })], '1111.00'));

    /** Presses "Cobrar" and answers `pay` with the frozen total. */
    async function startPayment(h: RouterTestingHarness) {
      button(h, 'Cobrar')!.click();
      await settle(h);
      http.expectOne(PAY).flush({ total: '1111.00', suggestedAmounts: ['1150.00', '1200.00', '1500.00'], allowMixed: true, cardEnabled: true });
      await settle(h);
    }

    it('enables "Cobrar" with products and opens the payment with the frozen total and the quick amounts', async () => {
      const h = await withCart();
      expect(button(h, 'Cobrar')!.disabled).toBe(false);
      await startPayment(h);
      expect(dialog(h)).not.toBeNull();
      expect(byId(h, 'pay-total')!.textContent).toBe('Bs 1.111,00');
      const quick = Array.from(payDialog(h)!.querySelectorAll('.quick rs-filter-chip')).map((c) => c.textContent?.trim());
      expect(quick).toEqual(['Exacto', 'Bs 1.150', 'Bs 1.200', 'Bs 1.500']);
    });

    it('F9 opens the payment, but not with an empty cart', async () => {
      const h = await open(undefined, shift);
      keydown('F9');
      await settle(h);
      http.expectNone(PAY);
      expect(dialog(h)).toBeNull();
    });

    it('F9 starts the payment of a cart with products', async () => {
      const h = await withCart();
      keydown('F9');
      await settle(h);
      http.expectOne(PAY).flush({ total: '1111.00', suggestedAmounts: [] });
      await settle(h);
      expect(dialog(h)).not.toBeNull();
    });

    it('shows the change and keeps "Confirmar cobro" disabled until the received amount covers the total', async () => {
      const h = await withCart();
      await startPayment(h);
      const confirm = () => byId(h, 'pay-confirm') as HTMLButtonElement;
      expect(confirm().disabled).toBe(true);
      const key = (k: string) => Array.from(payDialog(h)!.querySelectorAll<HTMLButtonElement>('rs-numpad button.key')).find((b) => b.textContent?.trim() === k)!;
      for (const k of ['1', '1', '0', '0']) key(k).click();
      await settle(h);
      expect(confirm().disabled).toBe(true);
      expect(byId(h, 'pay-received')!.textContent).toBe('Bs 1.100,00');
      expect(byId(h, 'pay-shortfall')!.textContent).toBe('Bs 11,00');
      key('0').click();
      await settle(h);
      expect(byId(h, 'pay-received')!.textContent).toBe('Bs 11.000,00');
      expect(byId(h, 'pay-change')!.textContent).toBe('Bs 9.889,00');
      expect(confirm().disabled).toBe(false);
    });

    it('a quick amount fills the received amount: "Bs 1.200" gives Bs 89,00 of change', async () => {
      const h = await withCart();
      await startPayment(h);
      Array.from(payDialog(h)!.querySelectorAll<HTMLButtonElement>('.quick rs-filter-chip button')).find((b) => b.textContent?.includes('Bs 1.200'))!.click();
      await settle(h);
      expect(byId(h, 'pay-received')!.textContent).toBe('Bs 1.200,00');
      expect(byId(h, 'pay-change')!.textContent).toBe('Bs 89,00');
    });

    it('the physical keyboard types, and Enter confirms the payment', async () => {
      const h = await withCart();
      await startPayment(h);
      for (const k of ['1', '2', '0', '0']) keydown(k);
      await settle(h);
      expect(byId(h, 'pay-received')!.textContent).toBe('Bs 1.200,00');
      keydown('Enter');
      await settle(h);
      const req = http.expectOne(COMPLETE);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toMatchObject({ payments: [{ method: 'CASH', received: '1200.00' }], expectedTotal: '1111.00' });
      expect(typeof req.request.body.idempotencyKey).toBe('string');
      req.flush({ sale });
      await settle(h);
    });

    it('does not confirm with less than the total, not even with Enter', async () => {
      const h = await withCart();
      await startPayment(h);
      for (const k of ['5', '0', '0']) keydown(k);
      keydown('Enter');
      await settle(h);
      http.expectNone(COMPLETE);
    });

    it('completes the sale: shows "Venta completada" with the number, the change and an empty cart', async () => {
      const h = await withCart();
      await startPayment(h);
      for (const k of ['1', '2', '0', '0']) keydown(k);
      await settle(h);
      (byId(h, 'pay-confirm') as HTMLButtonElement).click();
      http.expectOne(COMPLETE).flush({ sale });
      await settle(h);
      expect(root(h).querySelector('rs-pos-payment-dialog [role=dialog]')).toBeNull();
      expect(byId(h, 'sale-subtitle')!.textContent).toBe('V-000125 · S/N · 14/10/2026 10:42');
      expect(byId(h, 'sale-total')!.textContent).toBe('Bs 1.111,00');
      expect(byId(h, 'sale-received')!.textContent).toBe('Bs 1.200,00');
      expect(byId(h, 'sale-change')!.textContent).toBe('Bs 89,00');
      expect(text(h)).toContain('Factura pendiente de emisión');
      expect(total(h)).toBe('Bs 0,00');
    });

    it('"Nueva venta" (and Enter) closes the sale and leaves the empty cart', async () => {
      const h = await withCart();
      await startPayment(h);
      for (const k of ['1', '2', '0', '0']) keydown(k);
      await settle(h);
      (byId(h, 'pay-confirm') as HTMLButtonElement).click();
      http.expectOne(COMPLETE).flush({ sale });
      await settle(h);
      keydown('Enter');
      await settle(h);
      expect(byId(h, 'sale-subtitle')).toBeNull();
      expect(text(h)).toContain('Agrega productos para empezar la venta');
    });

    it('"Cancelar" returns the cart to OPEN', async () => {
      const h = await withCart();
      await startPayment(h);
      button(h, 'Cancelar', payDialog(h)!)!.click();
      await settle(h);
      http.expectOne(BACK).flush({ checkout: cart([line({ unitPrice: '555.50', quantity: 2, lineTotal: '1111.00' })], '1111.00') });
      await settle(h);
      expect(root(h).querySelector('rs-pos-payment-dialog [role=dialog]')).toBeNull();
      expect(total(h)).toBe('Bs 1.111,00');
    });

    it('a changed price refuses the payment, says so and shows the cart with the new price', async () => {
      const h = await withCart();
      button(h, 'Cobrar')!.click();
      await settle(h);
      http.expectOne(PAY).flush({ code: 'CHECKOUT_PRICES_CHANGED', message: 'changed', details: { lines: [] } }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      expect(dialog(h)).toBeNull();
      expect(text(h)).toContain('Algunos precios cambiaron. Revisa la venta antes de cobrar.');
      http.expectOne(CHECKOUT).flush({ checkout: cart([line({ unitPrice: '560.00', quantity: 2, lineTotal: '1120.00' })], '1120.00') });
      await settle(h);
      expect(total(h)).toBe('Bs 1.120,00');
    });

    it('a refused sale (stock ran out) closes the payment, says why and goes back to the cart', async () => {
      const h = await withCart();
      await startPayment(h);
      for (const k of ['1', '2', '0', '0']) keydown(k);
      await settle(h);
      (byId(h, 'pay-confirm') as HTMLButtonElement).click();
      http
        .expectOne(COMPLETE)
        .flush({ code: 'INSUFFICIENT_STOCK', message: 'no stock', details: { productId: 'p1', available: 1 } }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      expect(text(h)).toContain('Solo hay 1 disponibles en Central.');
      http.expectOne(BACK).flush({ checkout: cart([line()], '490.00') });
      await settle(h);
      expect(root(h).querySelector('rs-pos-payment-dialog [role=dialog]')).toBeNull();
      expect(byId(h, 'sale-subtitle')).toBeNull();
    });

    it('with no answer from the server the payment stays open and a retry sends the same key', async () => {
      const h = await withCart();
      await startPayment(h);
      for (const k of ['1', '2', '0', '0']) keydown(k);
      await settle(h);
      (byId(h, 'pay-confirm') as HTMLButtonElement).click();
      const first = http.expectOne(COMPLETE);
      const key = first.request.body.idempotencyKey;
      first.error(new ProgressEvent('error'));
      await settle(h);
      expect(text(h)).toContain('No pudimos confirmar el cobro');
      expect(root(h).querySelector('rs-pos-payment-dialog [role=dialog]')).not.toBeNull();
      (byId(h, 'pay-confirm') as HTMLButtonElement).click();
      const retry = http.expectOne(COMPLETE);
      expect(retry.request.body.idempotencyKey).toBe(key);
      retry.flush({ sale });
      await settle(h);
    });

    it('cancelling after a lost answer finds the saved sale instead of hiding it', async () => {
      const h = await withCart();
      await startPayment(h);
      for (const k of ['1', '2', '0', '0']) keydown(k);
      await settle(h);
      (byId(h, 'pay-confirm') as HTMLButtonElement).click();
      const first = http.expectOne(COMPLETE);
      const key = first.request.body.idempotencyKey;
      first.error(new ProgressEvent('error'));
      await settle(h);
      // the sale did commit: the cart is gone, so going back finds nothing and the same key returns the sale
      button(h, 'Cancelar', payDialog(h)!)!.click();
      await settle(h);
      http.expectOne(BACK).flush({ code: 'CHECKOUT_NOT_FOUND', message: 'none' }, { status: 404, statusText: 'Not Found' });
      await settle(h);
      const retry = http.expectOne(COMPLETE);
      expect(retry.request.body.idempotencyKey).toBe(key);
      retry.flush({ sale });
      await settle(h);
      expect(byId(h, 'sale-subtitle')!.textContent).toContain('V-000125');
    });

    it('cancelling after a lost answer goes back to the cart when nothing was saved', async () => {
      const h = await withCart();
      await startPayment(h);
      for (const k of ['1', '2', '0', '0']) keydown(k);
      await settle(h);
      (byId(h, 'pay-confirm') as HTMLButtonElement).click();
      http.expectOne(COMPLETE).error(new ProgressEvent('error'));
      await settle(h);
      button(h, 'Cancelar', payDialog(h)!)!.click();
      await settle(h);
      http.expectOne(BACK).flush({ checkout: cart([line({ unitPrice: '555.50', quantity: 2, lineTotal: '1111.00' })], '1111.00') });
      await settle(h);
      http.expectNone(COMPLETE);
      expect(total(h)).toBe('Bs 1.111,00');
      expect(byId(h, 'sale-subtitle')).toBeNull();
    });

    it('a cart left waiting for payment (a refresh) goes back to OPEN when the page loads', async () => {
      const paying: PosCheckoutView = { ...cart([line()], '490.00'), status: 'PAYING' };
      const h = await open(undefined, shift, undefined, paying);
      http.expectOne(QR).flush({ payment: null });
      http.expectOne(CARD).flush({ payment: null });
      http.expectOne(BACK).flush({ checkout: cart([line()], '490.00') });
      await settle(h);
      expect(total(h)).toBe('Bs 490,00');
      expect(dialog(h)).toBeNull();
    });

    describe('QR payment (VP-04b, HU-VEN-08)', () => {
      const qrPayment = (status: PosQrPayment['status'] = 'PENDING'): PosQrPayment => ({
        paymentId: 'q1',
        idempotencyKey: 'qr-key-0001',
        amount: '1111.00',
        qrPayload: 'RODASOFT-MOCK|ref-1|1111.00',
        status,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
      const PAYMENT = '/api/v1/sales/pos/checkout/payments/q1';
      const chip = (h: RouterTestingHarness, label: string) =>
        Array.from(root(h).querySelectorAll('.methods rs-filter-chip'))
          .find((c) => c.textContent?.trim() === label)!
          .querySelector('button')!;

      /** Payment open, QR chosen and the server's pending QR on screen. */
      async function withQr(h: RouterTestingHarness) {
        await startPayment(h);
        chip(h, 'QR').click();
        await settle(h);
        const start = http.expectOne(QR);
        expect(start.request.method).toBe('POST');
        expect(start.request.body).toMatchObject({ expectedTotal: '1111.00' });
        expect(typeof start.request.body.idempotencyKey).toBe('string');
        start.flush({ payment: qrPayment() });
        await settle(h);
      }

      it('chooses QR, shows the code with the amount and waits for the customer', async () => {
        const h = await withCart();
        await withQr(h);
        expect(root(h).querySelector('rs-pos-qr-panel rs-qr-code')).not.toBeNull();
        expect(byId(h, 'qr-amount')!.textContent).toBe('Bs 1.111,00');
        expect(byId(h, 'qr-waiting')).not.toBeNull();
        // the keypad and the cash confirmation are not part of the QR screen
        expect(byId(h, 'pay-confirm')).toBeNull();
        expect(root(h).querySelector('rs-numpad')).toBeNull();
      });

      it('"Pago recibido" confirms the QR, completes the sale with it and shows the completed sale', async () => {
        const h = await withCart();
        await withQr(h);
        (byId(h, 'qr-received') as HTMLButtonElement).click();
        const confirm = http.expectOne(PAYMENT + '/confirm');
        expect(confirm.request.body).toEqual({ outcome: 'APPROVED' });
        confirm.flush({ payment: qrPayment('CONFIRMED') });
        await settle(h);
        const complete = http.expectOne(COMPLETE);
        expect(complete.request.body).toEqual({
          payments: [{ method: 'QR', paymentId: 'q1' }],
          expectedTotal: '1111.00',
          idempotencyKey: 'qr-key-0001',
        });
        complete.flush({ sale: { ...sale, received: '1111.00', change: '0.00' } });
        await settle(h);
        expect(payDialog(h)?.querySelector('[role=dialog]')).toBeNull();
        expect(text(h)).toContain('V-000125');
      });

      it('"Cambiar método" drops the QR and goes back to the cash keypad', async () => {
        const h = await withCart();
        await withQr(h);
        (byId(h, 'qr-change') as HTMLButtonElement).click();
        http.expectOne(PAYMENT + '/cancel').flush({ payment: qrPayment('CANCELLED') });
        await settle(h);
        expect(root(h).querySelector('rs-pos-qr-panel')).toBeNull();
        expect(root(h).querySelector('rs-numpad')).not.toBeNull();
        expect(byId(h, 'pay-confirm')).not.toBeNull();
      });

      it('"Pago no recibido" shows it and offers a new QR', async () => {
        const h = await withCart();
        await withQr(h);
        (byId(h, 'qr-not-received') as HTMLButtonElement).click();
        const declined = http.expectOne(PAYMENT + '/confirm');
        expect(declined.request.body).toEqual({ outcome: 'DECLINED' });
        declined.flush({ payment: qrPayment('DECLINED') });
        await settle(h);
        expect(text(h)).toContain('El pago no llegó');
        (byId(h, 'qr-new') as HTMLButtonElement).click();
        http.expectOne(QR).flush({ payment: { ...qrPayment(), paymentId: 'q2', idempotencyKey: 'qr-key-0002' } });
        await settle(h);
        expect(byId(h, 'qr-waiting')).not.toBeNull();
      });

      it('cancelling the payment screen goes back to the cart; the server drops the pending QR', async () => {
        const h = await withCart();
        await withQr(h);
        button(h, 'Cancelar', payDialog(h)!)!.click();
        await settle(h);
        http.expectOne(BACK).flush({ checkout: cart([line()], '1111.00') });
        await settle(h);
        expect(dialog(h)).toBeNull();
      });

      it('a paid QR that cannot complete keeps the screen open: the customer paid, so there is no way back', async () => {
        const h = await withCart();
        await withQr(h);
        (byId(h, 'qr-received') as HTMLButtonElement).click();
        http.expectOne(PAYMENT + '/confirm').flush({ payment: qrPayment('CONFIRMED') });
        await settle(h);
        http
          .expectOne(COMPLETE)
          .flush({ code: 'INSUFFICIENT_STOCK', message: 'no stock', details: { productId: 'p1', available: 1 } }, { status: 409, statusText: 'Conflict' });
        await settle(h);
        expect(text(h)).toContain('Solo hay 1 disponibles en Central.');
        // no BACK request (verified by http.verify) and the dialog is still there, with "Cancelar" off
        expect(payDialog(h)!.querySelector('[role=dialog]')).not.toBeNull();
        expect(button(h, 'Cancelar', payDialog(h)!)!.disabled).toBe(true);
        // completing again with the same key is possible once the cause is gone
        (byId(h, 'qr-complete') as HTMLButtonElement).click();
        const retry = http.expectOne(COMPLETE);
        expect(retry.request.body.idempotencyKey).toBe('qr-key-0001');
        retry.flush({ sale });
        await settle(h);
        expect(text(h)).toContain('V-000125');
      });

      it('a refresh with a QR still waiting reopens the QR screen instead of dropping it', async () => {
        const paying: PosCheckoutView = { ...cart([line({ unitPrice: '555.50', quantity: 2, lineTotal: '1111.00' })], '1111.00'), status: 'PAYING' };
        const h = await open(undefined, shift, undefined, paying);
        http.expectOne(QR).flush({ payment: qrPayment() });
        http.expectOne(CARD).flush({ payment: null });
        await settle(h);
        expect(byId(h, 'qr-waiting')).not.toBeNull();
        expect(byId(h, 'qr-amount')!.textContent).toBe('Bs 1.111,00');
      });

      it('a refresh with a QR already paid completes the sale with it', async () => {
        const paying: PosCheckoutView = { ...cart([line({ unitPrice: '555.50', quantity: 2, lineTotal: '1111.00' })], '1111.00'), status: 'PAYING' };
        const h = await open(undefined, shift, undefined, paying);
        http.expectOne(QR).flush({ payment: qrPayment('CONFIRMED') });
        http.expectOne(CARD).flush({ payment: null });
        await settle(h);
        const complete = http.expectOne(COMPLETE);
        expect(complete.request.body).toMatchObject({ payments: [{ method: 'QR', paymentId: 'q1' }], idempotencyKey: 'qr-key-0001' });
        complete.flush({ sale });
        await settle(h);
        expect(text(h)).toContain('V-000125');
      });
    });

    describe('card payment (VP-12, HU-VEN-10)', () => {
      const cardPayment = (over: Partial<PosCardPayment> = {}): PosCardPayment => ({
        paymentId: 'c1',
        idempotencyKey: 'card-key-0001',
        amount: '1111.00',
        status: 'PENDING',
        attempt: 1,
        authorizationCode: null,
        declineReason: null,
        ...over,
      });
      const chip = (h: RouterTestingHarness, label: string) =>
        Array.from(root(h).querySelectorAll('.methods rs-filter-chip'))
          .find((c) => c.textContent?.trim() === label)!
          .querySelector('button')!;

      /** Payment open, card chosen and the server's pending attempt on screen. */
      async function withCard(h: RouterTestingHarness) {
        await startPayment(h);
        chip(h, 'Tarjeta').click();
        await settle(h);
        const start = http.expectOne(CARD);
        expect(start.request.method).toBe('POST');
        expect(start.request.body).toMatchObject({ expectedTotal: '1111.00' });
        start.flush({ payment: cardPayment() });
        await settle(h);
      }

      it('"Aprobado" with the code completes the sale with the card, under the attempt’s own key', async () => {
        const h = await withCart();
        await withCard(h);
        expect(byId(h, 'card-waiting')).not.toBeNull();
        byId(h, 'card-approved')!.click();
        await settle(h);
        const code = byId(h, 'card-code') as HTMLInputElement;
        code.value = 'A1B2C3';
        code.dispatchEvent(new Event('input'));
        await settle(h);
        byId(h, 'card-approve-confirm')!.click();
        await settle(h);
        const confirm = http.expectOne('/api/v1/sales/pos/checkout/payments/card/c1/confirm');
        expect(confirm.request.body).toEqual({ outcome: 'APPROVED', authorizationCode: 'A1B2C3' });
        confirm.flush({ payment: cardPayment({ status: 'CONFIRMED', authorizationCode: 'A1B2C3' }) });
        await settle(h);
        const complete = http.expectOne(COMPLETE);
        expect(complete.request.body).toMatchObject({ payments: [{ method: 'CARD', paymentId: 'c1' }], idempotencyKey: 'card-key-0001' });
        complete.flush({ sale });
        await settle(h);
        expect(text(h)).toContain('V-000125');
      });

      it('a decline shows why and offers to retry, change the method or go back to the sale', async () => {
        const h = await withCart();
        await withCard(h);
        byId(h, 'card-declined')!.click();
        await settle(h);
        root(h).querySelector<HTMLInputElement>('rs-pos-card-panel rs-radio input')!.click();
        await settle(h);
        byId(h, 'card-decline-confirm')!.click();
        await settle(h);
        http
          .expectOne('/api/v1/sales/pos/checkout/payments/card/c1/confirm')
          .flush({ payment: cardPayment({ status: 'DECLINED', declineReason: 'INSUFFICIENT_FUNDS' }) });
        await settle(h);
        expect(text(h)).toContain('Tarjeta rechazada');
        expect(byId(h, 'card-decline-reason')!.textContent).toBe('Fondos insuficientes');
        // Figma VP-12: "Reintentar cobro" in the footer, and the other methods stay available as chips
        expect(byId(h, 'card-new')).not.toBeNull();
        expect(chip(h, 'Efectivo').disabled).toBe(false);
        // "Cancelar" returns the cart to OPEN
        payDialog(h)!.querySelector<HTMLButtonElement>('[data-cancel]')!.click();
        await settle(h);
        http.expectOne(BACK).flush({ checkout: cart([line({ unitPrice: '555.50', quantity: 2, lineTotal: '1111.00' })], '1111.00') });
        await settle(h);
        expect(dialog(h)).toBeNull();
      });

      it('the cashier changes to cash after a decline with the cash chip', async () => {
        const h = await withCart();
        await withCard(h);
        byId(h, 'card-declined')!.click();
        await settle(h);
        root(h).querySelector<HTMLInputElement>('rs-pos-card-panel rs-radio input')!.click();
        await settle(h);
        byId(h, 'card-decline-confirm')!.click();
        await settle(h);
        http
          .expectOne('/api/v1/sales/pos/checkout/payments/card/c1/confirm')
          .flush({ payment: cardPayment({ status: 'DECLINED', declineReason: 'CARD_DECLINED' }) });
        await settle(h);
        chip(h, 'Efectivo').click();
        await settle(h);
        expect(root(h).querySelector('rs-numpad')).not.toBeNull();
        expect(byId(h, 'card-new')).toBeNull();
      });

      it('a refresh with an approved card completes the sale with it', async () => {
        const paying: PosCheckoutView = { ...cart([line({ unitPrice: '555.50', quantity: 2, lineTotal: '1111.00' })], '1111.00'), status: 'PAYING' };
        const h = await open(undefined, shift, undefined, paying);
        http.expectOne(QR).flush({ payment: null });
        http.expectOne(CARD).flush({ payment: cardPayment({ status: 'CONFIRMED', authorizationCode: 'A1B2C3' }) });
        await settle(h);
        const complete = http.expectOne(COMPLETE);
        expect(complete.request.body).toMatchObject({ payments: [{ method: 'CARD', paymentId: 'c1' }], idempotencyKey: 'card-key-0001' });
        complete.flush({ sale });
        await settle(h);
        expect(text(h)).toContain('V-000125');
      });

      it('a refresh with a declined card reopens the screen on the decline', async () => {
        const paying: PosCheckoutView = { ...cart([line({ unitPrice: '555.50', quantity: 2, lineTotal: '1111.00' })], '1111.00'), status: 'PAYING' };
        const h = await open(undefined, shift, undefined, paying);
        http.expectOne(QR).flush({ payment: null });
        http.expectOne(CARD).flush({ payment: cardPayment({ status: 'DECLINED', declineReason: 'CARD_DECLINED', attempt: 2 }) });
        await settle(h);
        expect(text(h)).toContain('Tarjeta rechazada');
        expect(byId(h, 'card-decline-reason')!.textContent).toBe('Tarjeta rechazada');
      });

      it('the Tarjeta chip is disabled when the company turned card off', async () => {
        const h = await withCart();
        button(h, 'Cobrar')!.click();
        await settle(h);
        http.expectOne(PAY).flush({ total: '1111.00', suggestedAmounts: [], allowMixed: true, cardEnabled: false });
        await settle(h);
        expect(chip(h, 'Tarjeta').disabled).toBe(true);
      });
    });

    describe('mixed payment (VP-04c, HU-VEN-09)', () => {
      const part = (status: PosQrPayment['status'] = 'PENDING', amount = '700.00'): PosQrPayment => ({
        paymentId: 'q1',
        idempotencyKey: 'mix-key-0001',
        amount,
        qrPayload: `RODASOFT-MOCK|ref-1|${amount}`,
        status,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      });
      const PAYMENT = '/api/v1/sales/pos/checkout/payments/q1';
      const field = (h: RouterTestingHarness, id: string) => root(h).querySelector<HTMLInputElement>(`#${id}`)!;
      const typeIn = async (h: RouterTestingHarness, id: string, value: string) => {
        const input = field(h, id);
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await settle(h);
      };

      it('pays 511 by QR and the rest in cash with one sale, under the QR key', async () => {
        const h = await withCart();
        await startPayment(h);
        Array.from(root(h).querySelectorAll('.methods rs-filter-chip'))
          .find((c) => c.textContent?.trim() === 'Mixto')!
          .querySelector('button')!
          .click();
        await settle(h);
        await typeIn(h, 'mix-qr-field', '511');
        expect(field(h, 'mix-cash').value).toBe('600');
        expect(byId(h, 'mix-remaining')!.textContent).toBe('Bs 0,00');
        byId(h, 'mix-confirm')!.click();
        await settle(h);
        const start = http.expectOne(QR);
        expect(start.request.body).toMatchObject({ expectedTotal: '1111.00', amount: '511.00' });
        start.flush({ payment: part('PENDING', '511.00') });
        await settle(h);
        byId(h, 'qr-received')!.click();
        http.expectOne(PAYMENT + '/confirm').flush({ payment: part('CONFIRMED', '511.00') });
        await settle(h);
        const complete = http.expectOne(COMPLETE);
        expect(complete.request.body).toEqual({
          payments: [
            { method: 'CASH', received: '600.00' },
            { method: 'QR', paymentId: 'q1' },
          ],
          expectedTotal: '1111.00',
          idempotencyKey: 'mix-key-0001',
        });
        complete.flush({ sale: { ...sale, received: '1111.00', change: '0.00' } });
        await settle(h);
        expect(text(h)).toContain('V-000125');
      });

      it('does not offer "Mixto" when the company turned it off', async () => {
        const h = await withCart();
        button(h, 'Cobrar')!.click();
        await settle(h);
        http.expectOne(PAY).flush({ total: '1111.00', suggestedAmounts: ['1150.00'], allowMixed: false });
        await settle(h);
        const labels = Array.from(root(h).querySelectorAll('.methods rs-filter-chip')).map((c) => c.textContent?.trim());
        expect(labels).not.toContain('Mixto');
      });

      it('a refresh with a paid part resumes on the form with the QR fixed and does not complete by itself', async () => {
        const paying: PosCheckoutView = { ...cart([line({ unitPrice: '555.50', quantity: 2, lineTotal: '1111.00' })], '1111.00'), status: 'PAYING' };
        const h = await open(undefined, shift, undefined, paying);
        http.expectOne(QR).flush({ payment: part('CONFIRMED'), total: '1111.00', allowMixed: true });
        http.expectOne(CARD).flush({ payment: null });
        await settle(h);
        http.expectNone(COMPLETE);
        expect(byId(h, 'pay-total')!.textContent).toBe('Bs 1.111,00');
        expect(field(h, 'mix-qr-field').disabled).toBe(true);
        expect(field(h, 'mix-qr-field').value).toBe('700');
        expect(field(h, 'mix-cash').value).toBe('411');
        expect(byId(h, 'mix-confirm')).not.toBeNull();
      });
    });

    it('prints the ticket in its own tab', async () => {
      const h = await withCart();
      await startPayment(h);
      for (const k of ['1', '2', '0', '0']) keydown(k);
      await settle(h);
      (byId(h, 'pay-confirm') as HTMLButtonElement).click();
      http.expectOne(COMPLETE).flush({ sale });
      await settle(h);
      const opened = jest.spyOn(window, 'open').mockReturnValue(null);
      button(h, 'Imprimir ticket')!.click();
      expect(opened).toHaveBeenCalledWith('/sales/receipts/s1/print', '_blank', 'noopener');
      opened.mockRestore();
    });

    it('sends the receipt by e-mail through the server', async () => {
      const h = await withCart();
      await startPayment(h);
      for (const k of ['1', '2', '0', '0']) keydown(k);
      await settle(h);
      (byId(h, 'pay-confirm') as HTMLButtonElement).click();
      http.expectOne(COMPLETE).flush({ sale: { ...sale, customerEmail: 'compras@minerademo.bo' } });
      await settle(h);
      button(h, 'Correo')!.click();
      await settle(h);
      const input = root(h).querySelector<HTMLInputElement>('#sale-email')!;
      expect(input.value).toBe('compras@minerademo.bo');
      button(h, 'Enviar')!.click();
      const req = http.expectOne('/api/v1/sales/sales/s1/receipt/email');
      expect(req.request.body).toEqual({ email: 'compras@minerademo.bo' });
      req.flush({ queued: true });
      await settle(h);
      expect(text(h)).toContain('Enviamos el comprobante a compras@minerademo.bo.');
    });
  });

  describe('customer and invoice data (VP-03c, HU-VEN-05, HU-VEN-37)', () => {
    const CUSTOMER_URL = '/api/v1/sales/pos/customers';
    const SET_CUSTOMER = '/api/v1/sales/pos/checkout/customer';
    const total = (h: RouterTestingHarness) => root(h).querySelector('[data-testid=pos-total]')!.textContent!.trim();
    const block = (h: RouterTestingHarness) => root(h).querySelector<HTMLElement>('rs-pos-customer')!;
    const wait = () => new Promise((resolve) => setTimeout(resolve, 300));

    const minera: CustomerSummary = {
      id: 'c1',
      name: 'Minera Demo Ltda.',
      documentType: 5,
      documentNumber: '1023456027',
      complement: null,
      email: 'compras@minerademo.bo',
      phone: null,
      creditEnabled: false,
      discount: { type: 'PERCENT', value: '10.00' },
      status: 'ACTIVE',
    };

    /** A cart of one line (2 × Bs 245) invoiced to Minera, with its 10 % discount. */
    const discounted = (): PosCheckoutView => ({
      ...cart([line()], '490.00', '441.00'),
      customer: minera,
      pricing: { roundingMode: 'NONE', discount: { type: 'PERCENT', value: '10.00' } },
      discount: '49.00',
    });

    /** Opens the dialog with the button of the block and answers its first (empty) search. */
    async function openDialog(h: RouterTestingHarness, items: CustomerSummary[] = [minera]) {
      button(h, 'Agregar NIT', block(h))!.click();
      await settle(h);
      await wait();
      http.expectOne((r) => r.url === CUSTOMER_URL && r.params.get('q') === '').flush({ items });
      await settle(h);
    }

    it('invoices a final consumer by default: "Consumidor final", no NIT, S/N', async () => {
      const h = await open(undefined, shift);
      expect(block(h).getAttribute('data-type')).toBe('final');
      expect(block(h).textContent).toContain('Consumidor final');
      expect(block(h).textContent).toContain('Sin NIT · factura a S/N');
      expect(button(h, 'Agregar NIT', block(h))).toBeDefined();
    });

    it('shows the customer, their NIT and the discount the server applied', async () => {
      const h = await open(undefined, shift, undefined, discounted());
      expect(block(h).getAttribute('data-type')).toBe('identified');
      expect(block(h).textContent).toContain('Minera Demo Ltda.');
      expect(block(h).textContent).toContain('NIT 1023456027 · compras@minerademo.bo · 10 % de descuento');
      expect(button(h, 'Cambiar', block(h))).toBeDefined();
      expect(text(h)).toContain('Descuento');
      expect(text(h)).toContain('−Bs 49,00');
      expect(total(h)).toBe('Bs 441,00');
    });

    it('recalculates the total with the customer discount at once when the quantity changes', async () => {
      const h = await open(undefined, shift, undefined, discounted());
      button(h, 'Sumar uno')!.click();
      await settle(h);
      // 3 × 245 = 735, minus 10 % = 661,50, before the API answers
      expect(total(h)).toBe('Bs 661,50');
      http.expectOne(`${ITEMS}/l1`).flush({
        checkout: { ...discounted(), lines: [line({ quantity: 3, lineTotal: '735.00' })], subtotal: '735.00', discount: '73.50', total: '661.50' },
      });
      await settle(h);
      expect(total(h)).toBe('Bs 661,50');
    });

    it('opens the search from the button and from F4', async () => {
      const h = await open(undefined, shift);
      await openDialog(h);
      expect(dialog(h)).not.toBeNull();
      expect(dialog(h)!.textContent).toContain('Cliente y datos de factura');

      TestBed.resetTestingModule();
      const h2 = await open(undefined, shift);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true }));
      await settle(h2);
      await wait();
      http.expectOne((r) => r.url === CUSTOMER_URL).flush({ items: [] });
      await settle(h2);
      expect(dialog(h2)).not.toBeNull();
    });

    it('sets the customer of the cart, shows their discount and closes the dialog', async () => {
      const h = await open(undefined, shift, undefined, cart([line()], '490.00'));
      await openDialog(h);
      dialog(h)!.querySelector<HTMLButtonElement>('button.option')!.click();
      await settle(h);
      button(h, 'Usar cliente', dialog(h)!)!.click();
      const req = http.expectOne(SET_CUSTOMER);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ customerId: 'c1' });
      req.flush({ checkout: discounted() });
      await settle(h);
      expect(dialog(h)).toBeNull();
      expect(block(h).textContent).toContain('Minera Demo Ltda.');
      expect(total(h)).toBe('Bs 441,00');
    });

    it('"Consumidor final" sends no customer and takes the discount off', async () => {
      const h = await open(undefined, shift, undefined, discounted());
      button(h, 'Cambiar', block(h))!.click();
      await settle(h);
      await wait();
      http.expectOne((r) => r.url === CUSTOMER_URL).flush({ items: [minera] });
      await settle(h);
      button(h, 'Consumidor final', dialog(h)!)!.click();
      const req = http.expectOne(SET_CUSTOMER);
      expect(req.request.body).toEqual({ customerId: null });
      req.flush({ checkout: cart([line()], '490.00') });
      await settle(h);
      expect(dialog(h)).toBeNull();
      expect(block(h).getAttribute('data-type')).toBe('final');
      expect(total(h)).toBe('Bs 490,00');
    });

    it('keeps the dialog open and says why when the server refuses the customer', async () => {
      const h = await open(undefined, shift, undefined, cart([line()], '490.00'));
      await openDialog(h);
      dialog(h)!.querySelector<HTMLButtonElement>('button.option')!.click();
      await settle(h);
      button(h, 'Usar cliente', dialog(h)!)!.click();
      http.expectOne(SET_CUSTOMER).flush({ code: 'CUSTOMER_INACTIVE', message: 'inactive' }, { status: 409, statusText: 'Conflict' });
      await settle(h);
      expect(dialog(h)).not.toBeNull();
      expect(text(h)).toContain('Este cliente está desactivado y no se puede usar en una venta.');
      expect(block(h).getAttribute('data-type')).toBe('final');
    });

    it('does not open the search without an open shift (F4 on the closed register)', async () => {
      const h = await open();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true }));
      await settle(h);
      http.expectNone((r) => r.url === CUSTOMER_URL);
    });
  });
});
