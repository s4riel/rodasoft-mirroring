import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NitExceptionDialog } from './nit-exception.dialog';

const URL = '/api/v1/invoicing/invoices/i1/nit-exception';

describe('NitExceptionDialog (FS-22)', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(NitExceptionDialog);
    fixture.componentRef.setInput('invoiceId', 'i1');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const send = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="nit-exception-send"]')!;
  const type = (f: Fixture, text: string) => {
    const box = el(f).querySelector<HTMLTextAreaElement>('#nit-exception-reason')!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  afterEach(() => http.verify());

  it('explains that Management decides, saves the reason with user and date, and cannot send without a reason', async () => {
    const f = await render();
    expect(el(f).textContent).toContain('Emitir con excepción de NIT');
    expect(el(f).textContent).toContain('Requiere aprobación de Gerencia y queda en auditoría');
    expect(el(f).textContent).toContain('Se guarda con el usuario y la fecha.');
    expect(send(f).disabled).toBe(true);
  });

  it('asks for a fuller reason when it is too short', async () => {
    const f = await render();
    type(f, 'corto');
    el(f).querySelector('#nit-exception-reason')?.dispatchEvent(new Event('blur'));
    f.detectChanges();
    expect(el(f).textContent).toContain('un poco más completo');
    expect(send(f).disabled).toBe(true);
  });

  it('sends the reason trimmed and closes', async () => {
    const f = await render();
    const done: number[] = [];
    f.componentInstance.requested.subscribe(() => done.push(1));
    type(f, '  El cliente no recuerda su NIT y necesita la factura hoy  ');
    send(f).click();
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ reason: 'El cliente no recuerda su NIT y necesita la factura hoy' });
    req.flush(null);
    expect(done).toEqual([1]);
    expect(f.componentInstance.open()).toBe(false);
  });

  it('keeps the dialog open and says why the API refused', async () => {
    const f = await render();
    type(f, 'El cliente no recuerda su NIT y necesita la factura hoy');
    send(f).click();
    http.expectOne(URL).flush({ code: 'INVOICE_NOT_ISSUABLE', message: 'x' }, { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    expect(el(f).textContent).toContain('No pudimos enviar la solicitud');
    expect(el(f).textContent).toContain('no se puede emitir en su estado actual');
  });
});
