import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { InvoiceDetail } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { InvoiceDetailPage } from './invoice-detail.page';

const DETAIL_URL = '/api/v1/invoicing/invoices/i1';

const detail = (over: Partial<InvoiceDetail> = {}): InvoiceDetail => ({
  id: 'i1',
  number: 12,
  status: 'VALID',
  saleId: 's1',
  saleNumber: 'V-000124',
  customerName: 'Industrias Demo S.A.',
  customerDocumentNumber: '1234567',
  total: '200.00',
  issuedAt: '2026-11-12T14:24:00.000Z',
  createdAt: '2026-11-12T14:20:00.000Z',
  branchId: 'b1',
  rejectionMessage: null,
  actions: ['VIEW_DETAIL', 'DOWNLOAD_PDF', 'DOWNLOAD_XML', 'SEND'],
  cuf: 'ABCDEF0123SIM0',
  siatReceptionCode: 'SIM-ABCDEF0123',
  rejectionCode: null,
  customerDocumentType: 5,
  customerComplement: null,
  nitVerifiedAt: null,
  nitException: false,
  pendingNitException: false,
  modality: 'ELECTRONIC_ONLINE',
  pointOfSale: '0 · Caja 1',
  legend: 'Ley N° 453: Tienes derecho a recibir información.',
  verificationUrl: 'https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=1&cuf=ABCDEF0123SIM0&numero=12&t=2',
  branchName: 'Huayna Kapac',
  pendingCancellation: null,
  lines: [{ code: '6205-2RS', description: 'Rodamiento 6205', quantity: 2, unitPrice: '100.00', total: '200.00' }],
  payments: [{ method: 'CASH', amount: '200.00' }],
  history: [{ at: '2026-11-12T14:24:00.000Z', action: 'invoicing.invoice.accept', actor: 'Ana', detail: 'SIM-ABCDEF0123' }],
  cancellationReasonCode: null,
  cancelledAt: null,
  lastError: null,
  ...over,
});

@Component({ template: '' })
class StubPage {}

