import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { InvoiceListItem, InvoiceListResponse } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import * as fileDownload from './file-download';
import { InvoicesPage } from './invoices.page';

const LIST_URL = '/api/v1/invoicing/invoices';

const item = (over: Partial<InvoiceListItem> = {}): InvoiceListItem => ({
  id: 'i1',
  number: 12,
  status: 'VALID',
  saleId: 's1',
  saleNumber: 'V-000124',
  customerName: 'Industrias Demo S.A.',
  customerDocumentNumber: '1234567',
  total: '1280.00',
  issuedAt: '2026-11-12T14:24:00.000Z',
  createdAt: '2026-11-12T14:20:00.000Z',
  branchId: 'b1',
  rejectionMessage: null,
  actions: ['VIEW_DETAIL'],
  ...over,
});

const response = (items: InvoiceListItem[], over: Partial<InvoiceListResponse> = {}): InvoiceListResponse => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 10,
  totalAmount: items.reduce((sum, i) => sum + Number(i.total), 0).toFixed(2),
  kpis: { issuedToday: { count: 1, total: '1280.00' }, notIssued: 0, rejected: 0, cancellationsPending: 0 },
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('InvoicesPage', () => {
  let http: HttpTestingController;

  async function open(url = '/invoicing', granted: string[] = ['invoicing.invoices.view', 'invoicing.invoices.issue']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'invoicing', component: InvoicesPage },
          { path: 'invoicing/invoices/:id', component: StubPage },
          { path: 'sales/history/:id', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(granted)) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url, InvoicesPage);
    return harness;
  }

  const flushList = (body: InvoiceListResponse) => http.expectOne((r) => r.url === LIST_URL).flush(body);
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
    expect(root(h).querySelector('[aria-busy="true"]')).not.toBeNull();
    flushList(response([item()]));
  });

  it('shows the four day indicators', async () => {
    const h = await open();
    flushList(response([item()], { kpis: { issuedToday: { count: 3, total: '900.00' }, notIssued: 2, rejected: 1, cancellationsPending: 4 } }));
    await settle(h);
    const kpis = root(h).querySelectorAll('rs-kpi-card');
    expect(kpis).toHaveLength(4);
    const kpiText = root(h).querySelector('[data-testid="invoice-kpis"]')?.textContent ?? '';
    expect(kpiText).toContain('Emitidas hoy');
    expect(kpiText).toContain('No facturadas en SIAT');
    expect(kpiText).toContain('2 por emitir');
    expect(kpiText).toContain('Rechazadas por el SIAT');
    expect(kpiText).toContain('Anulaciones por aprobar');
  });

  it('lists number, customer, sale, date, total and status, with a total row', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 'i2', number: null, status: 'PENDING', saleNumber: 'V-000125', total: '640.00', issuedAt: null })]));
    await settle(h);
    expect(text(h)).toContain('000012');
    expect(text(h)).toContain('Industrias Demo S.A.');
    expect(text(h)).toContain('V-000124');
    expect(text(h)).toContain('12/11/2026 10:24');
    expect(text(h)).toContain('Bs 1.280,00');
    expect(text(h)).toContain('Válida');
    expect(text(h)).toContain('No facturada en SIAT');
    expect(text(h)).toContain('2 facturas');
    expect(text(h)).toContain('Bs 1.920,00');
    expect(text(h)).toContain('1–2 de 2 facturas');
  });

  it('links each number to the detail of its invoice', async () => {
    const h = await open();
    flushList(response([item(), item({ id: 'i2', number: 13 })]));
    await settle(h);
    const links = Array.from(root(h).querySelectorAll<HTMLAnchorElement>('a.number')).map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/invoicing/invoices/i1', '/invoicing/invoices/i2']);
  });

  it('warns about invoices not issued and offers to issue the ones of the page to who may', async () => {
    const h = await open();
    flushList(response([item({ id: 'i2', status: 'PENDING', number: null, actions: ['VIEW_DETAIL', 'ISSUE'] })], { kpis: { issuedToday: { count: 0, total: '0.00' }, notIssued: 1, rejected: 0, cancellationsPending: 0 } }));
    await settle(h);
    const note = root(h).querySelector('[data-testid="invoice-not-issued-note"]');
    expect(note?.textContent).toContain('No se reintentan solas');
    expect(note?.textContent).toContain('Emitir pendientes de esta página');
  });

  it('does not offer to issue to who may only view', async () => {
    const h = await open('/invoicing', ['invoicing.invoices.view']);
    flushList(response([item({ id: 'i2', status: 'PENDING', number: null })], { kpis: { issuedToday: { count: 0, total: '0.00' }, notIssued: 1, rejected: 0, cancellationsPending: 0 } }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="invoice-not-issued-note"]')?.textContent).not.toContain('Emitir pendientes');
  });

  it('issues the pending invoices of the page and reloads the list', async () => {
    const h = await open();
    flushList(response([item({ id: 'i2', status: 'PENDING', number: null, actions: ['VIEW_DETAIL', 'ISSUE'] })], { kpis: { issuedToday: { count: 0, total: '0.00' }, notIssued: 1, rejected: 0, cancellationsPending: 0 } }));
    await settle(h);
    const button = Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Emitir pendientes'));
    button?.click();
    const issue = http.expectOne('/api/v1/invoicing/invoices/issue');
    expect(issue.request.body).toEqual({ ids: ['i2'] });
    issue.flush({ results: [{ id: 'i2', ok: true }] });
    await settle(h);
    flushList(response([item({ id: 'i2', status: 'SENDING', number: null })]));
  });

  it('the row menu follows the actions of the API', async () => {
    const h = await open();
    flushList(response([item({ actions: ['VIEW_DETAIL', 'ISSUE_CREDIT_NOTE', 'REQUEST_CANCELLATION'] })]));
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('button[aria-label="Acciones de la factura 12"]')?.click();
    h.detectChanges();
    const menu = root(h).querySelector('rs-row-menu')?.textContent ?? '';
    expect(menu).toContain('Ver detalle');
    expect(menu).toContain('Emitir nota de crédito');
    expect(menu).toContain('Solicitar anulación');
    expect(menu).not.toContain('Emitir en el SIAT');
  });

  it('shows the first-use empty state when there are no invoices and no filters', async () => {
    const h = await open();
    flushList(response([], { kpis: { issuedToday: { count: 0, total: '0.00' }, notIssued: 0, rejected: 0, cancellationsPending: 0 } }));
    await settle(h);
    expect(text(h)).toContain('Aún no hay facturas');
  });

  it('shows "no results" with a way to clear the filters', async () => {
    const h = await open('/invoicing?status=REJECTED');
    flushList(response([]));
    await settle(h);
    expect(text(h)).toContain('No encontramos facturas');
    expect(text(h)).toContain('Limpiar filtros');
  });

  it('sends the filters of the URL to the API', async () => {
    const h = await open('/invoicing?status=REJECTED&q=Demo&page=2');
    const req = http.expectOne((r) => r.url === LIST_URL);
    expect(req.request.params.get('status')).toBe('REJECTED');
    expect(req.request.params.get('q')).toBe('Demo');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('pageSize')).toBe('10');
    req.flush(response([]));
    await settle(h);
  });

  it('shows the error state with a retry', async () => {
    const h = await open();
    http.expectOne((r) => r.url === LIST_URL).flush({ code: 'INTERNAL', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(root(h).querySelector('[role="alert"]')).not.toBeNull();
    expect(text(h)).toContain('No pudimos cargar las facturas');
    const retry = Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Reintentar'));
    retry?.click();
    flushList(response([item()]));
  });

  it('shows the no-permission state on a 403', async () => {
    const h = await open();
    http.expectOne((r) => r.url === LIST_URL).flush({ code: 'NO_PERMISSION', message: 'no' }, { status: 403, statusText: 'Forbidden' });
    await settle(h);
    expect(text(h)).toContain('No tienes permiso para ver las facturas');
  });

  describe('selection (FS-14)', () => {
    const tick = (h: RouterTestingHarness, index: number) => {
      const boxes = root(h).querySelectorAll<HTMLInputElement>('rs-doc-table tbody input[type="checkbox"]');
      boxes[index].click();
      h.detectChanges();
    };
    const bar = (h: RouterTestingHarness) => root(h).querySelector('[data-testid="invoice-bulk-bar"]');
    const button = (h: RouterTestingHarness, label: string) =>
      Array.from(root(h).querySelectorAll<HTMLButtonElement>('[data-testid="invoice-bulk-bar"] button')).find((b) => b.textContent?.includes(label));

    it('shows the bulk bar with the count once rows are ticked, and hides it after "Limpiar selección"', async () => {
      const h = await open();
      flushList(response([item(), item({ id: 'i2', number: 13 })]));
      await settle(h);
      expect(bar(h)).toBeNull();
      tick(h, 0);
      tick(h, 1);
      expect(bar(h)?.textContent).toContain('2 facturas seleccionadas · Bs');
      button(h, 'Limpiar selección')?.click();
      h.detectChanges();
      expect(bar(h)).toBeNull();
    });

    it('downloads a ZIP of the selected invoices and says how many were left out', async () => {
      const h = await open();
      flushList(response([item(), item({ id: 'i2', number: 13 })]));
      await settle(h);
      tick(h, 0);
      tick(h, 1);
      const save = jest.spyOn(fileDownload, 'saveBlob').mockImplementation(() => undefined);
      button(h, 'Descargar PDF')?.click();
      const req = http.expectOne('/api/v1/invoicing/invoices/download');
      expect(req.request.body).toEqual({ ids: ['i1', 'i2'], format: 'PDF' });
      req.flush(new Blob(['zip']), { headers: { 'X-Invoices-Included': 'i1', 'X-Invoices-Skipped': 'i2' } });
      await settle(h);
      expect(save).toHaveBeenCalledTimes(1);
      expect(save.mock.calls[0][1]).toBe('facturas-pdf.zip');
      save.mockRestore();
    });

    it('e-mails the selected invoices and reports the ones without e-mail', async () => {
      const h = await open();
      flushList(response([item(), item({ id: 'i2', number: 13 })]));
      await settle(h);
      tick(h, 0);
      tick(h, 1);
      button(h, 'Enviar al cliente')?.click();
      const req = http.expectOne('/api/v1/invoicing/invoices/deliveries');
      expect(req.request.body).toEqual({ ids: ['i1', 'i2'] });
      req.flush({ results: [{ id: 'i1', ok: true }, { id: 'i2', ok: false, code: 'CUSTOMER_WITHOUT_EMAIL' }] });
      await settle(h);
      expect(text(h)).toContain('1 factura enviada · 1 sin correo del cliente');
    });
  });
});
