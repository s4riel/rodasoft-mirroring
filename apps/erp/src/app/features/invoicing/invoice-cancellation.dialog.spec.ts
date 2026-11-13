import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { InvoiceCancellationDialog } from './invoice-cancellation.dialog';

const URL = '/api/v1/invoicing/invoices/i1/cancellation-request';

describe('InvoiceCancellationDialog (FS-09, FS-12)', () => {
  let http: HttpTestingController;

  async function render() {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(InvoiceCancellationDialog);
    fixture.componentRef.setInput('invoiceId', 'i1');
    fixture.componentRef.setInput('invoiceNumber', 12);
    fixture.componentRef.setInput('saleNumber', 'V-000124');
    fixture.componentRef.setInput('total', '1280.00');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const send = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="invoice-cancellation-send"]')!;
  const type = (f: Fixture, text: string) => {
    const box = el(f).querySelector<HTMLTextAreaElement>('#invoice-cancellation-comment')!;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    f.detectChanges();
  };
  /** The reason chips report their change to `choose`, which is what the user's click ends in. */
  const pick = (f: Fixture, reason: string) => {
    (f.componentInstance as unknown as { choose(value: string, selected: boolean): void }).choose(reason, true);
    f.detectChanges();
  };

  afterEach(() => http.verify());

  it('says the sale and total, that the invoice stays valid, and what an approval does in the SIAT, with the four reasons as chips', async () => {
    const f = await render();
    const text = el(f).textContent ?? '';
    expect(text).toContain('Solicitar anulación de la factura 000012');
    expect(text).toContain('Venta V-000124 · Bs 1.280,00');
    expect(text).toContain('La factura sigue válida hasta que Gerencia apruebe');
    expect(text).toContain('Al aprobarse se anula en el SIAT');
    expect(text).toContain('Si el SIAT no responde, la aprobación espera');
    expect(el(f).querySelectorAll('rs-filter-chip')).toHaveLength(4);
    expect(text).toContain('Error en datos del cliente');
    expect(send(f).disabled).toBe(true);
  });

  it('shows which SIN reason the chosen one is registered with', async () => {
    const f = await render();
    pick(f, 'CUSTOMER_DATA_ERROR');
    expect(el(f).textContent).toContain('Se registra con el motivo «Datos de emisión incorrectos» del catálogo del SIN');
  });

  it('needs a reason and a comment before it can send', async () => {
    const f = await render();
    type(f, 'La factura salió con otro cliente');
    expect(send(f).disabled).toBe(true);
    pick(f, 'CUSTOMER_DATA_ERROR');
    expect(send(f).disabled).toBe(false);
    type(f, '   ');
    expect(send(f).disabled).toBe(true);
  });

  it('sends the SIN code and the trimmed comment, then closes', async () => {
    const f = await render();
    const done: number[] = [];
    f.componentInstance.requested.subscribe(() => done.push(1));
    pick(f, 'CUSTOMER_DATA_ERROR');
    type(f, '  La factura salió con otro cliente  ');
    send(f).click();
    const req = http.expectOne(URL);
    expect(req.request.body).toEqual({ reasonCode: 3, comment: 'La factura salió con otro cliente' });
    req.flush({ saleId: 's1', status: 'CANCELLATION_PENDING' });
    expect(done).toEqual([1]);
    expect(f.componentInstance.open()).toBe(false);
  });

  it('keeps the dialog open and says why the API refused', async () => {
    const f = await render();
    pick(f, 'OTHER');
    type(f, 'Factura mal emitida');
    send(f).click();
    http.expectOne(URL).flush({ code: 'CANCELLATION_WINDOW_EXPIRED', message: 'x' }, { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    expect(f.componentInstance.open()).toBe(true);
    expect(el(f).textContent).toContain('No pudimos enviar la solicitud');
  });

  it('starts empty every time it opens', async () => {
    const f = await render();
    pick(f, 'SALE_NOT_COMPLETED');
    type(f, 'algo');
    f.componentRef.setInput('open', false);
    f.detectChanges();
    f.componentRef.setInput('open', true);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(el(f).querySelector<HTMLTextAreaElement>('#invoice-cancellation-comment')?.value).toBe('');
    expect(send(f).disabled).toBe(true);
  });
});
