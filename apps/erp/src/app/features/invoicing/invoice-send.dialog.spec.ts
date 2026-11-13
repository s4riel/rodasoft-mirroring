import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { InvoiceSendDialog } from './invoice-send.dialog';

const URL = '/api/v1/invoicing/invoices/i1/deliveries';

describe('InvoiceSendDialog (FS-16)', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InvoiceSendDialog);
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
  const sendButton = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="invoice-send"]')!;
  const emailBox = (f: Fixture) => el(f).querySelector<HTMLInputElement>('#invoice-send-email')!;
  const phoneBox = (f: Fixture) => el(f).querySelector<HTMLInputElement>('#invoice-send-phone')!;
  const typeIn = (f: Fixture, box: HTMLInputElement, text: string) => {
    box.value = text;
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  const fakeTab = () => ({ opener: 'x' as unknown, close: jest.fn(), location: { href: '' } });

  afterEach(() => http.verify());

  it('shows a correo and a WhatsApp field with their hints, and cannot send with both empty', async () => {
    const f = await render();
    const text = el(f).textContent ?? '';
    expect(text).toContain('Enviar la factura 000012');
    expect(text).toContain('El cliente recibe el PDF con el QR y el XML adjunto. Queda registrado en el historial.');
    expect(text).toContain('Se envía a este correo.');
    expect(text).toContain('Se envía el enlace de descarga.');
    expect(sendButton(f).disabled).toBe(true);
  });

  it('asks for a valid e-mail and enables sending once it is one', async () => {
    const f = await render();
    typeIn(f, emailBox(f), 'no-es-correo');
    emailBox(f).dispatchEvent(new Event('blur'));
    f.detectChanges();
    expect(el(f).textContent).toContain('Escribe un correo válido');
    expect(sendButton(f).disabled).toBe(true);
    typeIn(f, emailBox(f), 'cliente@correo.com');
    expect(sendButton(f).disabled).toBe(false);
  });

  it('asks for a Bolivian mobile in the WhatsApp field', async () => {
    const f = await render();
    typeIn(f, phoneBox(f), '2123456');
    phoneBox(f).dispatchEvent(new Event('blur'));
    f.detectChanges();
    expect(el(f).textContent).toContain('celular boliviano');
    expect(sendButton(f).disabled).toBe(true);
    typeIn(f, phoneBox(f), '71234567');
    expect(sendButton(f).disabled).toBe(false);
  });

  it('sends by e-mail only when only the correo is filled, and closes', async () => {
    const f = await render();
    const open = jest.spyOn(window, 'open');
    const sent: string[] = [];
    f.componentInstance.sent.subscribe((channel) => sent.push(channel));
    typeIn(f, emailBox(f), 'cliente@correo.com');
    sendButton(f).click();
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ channel: 'EMAIL', recipient: 'cliente@correo.com' });
    req.flush({ channel: 'EMAIL', url: null });
    f.detectChanges();
    expect(sent).toEqual(['EMAIL']);
    expect(open).not.toHaveBeenCalled();
    expect(f.componentInstance.open()).toBe(false);
    open.mockRestore();
  });

  it('sends to both channels when both are filled, opening the WhatsApp tab inside the click', async () => {
    const f = await render();
    const tab = fakeTab();
    const open = jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    typeIn(f, emailBox(f), 'cliente@correo.com');
    typeIn(f, phoneBox(f), '71234567');
    sendButton(f).click();
    // the tab is opened now, not after the answer, so a popup blocker lets it through
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(tab.opener).toBeNull();
    const requests = http.match(URL);
    expect(requests.map((r) => r.request.body)).toEqual([
      { channel: 'EMAIL', recipient: 'cliente@correo.com' },
      { channel: 'WHATSAPP', recipient: '71234567' },
    ]);
    requests[0].flush({ channel: 'EMAIL', url: null });
    requests[1].flush({ channel: 'WHATSAPP', url: 'https://wa.me/59171234567?text=hola' });
    f.detectChanges();
    expect(tab.location.href).toBe('https://wa.me/59171234567?text=hola');
    expect(tab.close).not.toHaveBeenCalled();
    expect(f.componentInstance.open()).toBe(false);
    open.mockRestore();
  });

  it('closes the tab it opened for WhatsApp when the send fails', async () => {
    const f = await render();
    const tab = fakeTab();
    const open = jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    typeIn(f, phoneBox(f), '71234567');
    sendButton(f).click();
    http.expectOne(URL).flush({ code: 'INVOICE_NOT_ISSUED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    expect(tab.close).toHaveBeenCalled();
    open.mockRestore();
  });

  it('keeps the dialog open and says what failed, while the channel that went stays sent', async () => {
    const f = await render();
    const sent: string[] = [];
    f.componentInstance.sent.subscribe((channel) => sent.push(channel));
    const tab = fakeTab();
    const open = jest.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    typeIn(f, emailBox(f), 'cliente@correo.com');
    typeIn(f, phoneBox(f), '71234567');
    sendButton(f).click();
    const [mail, whatsapp] = http.match(URL);
    mail.flush({ channel: 'EMAIL', url: null });
    whatsapp.flush({ code: 'INVOICE_NOT_ISSUED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    expect(sent).toEqual(['EMAIL']);
    expect(f.componentInstance.open()).toBe(true);
    expect(el(f).textContent).toContain('No pudimos enviar la factura');
    open.mockRestore();
  });

  it('starts empty every time it opens', async () => {
    const f = await render();
    typeIn(f, emailBox(f), 'cliente@correo.com');
    typeIn(f, phoneBox(f), '71234567');
    f.componentRef.setInput('open', false);
    f.detectChanges();
    f.componentRef.setInput('open', true);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(emailBox(f).value).toBe('');
    expect(phoneBox(f).value).toBe('');
    expect(sendButton(f).disabled).toBe(true);
  });
});
