import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CashShiftDetail, CloseCashShiftResponse } from '@rodasoft/domain';
import { ContextStore } from '../../../core/context.store';
import { CashClosingPage } from './cash-closing.page';
import { CURRENT_SHIFT, shiftDetail } from './cash.testing';

const CURRENT = '/api/v1/sales/cash-shifts/current';
const SHIFT = '/api/v1/sales/cash-shifts/s1';
const CLOSE = '/api/v1/sales/cash-shifts/s1/close';

@Component({ template: '' })
class Stub {}

interface PageApi {
  setQuantity(denomination: string, value: number): void;
  setDeclared(method: 'QR' | 'CARD' | 'TRANSFER', value: string): void;
}

const closed = (over: Partial<CloseCashShiftResponse> = {}): CloseCashShiftResponse => ({
  shiftId: 's1',
  status: 'APPROVED',
  expectedAmount: '970.00',
  countedAmount: '970.00',
  differenceAmount: '0.00',
  closingFloat: '500.00',
  needsReview: false,
  methods: [],
  ...over,
});

/** VP-06 · Cierre y arqueo de caja (HU-VEN-23). */
describe('CashClosingPage', () => {
  let http: HttpTestingController;

  async function open(opts: { granted?: string[]; noShift?: boolean; detail?: CashShiftDetail | 'error' } = {}) {
    const granted = opts.granted ?? ['sales.cash-register.open'];
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'sales/cash-register/close', component: CashClosingPage },
          { path: 'sales/cash-register', component: Stub },
          { path: 'sales/cash-register/open', component: Stub },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { can: (p: string) => granted.includes(p) } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const h = await RouterTestingHarness.create();
    await h.navigateByUrl('/sales/cash-register/close');
    if (granted.includes('sales.cash-register.open')) {
      http.expectOne(CURRENT).flush({ shift: opts.noShift ? null : CURRENT_SHIFT });
      if (!opts.noShift) {
        const detail = opts.detail ?? shiftDetail();
        const req = http.expectOne(SHIFT);
        if (detail === 'error') req.flush({}, { status: 500, statusText: 'Server Error' });
        else req.flush(detail);
      }
    }
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
    return h;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent?.replace(/\s+/g, ' ') ?? '';
  const page = (h: RouterTestingHarness) => h.routeDebugElement?.componentInstance as PageApi;
  const submit = (h: RouterTestingHarness) => (root(h).querySelector('[data-testid="cash-closing-submit"]') as HTMLButtonElement).click();

  /** Counts Bs 970: the cash the default shift expects. */
  const countExpected = (h: RouterTestingHarness) => {
    for (const [denomination, quantity] of [['200.00', 4], ['100.00', 1], ['50.00', 1], ['20.00', 1]] as const) page(h).setQuantity(denomination, quantity);
    h.detectChanges();
  };

  async function typeInto(h: RouterTestingHarness, selector: string, value: string) {
    const input = root(h).querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('goes to the opening form when there is no open shift', async () => {
    await open({ noShift: true });
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/open');
  });

  it('describes the shift and lists every bill and coin with a stepper and a subtotal', async () => {
    const h = await open();
    expect(text(h)).toContain('Cierre y arqueo de caja');
    expect(text(h)).toContain('Caja 1 · Huayna Kapac · turno de Ana Cajera · 08:02 a ahora · cuenta el efectivo por denominación');
    const table = root(h).querySelectorAll('rs-doc-table')[0];
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(9);
    expect(rows[0].textContent).toContain('Billete de Bs 200,00');
    expect(rows[8].textContent).toContain('Moneda de Bs 0,50');
    expect(table.querySelectorAll('rs-qty-stepper')).toHaveLength(9);
  });

  it('adds up the cash counted as the cashier counts, with the subtotal of each denomination', async () => {
    const h = await open();
    page(h).setQuantity('200.00', 2);
    page(h).setQuantity('0.50', 3);
    h.detectChanges();
    const table = root(h).querySelectorAll('rs-doc-table')[0].textContent?.replace(/\s+/g, ' ') ?? '';
    expect(table).toContain('Bs 400,00');
    expect(table).toContain('Bs 1,50');
    expect(table).toContain('Efectivo contado');
    expect(table).toContain('Bs 401,50');
  });

  it('compares the system with what was counted, prefilling QR, card and transfer with the system amounts', async () => {
    const h = await open();
    const compare = root(h).querySelectorAll('rs-doc-table')[1].textContent?.replace(/\s+/g, ' ') ?? '';
    expect(compare).toContain('Efectivo');
    expect(compare).toContain('Bs 970,00');
    expect(compare).toContain('Tarjeta');
    expect((root(h).querySelector('#cash-declared-qr') as HTMLInputElement).value).toBe('100.00');
    expect((root(h).querySelector('#cash-declared-card') as HTMLInputElement).value).toBe('150.00');
    expect((root(h).querySelector('#cash-declared-transfer') as HTMLInputElement).value).toBe('0.00');
  });

  it('warns about a difference and asks for the justification, with the submit label of the review', async () => {
    const h = await open();
    page(h).setQuantity('200.00', 4);
    h.detectChanges();
    expect(root(h).querySelector('[data-testid="cash-closing-warning"]')?.textContent?.replace(/\s+/g, ' ')).toContain('Diferencia de −Bs 170,00 en efectivo');
    expect(root(h).querySelector('#cash-closing-comment')).not.toBeNull();
    expect(root(h).querySelector('[data-testid="cash-closing-submit"]')?.textContent?.trim()).toBe('Cerrar caja y enviar a revisión');
  });

  it('shows a difference in card as well', async () => {
    const h = await open();
    countExpected(h);
    page(h).setDeclared('CARD', '120.00');
    h.detectChanges();
    expect(root(h).querySelector('[data-testid="cash-closing-warning"]')?.textContent?.replace(/\s+/g, ' ')).toContain('Diferencia de −Bs 30,00 en tarjeta');
  });

  it('needs no justification when everything matches, and says Cerrar caja', async () => {
    const h = await open();
    countExpected(h);
    expect(root(h).querySelector('[data-testid="cash-closing-warning"]')).toBeNull();
    expect(root(h).querySelector('#cash-closing-comment')).toBeNull();
    expect(root(h).querySelector('[data-testid="cash-closing-submit"]')?.textContent?.trim()).toBe('Cerrar caja');
  });

  it('lets a difference within the tolerance close without a justification', async () => {
    const h = await open({ detail: shiftDetail({ differenceTolerance: '5.00' }) });
    page(h).setQuantity('200.00', 4);
    page(h).setQuantity('100.00', 1);
    page(h).setQuantity('50.00', 1);
    page(h).setQuantity('20.00', 1);
    page(h).setQuantity('2.00', 1);
    h.detectChanges();
    // 972 against 970: Bs 2 over, inside the tolerance
    expect(root(h).querySelector('[data-testid="cash-closing-warning"]')).toBeNull();
  });

  it('puts everything back with Recontar', async () => {
    const h = await open();
    page(h).setQuantity('200.00', 4);
    page(h).setDeclared('QR', '5.00');
    await typeInto(h, '#cash-closing-comment', 'algo');
    (root(h).querySelector('[data-testid="cash-closing-recount"]') as HTMLButtonElement).click();
    h.detectChanges();
    expect(root(h).querySelectorAll('rs-doc-table')[0].textContent).toContain('Bs 0,00');
    expect((root(h).querySelector('#cash-declared-qr') as HTMLInputElement).value).toBe('100.00');
    expect((root(h).querySelector('#cash-closing-float') as HTMLInputElement).value).toBe('500.00');
  });

  it('does not send the closing without the justification, and says so', async () => {
    const h = await open();
    page(h).setQuantity('200.00', 4);
    h.detectChanges();
    submit(h);
    h.detectChanges();
    expect(text(h)).toContain('Explica la diferencia antes de cerrar la caja.');
    http.expectNone(CLOSE);
  });

  it('does not send a float larger than the cash counted', async () => {
    const h = await open();
    countExpected(h);
    await typeInto(h, '#cash-closing-float', '1000');
    submit(h);
    h.detectChanges();
    expect(text(h)).toContain('no puede ser mayor que el efectivo contado');
    http.expectNone(CLOSE);
  });

  it('does not send an amount that is not valid', async () => {
    const h = await open();
    countExpected(h);
    page(h).setDeclared('QR', 'abc');
    h.detectChanges();
    submit(h);
    h.detectChanges();
    expect(text(h)).toContain('Ingresa montos válidos para QR, tarjeta y transferencia.');
    http.expectNone(CLOSE);
  });

  it('closes a shift that balances: sends the count, the declared amounts and the float, then goes to the opening', async () => {
    const h = await open();
    countExpected(h);
    submit(h);

    const req = http.expectOne(CLOSE);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      counts: [
        { denomination: '200.00', quantity: 4 },
        { denomination: '100.00', quantity: 1 },
        { denomination: '50.00', quantity: 1 },
        { denomination: '20.00', quantity: 1 },
      ],
      declared: { QR: '100.00', CARD: '150.00', TRANSFER: '0.00' },
      closingFloat: '500.00',
      comment: null,
    });
    req.flush(closed());
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/open');
  });

  it('sends the justification with a closing that differs', async () => {
    const h = await open();
    page(h).setQuantity('200.00', 4);
    h.detectChanges();
    await typeInto(h, '#cash-closing-comment', '  Faltó un vuelto  ');
    submit(h);
    const req = http.expectOne(CLOSE);
    expect(req.request.body).toMatchObject({ comment: 'Faltó un vuelto' });
    req.flush(closed({ status: 'CLOSED', needsReview: true, countedAmount: '800.00', differenceAmount: '-170.00' }));
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/open');
  });

  it('keeps the form and shows the server message when the closing is refused', async () => {
    const h = await open();
    countExpected(h);
    submit(h);
    http.expectOne(CLOSE).flush({ code: 'CASH_SHIFT_HAS_PENDING_PAYMENTS', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await h.fixture.whenStable();
    h.detectChanges();
    expect(root(h).querySelector('[data-testid="cash-closing-error"]')?.textContent).toContain('Hay un pago por QR o tarjeta esperando respuesta');
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/close');
  });

  it('goes to the opening when the shift was already closed', async () => {
    const h = await open();
    countExpected(h);
    submit(h);
    http.expectOne(CLOSE).flush({ code: 'CASH_SHIFT_NOT_OPEN', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await h.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/sales/cash-register/open');
  });

  it('blocks the closing while an expense waits for approval', async () => {
    const h = await open({ detail: shiftDetail({ pendingExpenses: 1 }) });
    expect(root(h).querySelector('[data-testid="cash-closing-blocked"]')?.textContent).toContain('Tienes egresos esperando aprobación');
    expect(root(h).querySelector('[data-testid="cash-closing-submit"]')).toBeNull();
  });

  it('shows the error state, and the no-permission state without calling the API', async () => {
    const failed = await open({ detail: 'error' });
    expect(text(failed)).toContain('No pudimos cargar tu turno');
    TestBed.resetTestingModule();
    const denied = await open({ granted: ['sales.pos.use'] });
    expect(text(denied)).toContain('No tienes permiso para cerrar la caja');
  });
});
