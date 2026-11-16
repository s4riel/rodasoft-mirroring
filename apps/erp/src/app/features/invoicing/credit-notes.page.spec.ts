import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CreditNoteListItem, CreditNoteListResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { CreditNotesPage } from './credit-notes.page';

const URL = '/api/v1/invoicing/notes';

const item = (over: Partial<CreditNoteListItem> = {}): CreditNoteListItem => ({
  id: 'n1',
  number: 45,
  status: 'VALID',
  invoiceId: 'i1',
  invoiceNumber: 1528,
  customerName: 'Industrias Demo S.A.',
  returnId: 'r1',
  returnNumber: 'DEV-000012',
  total: '245.00',
  issuedAt: '2026-11-14T16:06:00.000Z',
  createdAt: '2026-11-14T16:05:00.000Z',
  branchId: 'b1',
  rejectionMessage: null,
  actions: ['VIEW_DETAIL'],
  ...over,
});

const response = (items: CreditNoteListItem[], over: Partial<CreditNoteListResponse> = {}): CreditNoteListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  totalAmount: items.reduce((sum, i) => sum + Number(i.total), 0).toFixed(2),
  kpis: { issuedThisMonth: { count: 3, total: '665.00' }, notIssued: 1, fromReturns: 2, rejected: 0 },
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('CreditNotesPage (FS-23)', () => {
  let http: HttpTestingController;

  async function open(url = '/invoicing/notes') {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'invoicing/notes', component: CreditNotesPage },
          { path: 'invoicing/notes/:id', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(['invoicing.invoices.view'])) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, CreditNotesPage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const request = () => http.expectOne((req) => req.url === URL);

  afterEach(() => http.verify());

  it('shows a skeleton while it loads', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    request().flush(response([]));
  });

  it('lists the notes with the month indicators, the status pill, the origin and the total row', async () => {
    const h = await open();
    request().flush(response([item(), item({ id: 'n2', number: null, status: 'PENDING', returnId: null, returnNumber: null, total: '40.00' })]));
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(text).toContain('3 · Bs 665,00');
    expect(text).toContain('2 de 3');
    expect(text).toContain('Devolución DEV-000012');
    expect(text).toContain('Ajuste de precio');
    expect(text).toContain('Válida');
    expect(text).toContain('No emitida en SIAT');
    expect(text).toContain('Bs 285,00');
    expect(root(h).querySelector('a.number')?.getAttribute('href')).toBe('/invoicing/notes/n1');
  });

  it('sends the filters of the url to the API', async () => {
    const h = await open('/invoicing/notes?status=PENDING&q=DEV&page=2');
    const req = request();
    expect(req.request.params.get('status')).toBe('PENDING');
    expect(req.request.params.get('q')).toBe('DEV');
    expect(req.request.params.get('page')).toBe('2');
    req.flush(response([]));
    await settle(h);
  });

  it('shows the first-use empty state', async () => {
    const h = await open();
    request().flush(response([]));
    await settle(h);
    expect(root(h).textContent).toContain('Aún no hay notas de crédito');
  });

  it('shows "no results" when filters are on', async () => {
    const h = await open('/invoicing/notes?q=zzz');
    request().flush(response([]));
    await settle(h);
    expect(root(h).textContent).toContain('No encontramos notas');
  });

  it('shows the error state with a retry and the no-permission state on 403', async () => {
    const h = await open();
    request().flush({ code: 'INTERNAL', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(root(h).textContent).toContain('No pudimos cargar las notas');
    Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Reintentar'))?.click();
    request().flush({ code: 'NO_PERMISSION', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(root(h).textContent).toContain('No tienes permiso para ver las notas de crédito');
  });
});
