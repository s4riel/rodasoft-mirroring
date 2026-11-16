import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { currentVatBookPeriod, type PurchaseBookRow, type PurchasesBookResponse, type SalesBookResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import * as fileDownload from './file-download';
import { VatBooksPage } from './vat-books.page';

const SALES = '/api/v1/invoicing/vat-books/sales';
const PURCHASES = '/api/v1/invoicing/vat-books/purchases';
const period = currentVatBookPeriod(new Date());

const sales = (over: Partial<SalesBookResponse> = {}): SalesBookResponse => ({
  period,
  draft: true,
  format: 'SIN_LCV',
  exportFormats: ['XLSX', 'CSV'],
  rows: [
    { id: 'i1', kind: 'INVOICE', date: '2026-11-14T14:00:00.000Z', number: 1528, cuf: 'C1', customerDocumentNumber: '1020304025', customerName: 'Industrias Demo S.A.', total: '1280.00', fiscalDebit: '166.40', status: 'VALID' },
    { id: 'i2', kind: 'INVOICE', date: '2026-11-12T14:00:00.000Z', number: 1520, cuf: 'C2', customerDocumentNumber: '0', customerName: 'Cliente mostrador', total: '0.00', fiscalDebit: '0.00', status: 'CANCELLED' },
  ],
  totals: { invoices: 1, cancelled: 1, creditNotes: 0, invoicedAmount: '1280.00', creditedAmount: '0.00', netAmount: '1280.00', fiscalDebit: '166.40' },
  ...over,
});

const entry = (over: Partial<PurchaseBookRow> = {}): PurchaseBookRow => ({
  id: 'p1',
  date: '2026-11-08',
  supplierNit: '1020304132',
  supplierName: 'Embalajes Demo S.A.',
  authorizationCode: 'A',
  invoiceNumber: '000221',
  total: '1200.00',
  vatCredit: '156.00',
  status: 'OBSERVED',
  observation: 'NIT INVALIDO',
  nitVerifiedAt: null,
  ...over,
});

const purchases = (rows: PurchaseBookRow[] = [entry(), entry({ id: 'p2', invoiceNumber: '000087', status: 'VALID', total: '380.00', vatCredit: '49.40', observation: null })]): PurchasesBookResponse => ({
  period,
  draft: true,
  format: 'SIN_LCV',
  exportFormats: ['XLSX', 'CSV'],
  rows,
  totals: { entries: rows.length, observed: rows.filter((r) => r.status === 'OBSERVED').length, totalAmount: '380.00', vatCredit: '49.40', observedAmount: '1200.00', observedVatCredit: '156.00' },
});

@Component({ template: '' })
class StubPage {}

describe('VatBooksPage (FS-08, FS-10, FS-38, FS-39)', () => {
  let http: HttpTestingController;

  async function open(url = '/invoicing/books') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'invoicing/books', component: VatBooksPage }, { path: 'invoicing/books/purchases/:id', component: StubPage }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(['invoicing.vat-books.view'])) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, VatBooksPage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const request = (path: string) => http.expectOne((req) => req.url === path);

  afterEach(() => http.verify());

  it('shows a skeleton while it loads', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    request(SALES).flush(sales());
  });

  it('sales book: the open period is a draft, the indicators and the rows match the API, a cancelled invoice reads Anulada', async () => {
    const h = await open();
    const req = request(SALES);
    expect(req.request.params.get('period')).toBe(period);
    req.flush(sales());
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(root(h).querySelector('[data-testid="book-draft-note"]')?.textContent).toContain('Lo que exportes ahora sale como borrador');
    expect(root(h).querySelector('[data-testid="book-kpis"]')?.textContent).toContain('Bs 166,40');
    expect(text).toContain('Industrias Demo S.A. · 1020304025');
    expect(text).toContain('001528');
    expect(text).toContain('Anulada');
    expect(text).toContain('2 registros · 1 anulada');
  });

  it('a closed period has no draft note', async () => {
    const h = await open('/invoicing/books?period=2025-03');
    request(SALES).flush(sales({ period: '2025-03', draft: false }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="book-draft-note"]')).toBeNull();
  });

  it('purchases book: the observed purchase is flagged, adds no credit and its row menu opens the purchase', async () => {
    const h = await open('/invoicing/books?book=purchases');
    request(PURCHASES).flush(purchases());
    await settle(h);
    expect(root(h).querySelector('[data-testid="book-observed-note"]')?.textContent).toContain('000221');
    expect(root(h).querySelector('[data-testid="book-kpis"]')?.textContent).toContain('Bs 49,40');
    expect(root(h).textContent).toContain('Observada');
    const page = h.routeDebugElement?.componentInstance as { openEntry(entry: PurchaseBookRow): void };
    page.openEntry(entry());
    await settle(h);
    expect(TestBed.inject(Router).url).toBe(`/invoicing/books/purchases/p1?period=${period}`);
  });

  it('the search box filters the month on screen', async () => {
    const h = await open('/invoicing/books?book=purchases');
    request(PURCHASES).flush(purchases());
    await settle(h);
    const page = h.routeDebugElement?.componentInstance as { search: { set(v: string): void } };
    page.search.set('000087');
    await settle(h);
    expect(root(h).textContent).not.toContain('Bs 1.200,00');
    expect(root(h).textContent).toContain('Bs 380,00');
    page.search.set('zzz');
    await settle(h);
    expect(root(h).textContent).toContain('No encontramos registros');
  });

  it('exports the chosen book as a file and says it is a draft', async () => {
    const save = jest.spyOn(fileDownload, 'saveBlob').mockImplementation(() => undefined);
    const h = await open();
    request(SALES).flush(sales());
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('[data-testid="book-export"]')?.click();
    await settle(h);
    expect(root(h).querySelector('[data-testid="export-file-name"]')?.textContent).toBe(`libro-ventas-${period}-BORRADOR.xlsx`);
    root(h).querySelector<HTMLButtonElement>('[data-testid="export-confirm"]')?.click();
    const req = http.expectOne((r) => r.url === '/api/v1/invoicing/vat-books/export');
    expect(req.request.params.get('book')).toBe('SALES');
    expect(req.request.params.get('format')).toBe('XLSX');
    req.flush(new Blob(['x']), { headers: { 'X-Vat-Book-Draft': 'true' } });
    await settle(h);
    expect(save).toHaveBeenCalledWith(expect.any(Blob), `libro-ventas-${period}-BORRADOR.xlsx`);
    save.mockRestore();
  });

  it('shows the empty, error and no-permission states', async () => {
    const h = await open();
    request(SALES).flush(sales({ rows: [] }));
    await settle(h);
    expect(root(h).textContent).toContain('No hay registros en');
  });

  it('no-permission and error', async () => {
    const h = await open();
    request(SALES).flush({ code: 'INTERNAL', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(root(h).textContent).toContain('No pudimos cargar el libro');
    Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Reintentar'))?.click();
    request(SALES).flush({ code: 'NO_PERMISSION', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(root(h).textContent).toContain('No tienes permiso para ver los libros IVA');
  });
});
