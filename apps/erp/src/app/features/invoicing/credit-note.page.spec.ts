import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CreditableInvoice } from '@rodasoft/domain';
import { CreditNotePage, parseAmount } from './credit-note.page';

const CREDITABLE = '/api/v1/invoicing/invoices/i1/creditable';

const creditable = (over: Partial<CreditableInvoice> = {}): CreditableInvoice => ({
  invoiceId: 'i1',
  saleId: 's1',
  priceAdjustmentAllowed: true,
  invoiceNumber: 1528,
  customerName: 'Industrias Demo S.A.',
  total: '1280.00',
  credited: '0.00',
  reasons: [
    { code: 1, description: 'Devolución de mercadería' },
    { code: 4, description: 'Ajuste de precio' },
  ],
  lines: [
    { saleItemId: 'a', code: '6205-2RS', description: 'Rodamiento rígido', unitPrice: '245.00', invoicedQuantity: 4, invoicedAmount: '980.00', creditableQuantity: 4, creditableAmount: '980.00' },
    { saleItemId: 'b', code: '6201-2RS', description: 'Rodamiento NSK', unitPrice: '100.00', invoicedQuantity: 3, invoicedAmount: '300.00', creditableQuantity: 0, creditableAmount: '0.00' },
  ],
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('parseAmount', () => {
  it('takes a comma or a point and gives a decimal string, or null', () => {
    expect(parseAmount('12,5')).toBe('12.50');
    expect(parseAmount(' 40.00 ')).toBe('40.00');
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1.234')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
  });
});

describe('CreditNotePage (FS-25)', () => {
  let http: HttpTestingController;

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'invoicing/invoices/:id/credit-note', component: CreditNotePage },
          { path: 'invoicing/notes/:id', component: StubPage },
          { path: 'invoicing/invoices/:id', component: StubPage },
          { path: 'sales/history/:id', component: StubPage },
          { path: 'invoicing', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/invoices/i1/credit-note', CreditNotePage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  function type(h: RouterTestingHarness, id: string, value: string) {
    const input = root(h).querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    h.detectChanges();
  }
  const sendButton = (h: RouterTestingHarness) => root(h).querySelector<HTMLButtonElement>('[data-testid="note-send"]') as HTMLButtonElement;

  afterEach(() => http.verify());

  it('shows what is left to credit of each line, and disables a line with nothing left', async () => {
    const h = await open();
    http.expectOne(CREDITABLE).flush(creditable());
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(text).toContain('Solo se puede acreditar lo que se facturó');
    expect(text).toContain('6205-2RS');
    expect(text).toContain('Bs 980,00');
    expect(root(h).querySelector<HTMLInputElement>('#amount-b')?.disabled).toBe(true);
    expect(sendButton(h).disabled).toBe(true);
  });

  it('shows the total and the 13 % VAT live, and refuses more than what is left', async () => {
    const h = await open();
    http.expectOne(CREDITABLE).flush(creditable());
    await settle(h);
    type(h, 'amount-a', '245,00');
    expect(root(h).querySelector('[data-testid="note-total"]')?.textContent).toContain('Total a acreditar: Bs 245,00');
    expect(root(h).querySelector('[data-testid="note-total"]')?.textContent).toContain('Bs 31,85');
    type(h, 'amount-a', '980,01');
    expect(root(h).textContent).toContain('Solo quedan Bs 980,00 por acreditar de esta línea');
    type(h, 'amount-a', 'abc');
    expect(root(h).textContent).toContain('Escribe un monto válido');
  });

  it('sends the note with a reason and goes to its detail', async () => {
    const h = await open();
    http.expectOne(CREDITABLE).flush(creditable());
    await settle(h);
    type(h, 'amount-a', '40');
    // without a reason the button stays disabled
    expect(sendButton(h).disabled).toBe(true);
    const page = h.routeDebugElement?.componentInstance as { reasonCode: { set(code: number): void } };
    page.reasonCode.set(4);
    h.detectChanges();
    expect(sendButton(h).disabled).toBe(false);
    sendButton(h).click();
    const req = http.expectOne('/api/v1/invoicing/invoices/i1/credit-notes');
    expect(req.request.body).toEqual({ reasonCode: 4, items: [{ saleItemId: 'a', quantity: 0, amount: '40.00' }] });
    req.flush({ id: 'n9' });
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/invoicing/notes/n9');
  });

  it('shows the server answer when the note is refused', async () => {
    const h = await open();
    http.expectOne(CREDITABLE).flush(creditable());
    await settle(h);
    type(h, 'amount-a', '40');
    (h.routeDebugElement?.componentInstance as { reasonCode: { set(code: number): void } }).reasonCode.set(4);
    h.detectChanges();
    sendButton(h).click();
    http.expectOne('/api/v1/invoicing/invoices/i1/credit-notes').flush({ code: 'CREDIT_EXCEEDS_INVOICED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await settle(h);
    expect(root(h).textContent).toContain('más de lo que queda por acreditar');
  });

  it('sends the user to the return form of the sale when the company does not allow price adjustments', async () => {
    const h = await open();
    http.expectOne(CREDITABLE).flush(creditable({ priceAdjustmentAllowed: false }));
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/sales/history/s1');
  });

  it('falls back to the sale of the invoice when the user cannot issue notes (403)', async () => {
    const h = await open();
    http.expectOne(CREDITABLE).flush({ code: 'NO_PERMISSION', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    http.expectOne('/api/v1/invoicing/invoices/i1').flush({ id: 'i1', saleId: 's7' });
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/sales/history/s7');
  });
});
