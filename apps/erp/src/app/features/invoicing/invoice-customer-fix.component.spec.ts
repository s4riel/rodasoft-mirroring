import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { InvoiceDetail } from '@rodasoft/domain';
import { RS_PERMISSIONS } from '@rodasoft/ui';
import { InvoiceCustomerFixComponent } from './invoice-customer-fix.component';

const BASE = '/api/v1/invoicing/invoices/i1';

const invoice = (over: Partial<InvoiceDetail> = {}): InvoiceDetail =>
  ({
    id: 'i1',
    status: 'REJECTED',
    customerName: 'Cliente de prueba',
    customerDocumentType: 5,
    customerDocumentNumber: '9991234',
    customerComplement: null,
    nitVerifiedAt: null,
    nitException: false,
    pendingNitException: false,
    ...over,
  }) as InvoiceDetail;

describe('InvoiceCustomerFixComponent (FS-04, FS-20, FS-21)', () => {
  let http: HttpTestingController;

  async function render(data: InvoiceDetail = invoice(), granted: string[] = ['invoicing.invoices.issue']) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: RS_PERMISSIONS, useValue: signal(new Set(granted)) }],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InvoiceCustomerFixComponent);
    fixture.componentRef.setInput('invoice', data);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const btn = (f: Fixture, id: string) => el(f).querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
  const type = (f: Fixture, id: string, value: string) => {
    const input = el(f).querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  afterEach(() => http.verify());

  it('starts from what the invoice holds and cannot send an unverified NIT', async () => {
    const f = await render();
    expect(el(f).querySelector<HTMLInputElement>('#fix-name')?.value).toBe('Cliente de prueba');
    expect(el(f).querySelector<HTMLInputElement>('#fix-number')?.value).toBe('9991234');
    expect(btn(f, 'fix-resend')?.disabled).toBe(true);
    expect(el(f).textContent).toContain('verifica el NIT con el SIN o pide una excepción a Gerencia');
    expect(btn(f, 'fix-save')?.disabled).toBe(true);
  });

  it('verifies the NIT: an unknown one shows the SIN message and keeps resending off', async () => {
    const f = await render();
    btn(f, 'fix-verify')?.click();
    const req = http.expectOne(`${BASE}/verify-nit`);
    req.flush({ valid: false, messages: [{ code: 1037, description: 'NIT INVALIDO' }] });
    await f.whenStable();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="fix-verification"]')?.textContent).toContain('NIT INVALIDO');
    expect(btn(f, 'fix-resend')?.disabled).toBe(true);
  });

  it('saves the corrected customer, then reloads through the changed output', async () => {
    const f = await render();
    const changes: number[] = [];
    f.componentInstance.changed.subscribe(() => changes.push(1));
    type(f, 'fix-name', 'Cliente corregido');
    type(f, 'fix-number', '1234567');
    expect(btn(f, 'fix-save')?.disabled).toBe(false);
    // verification and sending wait until the change is saved
    expect(btn(f, 'fix-verify')?.disabled).toBe(true);
    btn(f, 'fix-save')?.click();
    const req = http.expectOne(`${BASE}/customer`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'Cliente corregido', documentType: 5, documentNumber: '1234567', complement: undefined });
    req.flush(null);
    await f.whenStable();
    expect(changes).toEqual([1]);
  });

  it('refuses to save an invalid document and says so', async () => {
    const f = await render();
    type(f, 'fix-number', 'abc');
    el(f).querySelector<HTMLInputElement>('#fix-number')?.dispatchEvent(new Event('blur'));
    f.detectChanges();
    expect(el(f).textContent).toContain('Escribe un documento válido');
    expect(btn(f, 'fix-save')?.disabled).toBe(true);
  });

  it('sends again once the NIT is verified', async () => {
    const f = await render(invoice({ nitVerifiedAt: '2026-11-12T15:00:00.000Z' }));
    expect(el(f).querySelector('[data-testid="fix-verified"]')).not.toBeNull();
    expect(btn(f, 'fix-resend')?.disabled).toBe(false);
    btn(f, 'fix-resend')?.click();
    const req = http.expectOne(`${BASE}/resend`);
    expect(req.request.method).toBe('POST');
    req.flush(null);
    await f.whenStable();
  });

  it('a CI needs no verification: it can be sent and has no verify button', async () => {
    const f = await render(invoice({ customerDocumentType: 1, customerDocumentNumber: '5432109' }));
    expect(btn(f, 'fix-verify')).toBeNull();
    expect(btn(f, 'fix-resend')?.disabled).toBe(false);
  });

  it('with an approved exception it can be sent without verifying', async () => {
    const f = await render(invoice({ nitException: true }));
    expect(el(f).querySelector('[data-testid="fix-exception-approved"]')).not.toBeNull();
    expect(btn(f, 'fix-resend')?.disabled).toBe(false);
    expect(btn(f, 'fix-exception')).toBeNull();
  });

  it('with an exception waiting it says so and does not ask again or send', async () => {
    const f = await render(invoice({ pendingNitException: true }));
    expect(el(f).querySelector('[data-testid="fix-exception-pending"]')).not.toBeNull();
    expect(btn(f, 'fix-exception')).toBeNull();
    expect(btn(f, 'fix-resend')?.disabled).toBe(true);
  });

  it('offers the exception for a rejected NIT and shows what the API refuses', async () => {
    const f = await render(invoice({ nitVerifiedAt: '2026-11-12T15:00:00.000Z' }));
    expect(btn(f, 'fix-exception')).not.toBeNull();
    btn(f, 'fix-resend')?.click();
    http.expectOne(`${BASE}/resend`).flush({ code: 'INVOICE_ALREADY_SENDING', message: 'x' }, { status: 409, statusText: 'Conflict' });
    await f.whenStable();
    f.detectChanges();
    expect(el(f).querySelector('[data-testid="fix-error"]')?.textContent).toContain('se está enviando al SIAT');
  });

  it('shows no actions to who cannot issue', async () => {
    const f = await render(invoice(), ['invoicing.invoices.view']);
    expect(btn(f, 'fix-resend')).toBeNull();
    expect(btn(f, 'fix-save')).toBeNull();
  });
});
