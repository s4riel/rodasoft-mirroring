import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { QuoteDetail } from '@rodasoft/domain';
import { QuoteSendDialog } from './quote-send.dialog';

const quote = {
  id: 'q1',
  number: 'COT-000001',
  company: 'RODALASER',
  status: 'DRAFT',
  customer: { id: 'c1', name: 'Ana Rojas', documentNumber: '1001' },
  customerEmail: 'ana@demo.test',
  customerPhone: '70000000',
  createdAt: '2026-11-07T15:00:00.000Z',
  validUntil: '2026-11-14',
  subtotal: '200.00',
  discountAmount: '0.00',
  roundingAmount: '0.00',
  total: '200.00',
  lines: [{ id: 'l1', productId: 'p1', sku: 'S1', code: 'ABC-1', name: 'Rodamiento', quantity: 2, unitPrice: '100.00', lineTotal: '200.00', available: 5 }],
  sendLog: [],
} as unknown as QuoteDetail;

@Component({
  imports: [QuoteSendDialog],
  template: `<rs-quote-send-dialog [(open)]="open" [quote]="quote" (sent)="sent = $event" />`,
})
class Host {
  open = signal(true);
  quote = quote;
  sent: QuoteDetail | null = null;
}

describe('QuoteSendDialog', () => {
  let http: HttpTestingController;
  let opened: jest.SpyInstance;
  let popup: { location: { href: string }; close: jest.Mock; opener: unknown };

  function mount() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    popup = { location: { href: '' }, close: jest.fn(), opener: window };
    opened = jest.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return fixture;
  }
  const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
  const chip = (label: string) =>
    Array.from(document.querySelectorAll('rs-filter-chip')).find((c) => c.textContent?.includes(label))?.querySelector('button') as HTMLButtonElement;
  afterEach(() => {
    http.verify();
    jest.restoreAllMocks();
  });

  it('starts on WhatsApp with the customer’s number and the default greeting', () => {
    mount();
    expect((document.querySelector('#quote-send-to') as HTMLInputElement).value).toBe('70000000');
    expect((document.querySelector('#quote-send-message') as HTMLTextAreaElement).value).toContain('COT-000001');
    expect(document.body.textContent).toContain('Vista previa y envío');
    expect(document.body.textContent).toContain('ABC-1 · Rodamiento');
    expect(byTestId('quote-send-confirm').textContent).toContain('Enviar por WhatsApp');
  });

  it('sends by WhatsApp: records it and then opens wa.me with the message', () => {
    const fixture = mount();
    byTestId('quote-send-confirm').click();
    const request = http.expectOne('/api/v1/sales/quotes/q1/send');
    expect(request.request.body).toMatchObject({ channel: 'WHATSAPP', to: '70000000' });
    request.flush({ ...quote, status: 'SENT' });
    fixture.detectChanges();
    expect(opened).toHaveBeenCalledWith('', '_blank');
    expect(popup.location.href).toMatch(/^https:\/\/wa\.me\/59170000000\?text=/);
    expect(popup.opener).toBeNull();
    expect(fixture.componentInstance.sent?.status).toBe('SENT');
    expect(fixture.componentInstance.open()).toBe(false);
  });

  it('switching to e-mail prefills the address and blocks an invalid one', () => {
    const fixture = mount();
    chip('Correo').click();
    fixture.detectChanges();
    const input = document.querySelector('#quote-send-to') as HTMLInputElement;
    expect(input.value).toBe('ana@demo.test');
    input.value = 'nope';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(byTestId('quote-send-confirm').disabled).toBe(true);
  });

  it('the PDF needs no recipient and opens the printable copy', () => {
    const fixture = mount();
    chip('Descargar PDF').click();
    fixture.detectChanges();
    expect(document.querySelector('#quote-send-to')).toBeNull();
    byTestId('quote-send-confirm').click();
    const request = http.expectOne('/api/v1/sales/quotes/q1/send');
    expect(request.request.body.channel).toBe('PDF');
    expect(request.request.body.to).toBeUndefined();
    request.flush({ ...quote, status: 'SENT' });
    expect(popup.location.href).toBe('/sales/quotes/q1/print');
  });

  it('shows the server error and keeps the dialog open', () => {
    const fixture = mount();
    byTestId('quote-send-confirm').click();
    http.expectOne('/api/v1/sales/quotes/q1/send').flush({ code: 'QUOTE_EXPIRED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(document.body.textContent).toContain('No pudimos enviar la cotización');
    expect(fixture.componentInstance.open()).toBe(true);
    expect(popup.close).toHaveBeenCalled();
    expect(popup.location.href).toBe('');
  });
});
