import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { PurchaseBookRow, PurchasesBookResponse } from '@rodasoft/domain';
import { PurchaseEntryPage } from './purchase-entry.page';

const BOOK = '/api/v1/invoicing/vat-books/purchases';
const VERIFY = '/api/v1/invoicing/vat-books/purchases/p1/verify-nit';

const entry: PurchaseBookRow = {
  id: 'p1',
  date: '2026-10-08',
  supplierNit: '1020304132',
  supplierName: 'Embalajes Demo S.A.',
  authorizationCode: 'A',
  invoiceNumber: '000221',
  total: '1200.00',
  vatCredit: '156.00',
  status: 'OBSERVED',
  observation: 'NIT INVALIDO',
  nitVerifiedAt: null,
};

const book = (rows: PurchaseBookRow[] = [entry]): PurchasesBookResponse => ({
  period: '2026-10',
  draft: false,
  format: 'SIN_LCV',
  exportFormats: ['XLSX', 'CSV'],
  rows,
  totals: { entries: rows.length, observed: 1, totalAmount: '0.00', vatCredit: '0.00', observedAmount: '1200.00', observedVatCredit: '156.00' },
});

@Component({ template: '' })
class StubPage {}

describe('PurchaseEntryPage (FS-38)', () => {
  let http: HttpTestingController;

  async function open(url = '/invoicing/books/purchases/p1?period=2026-10') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'invoicing/books/purchases/:id', component: PurchaseEntryPage },
          { path: 'invoicing/books', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, PurchaseEntryPage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const type = (h: RouterTestingHarness, value: string) => {
    const input = root(h).querySelector<HTMLInputElement>('#purchase-nit') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    h.detectChanges();
  };
  const verifyButton = (h: RouterTestingHarness) => root(h).querySelector<HTMLButtonElement>('[data-testid="purchase-nit-verify"]') as HTMLButtonElement;

  afterEach(() => http.verify());

  it('shows a skeleton while it loads', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne((r) => r.url === BOOK).flush(book());
  });

  it('says the NIT is not valid, shows the credit it would add and the invoice data', async () => {
    const h = await open();
    http.expectOne((r) => r.url === BOOK).flush(book());
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(text).toContain('Compra 000221 · observada');
    expect(text).toContain('NIT del proveedor no válido');
    expect(text).toContain('Bs 156,00 de crédito fiscal (13 % de Bs 1.200,00)');
    expect(text).toContain('Embalajes Demo S.A.');
    expect(text).toContain('08/10/2026');
  });

  it('verifies the stored NIT without sending it, and validates the purchase when the SIN knows it', async () => {
    const h = await open();
    http.expectOne((r) => r.url === BOOK).flush(book());
    await settle(h);
    verifyButton(h).click();
    const req = http.expectOne(VERIFY);
    expect(req.request.body).toEqual({});
    req.flush({ valid: true, messages: [], entry: { ...entry, status: 'VALID', observation: null } });
    await settle(h);
    expect(root(h).querySelector('[data-testid="purchase-valid-note"]')).not.toBeNull();
    expect(root(h).querySelector('[data-testid="purchase-observed-note"]')).toBeNull();
  });

  it('sends a corrected NIT, and an unknown one stays on the page with the SIN answer', async () => {
    const h = await open();
    http.expectOne((r) => r.url === BOOK).flush(book());
    await settle(h);
    type(h, '1020304999');
    verifyButton(h).click();
    const req = http.expectOne(VERIFY);
    expect(req.request.body).toEqual({ supplierNit: '1020304999' });
    req.flush({ valid: false, messages: [{ code: 1037, description: 'NIT INVALIDO' }], entry });
    await settle(h);
    expect(root(h).textContent).toContain('El SIAT no reconoce este NIT');
    expect(TestBed.inject(Router).url).toContain('/invoicing/books/purchases/p1');
  });

  it('"Guardar y validar" verifies and goes back to the book once the purchase is valid', async () => {
    const h = await open();
    http.expectOne((r) => r.url === BOOK).flush(book());
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('[data-testid="purchase-save"]')?.click();
    http.expectOne(VERIFY).flush({ valid: true, messages: [], entry: { ...entry, status: 'VALID', observation: null } });
    await settle(h);
    await settle(h);
    expect(TestBed.inject(Router).url).toBe('/invoicing/books?book=purchases&period=2026-10');
  });

  it('refuses a malformed NIT before calling the API, and shows an offline SIAT', async () => {
    const h = await open();
    http.expectOne((r) => r.url === BOOK).flush(book());
    await settle(h);
    type(h, 'abc');
    expect(verifyButton(h).disabled).toBe(true);
    type(h, '1020304132');
    verifyButton(h).click();
    http.expectOne(VERIFY).flush({ code: 'SIAT_UNAVAILABLE', message: 'x' }, { status: 503, statusText: 'Service Unavailable' });
    await settle(h);
    expect(root(h).textContent).toContain('El SIAT no responde en este momento');
  });

  it('shows not-found for a purchase that is not in the book, or a url without period, and the no-permission state', async () => {
    const h = await open();
    http.expectOne((r) => r.url === BOOK).flush(book([{ ...entry, id: 'other' }]));
    await settle(h);
    expect(root(h).textContent).toContain('La compra no existe');
  });
});