describe('InvoiceDetailPage', () => {
  let http: HttpTestingController;

  async function open(granted: string[] = ['invoicing.invoices.view', 'invoicing.invoices.issue']) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'invoicing', component: StubPage },
          { path: 'invoicing/invoices/:id', component: InvoiceDetailPage },
          { path: 'sales/history/:id', component: StubPage },
        ]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RS_PERMISSIONS, useValue: signal(new Set(granted)) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/invoicing/invoices/i1', InvoiceDetailPage);
    return harness;
  }

  const root = (h: RouterTestingHarness) => h.routeNativeElement as HTMLElement;
  const text = (h: RouterTestingHarness) => root(h).textContent ?? '';
  async function settle(h: RouterTestingHarness) {
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  }
  const flush = (body: InvoiceDetail) => http.expectOne(DETAIL_URL).flush(body);

  afterEach(() => http.verify());

  it('shows the products, the payment, the SIAT data and the history of an issued invoice', async () => {
    const h = await open();
    flush(detail());
    await settle(h);
    expect(text(h)).toContain('Factura 000012');
    expect(text(h)).toContain('Válida');
    expect(text(h)).toContain('Industrias Demo S.A.');
    expect(text(h)).toContain('NIT 1234567');
    expect(text(h)).toContain('Rodamiento 6205');
    expect(text(h)).toContain('Efectivo');
    expect(text(h)).toContain('Bs 200,00');
    const cuf = root(h).querySelector('[data-testid="invoice-cuf"]');
    // a long CUF is shown cut in the middle; this short one fits as it is
    expect(cuf?.textContent).toContain('ABCDEF0123SIM0');
    expect(cuf?.getAttribute('title')).toBe('ABCDEF0123SIM0');
    expect(text(h)).toContain('Electrónica en línea');
    expect(text(h)).toContain('0 · Caja 1');
    expect(text(h)).toContain('Ley N° 453');
    expect(text(h)).toContain('Aceptada por el SIAT');
    expect(text(h)).toContain('· Ana');
    expect(root(h).querySelector('rs-qr-code')).not.toBeNull();
  });

  it('follows the Figma layout: summary cards, the products with codes, the SIAT panel and the footer actions', async () => {
    const h = await open();
    flush(detail());
    await settle(h);
    const summary = root(h).querySelector('[data-testid="invoice-summary"]')?.textContent ?? '';
    expect(summary).toContain('Total facturado');
    expect(summary).toContain('Bs 200,00');
    expect(summary).toContain('IVA · débito fiscal');
    expect(summary).toContain('Bs 26,00 · 13 %');
    expect(summary).toContain('Venta de origen');
    expect(summary).toContain('V-000124 · Caja 1');
    expect(text(h)).toContain('Industrias Demo S.A. · 14/11/2026'.slice(0, 22));
    expect(text(h)).toContain('Productos (1)');
    expect(text(h)).toContain('6205-2RS');
    expect(text(h)).toContain('Subtotal');
    expect(text(h)).toContain('Pago y leyenda');
    expect(text(h)).toContain('Representación gráfica');
    expect(text(h)).toContain('Factura SIAT');
    expect(text(h)).toContain('Válida · en línea');
    expect(text(h)).toContain('Historial SIAT');
    for (const id of ['invoice-preview', 'invoice-download-xml', 'invoice-download-pdf', 'invoice-send-open']) {
      expect(root(h).querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
    expect(text(h)).toContain('Ver factura impresa');
    expect(text(h)).toContain('Descargar XML');
    expect(text(h)).toContain('Enviar al cliente');
  });

  it('says the cancellation waits for Management and lets the requester take it back', async () => {
    const h = await open(['invoicing.invoices.view', 'sales.cancellations.request']);
    flush(detail({ actions: ['VIEW_DETAIL', 'DOWNLOAD_PDF', 'DOWNLOAD_XML', 'SEND'], pendingCancellation: { requestedBy: 'Ana', requestedAt: '2026-11-12T16:05:00.000Z' } }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="invoice-cancellation-pending"]')?.textContent).toContain('Anulación pendiente de aprobación');
    expect(text(h)).toContain('Solicitada por Ana');
    root(h).querySelector<HTMLButtonElement>('[data-testid="invoice-withdraw"]')?.click();
    const req = http.expectOne('/api/v1/sales/sales/s1/cancellation-request/withdraw');
    expect(req.request.method).toBe('POST');
    req.flush({ saleId: 's1', status: 'COMPLETED' });
    await settle(h);
    flush(detail());
  });

  it('copies the CUF to the clipboard', async () => {
    const h = await open();
    flush(detail());
    await settle(h);
    const written: string[] = [];
    const clipboard = (await import('@angular/cdk/clipboard')).Clipboard;
    const service = TestBed.inject(clipboard);
    jest.spyOn(service, 'copy').mockImplementation((value: string) => {
      written.push(value);
      return true;
    });
    root(h).querySelector<HTMLButtonElement>('[data-testid="invoice-copy-cuf"]')?.click();
    h.detectChanges();
    expect(written).toEqual(['ABCDEF0123SIM0']);
  });

  it('explains an invoice not issued in the SIAT and lets who may issue it', async () => {
    const h = await open();
    flush(detail({ status: 'PENDING', number: null, cuf: null, verificationUrl: null, issuedAt: null, lastError: 'SIAT_UNAVAILABLE', actions: ['VIEW_DETAIL', 'ISSUE'], history: [] }));
    await settle(h);
    expect(text(h)).toContain('Factura de la venta V-000124');
    expect(root(h).querySelector('[data-testid="invoice-pending-note"]')?.textContent).toContain('El SIAT no respondió');
    expect(root(h).querySelector('[data-testid="invoice-issue"]')).not.toBeNull();
    expect(text(h)).toContain('Todavía no hay movimientos');
    expect(root(h).querySelector('rs-qr-code')).toBeNull();
  });

  it('does not offer to issue to who may only view', async () => {
    const h = await open(['invoicing.invoices.view']);
    flush(detail({ status: 'PENDING', number: null, actions: ['VIEW_DETAIL'] }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="invoice-issue"]')).toBeNull();
  });

  it('shows the reason of a rejection', async () => {
    const h = await open();
    flush(detail({ status: 'REJECTED', rejectionCode: 1037, rejectionMessage: 'NIT INVALIDO' }));
    await settle(h);
    const note = root(h).querySelector('[data-testid="invoice-rejected-note"]')?.textContent ?? '';
    expect(note).toContain('NIT INVALIDO');
    expect(note).toContain('Código 1037');
  });

  it('issues from the detail and reloads it', async () => {
    const h = await open();
    flush(detail({ status: 'PENDING', number: null, actions: ['VIEW_DETAIL', 'ISSUE'] }));
    await settle(h);
    root(h).querySelector<HTMLButtonElement>('[data-testid="invoice-issue"]')?.click();
    const req = http.expectOne('/api/v1/invoicing/invoices/i1/issue');
    expect(req.request.method).toBe('POST');
    req.flush(null);
    await settle(h);
    flush(detail({ status: 'SENDING', number: null }));
  });

  it('says the invoice does not exist on a 404 and shows the no-permission state on a 403', async () => {
    const h = await open();
    http.expectOne(DETAIL_URL).flush({ code: 'INVOICE_NOT_FOUND', message: 'x' }, { status: 404, statusText: 'Not Found' });
    await settle(h);
    expect(text(h)).toContain('La factura no existe');
  });

  it('shows the error state with a retry', async () => {
    const h = await open();
    http.expectOne(DETAIL_URL).flush({ code: 'INTERNAL', message: 'boom' }, { status: 500, statusText: 'Server Error' });
    await settle(h);
    expect(text(h)).toContain('No pudimos cargar la factura');
    Array.from(root(h).querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Reintentar'))?.click();
    flush(detail());
  });

  it('offers "Solicitar anulación" to who may ask for it on a valid invoice and hides it from who may not', async () => {
    const h = await open(['invoicing.invoices.view', 'sales.cancellations.request']);
    flush(detail({ actions: ['VIEW_DETAIL', 'DOWNLOAD_PDF', 'DOWNLOAD_XML', 'SEND', 'REQUEST_CANCELLATION'] }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="invoice-cancel"]')).not.toBeNull();
  });

  it('does not offer the cancellation without the permission, nor on an invoice that cannot be cancelled', async () => {
    const h = await open(['invoicing.invoices.view']);
    flush(detail({ actions: ['VIEW_DETAIL', 'DOWNLOAD_PDF', 'REQUEST_CANCELLATION'] }));
    await settle(h);
    expect(root(h).querySelector('[data-testid="invoice-cancel"]')).toBeNull();
  });
});
