import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import * as fileDownload from './file-download';
import { InvoicePreviewDialog } from './invoice-preview.dialog';

const PDF_URL = '/api/v1/invoicing/invoices/i1/pdf';

describe('InvoicePreviewDialog (FS-15)', () => {
  let http: HttpTestingController;
  const created: string[] = [];
  const revoked: string[] = [];

  beforeEach(() => {
    created.length = 0;
    revoked.length = 0;
    URL_STUB.createObjectURL = jest.fn(() => {
      const url = `blob:test/${created.length}`;
      created.push(url);
      return url;
    });
    URL_STUB.revokeObjectURL = jest.fn((url: string) => void revoked.push(url));
  });

  async function render() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InvoicePreviewDialog);
    fixture.componentRef.setInput('invoiceId', 'i1');
    fixture.componentRef.setInput('invoiceNumber', 12);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;

  afterEach(() => http.verify());

  it('shows a skeleton while the PDF loads, then the PDF in a frame', async () => {
    const f = await render();
    expect(el(f).querySelector('[aria-busy="true"]')).not.toBeNull();
    http.expectOne(PDF_URL).flush(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    f.detectChanges();
    expect(el(f).querySelector('iframe.pdf')).not.toBeNull();
    expect(el(f).textContent).toContain('Factura 000012 · vista previa');
  });

  it('downloads the same PDF it shows', async () => {
    const f = await render();
    const save = jest.spyOn(fileDownload, 'saveBlob').mockImplementation(() => undefined);
    const blob = new Blob(['%PDF-1.4'], { type: 'application/pdf' });
    http.expectOne(PDF_URL).flush(blob);
    f.detectChanges();
    el(f).querySelector<HTMLButtonElement>('[data-testid="preview-download"]')?.click();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][1]).toBe('factura-000012.pdf');
    save.mockRestore();
  });

  it('prints the PDF it shows with the browser print dialog', async () => {
    const f = await render();
    http.expectOne(PDF_URL).flush(new Blob(['%PDF-1.4']));
    f.detectChanges();
    const frame = el(f).querySelector<HTMLIFrameElement>('iframe.pdf');
    const print = jest.fn();
    Object.defineProperty(frame, 'contentWindow', { value: { print } });
    el(f).querySelector<HTMLButtonElement>('[data-testid="preview-print"]')?.click();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('frees the PDF from memory when it closes', async () => {
    const f = await render();
    http.expectOne(PDF_URL).flush(new Blob(['%PDF-1.4']));
    f.detectChanges();
    f.componentRef.setInput('open', false);
    f.detectChanges();
    expect(revoked).toEqual(created);
  });

  it('says it could not load the invoice and keeps the buttons off', async () => {
    const f = await render();
    http.expectOne(PDF_URL).flush(new Blob(['x']), { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    expect(el(f).textContent).toContain('No pudimos cargar la factura');
    expect(el(f).querySelector<HTMLButtonElement>('[data-testid="preview-download"]')?.disabled).toBe(true);
  });
});

/** jsdom has no object URLs; the dialog needs them for the frame. */
const URL_STUB = globalThis.URL as unknown as { createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void };
