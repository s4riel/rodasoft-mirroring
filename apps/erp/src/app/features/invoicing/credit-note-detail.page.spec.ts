import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { CreditNoteDetail } from '@rodasoft/domain';
import { CreditNoteDetailPage } from './credit-note-detail.page';

const URL = '/api/v1/invoicing/notes/n1';

const detail = (over: Partial<CreditNoteDetail> = {}): CreditNoteDetail => ({
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
  actions: ['VIEW_DETAIL', 'DOWNLOAD_PDF', 'DOWNLOAD_XML'],
  cuf: 'ABCDEF0123',
  siatReceptionCode: 'SIM-NC-1',
  rejectionCode: null,
  lastError: null,
  reasonCode: 2,
  vatAdjusted: '31.85',
  customerDocumentNumber: '1234567',
  branchName: 'Huayna Kapac',
  invoice: { id: 'i1', number: 1528, status: 'VALID', issuedAt: '2026-11-14T14:24:00.000Z', total: '1280.00', saleId: 's1' },
  lines: [{ saleItemId: 'a', code: '6205-2RS', description: 'Rodamiento rígido', quantity: 1, unitPrice: '245.00', amount: '245.00' }],
  history: [{ at: '2026-11-14T16:06:00.000Z', action: 'invoicing.note.accept', actor: null, detail: 'SIM-NC-1' }],
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('CreditNoteDetailPage (FS-24)', () => {
  let http: HttpTestingController;

  async function open() {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'invoicing/notes/:id', component: CreditNoteDetailPage },
          { path: 'invoicing/notes', component: StubPage },
          { path: 'invoicing/invoices/:id', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/notes/n1', CreditNoteDetailPage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }

  afterEach(() => http.verify());

  it('shows a skeleton while it loads', async () => {
    const h = await open();
    h.detectChanges();
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(URL).flush(detail());
  });

  it('shows the amount, the adjusted VAT, the original invoice, the linked return, the reason and the SIAT history', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail());
    await settle(h);
    const text = root(h).textContent ?? '';
    expect(text).toContain('Nota de crédito y débito 000045');
    expect(text).toContain('Bs 245,00');
    expect(text).toContain('IVA a ajustar (13 %)');
    expect(text).toContain('Bs 31,85');
    expect(text).toContain('001528 · válida');
    expect(text).toContain('Devolución DEV-000012');
    expect(text).toContain('Producto con falla de fábrica');
    expect(text).toContain('Validada por el SIAT');
    expect(text).toContain('Vinculada a la devolución DEV-000012');
    expect(root(h).querySelector('[data-testid="note-pdf"]')).not.toBeNull();
    expect(root(h).querySelector('[data-testid="note-issue"]')).toBeNull();
  });

  it('a note that never reached the SIAT says why and offers to issue it', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ status: 'PENDING', number: null, cuf: null, issuedAt: null, lastError: 'SIAT_UNAVAILABLE', actions: ['VIEW_DETAIL', 'ISSUE'], history: [] }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="note-pending-note"]')?.textContent).toContain('El SIAT no respondió');
    root(h).querySelector<HTMLButtonElement>('[data-testid="note-issue"]')?.click();
    http.expectOne('/api/v1/invoicing/notes/n1/issue').flush(null, { status: 204, statusText: 'No Content' });
    await settle(h);
    http.expectOne(URL).flush(detail({ status: 'SENDING', actions: ['VIEW_DETAIL'] }));
  });

  it('a note the SIAT never validated can be voided, and the page reloads', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ status: 'REJECTED', actions: ['VIEW_DETAIL', 'ISSUE', 'VOID'], history: [] }));
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('[data-testid="note-void"]')?.click();
    http.expectOne('/api/v1/invoicing/notes/n1/void').flush(null, { status: 204, statusText: 'No Content' });
    await settle(h);
    http.expectOne(URL).flush(detail({ status: 'CANCELLED', actions: ['VIEW_DETAIL'], history: [] }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="note-void"]')).toBeNull();
  });

  it('a rejected note shows the SIN message and code', async () => {
    const h = await open();
    http.expectOne(URL).flush(detail({ status: 'REJECTED', rejectionMessage: 'NIT INVALIDO', rejectionCode: 1037 }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="note-rejected-note"]')?.textContent).toContain('NIT INVALIDO');
    expect(root(h).textContent).toContain('Código 1037');
  });

  it('shows the not-found, no-permission and error states', async () => {
    const h = await open();
    http.expectOne(URL).flush({ code: 'CREDIT_NOTE_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(h);
    expect(root(h).textContent).toContain('La nota no existe');
  });
});
