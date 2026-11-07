import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { SaleCancellationResponse, SaleDetail } from '@rodasoft/domain';
import { SaleCancellationDialog } from './sale-cancellation.dialog';

const URL = '/api/v1/sales/sales/s1/cancellation-request';

const sale = (over: Partial<SaleDetail['cancellation']> = {}): SaleDetail =>
  ({
    id: 's1',
    number: 'V-000124',
    status: 'COMPLETED',
    total: '1280.00',
    invoice: { status: 'VALID', number: 1528 },
    cancellation: {
      canRequest: true,
      windowEndsAt: null,
      pending: null,
      impact: { warehouseName: 'Huayna Kapac', registerName: 'Caja 1' },
      ...over,
    },
  }) as SaleDetail;

describe('SaleCancellationDialog', () => {
  let http: HttpTestingController;

  async function render(detail: SaleDetail = sale()) {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(SaleCancellationDialog);
    fixture.componentRef.setInput('sale', detail);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  type Fixture = Awaited<ReturnType<typeof render>>;
  const el = (f: Fixture) => f.nativeElement as HTMLElement;
  const chips = (f: Fixture) => Array.from(el(f).querySelectorAll<HTMLElement>('rs-filter-chip'));
  const chipButton = (f: Fixture, label: string) =>
    chips(f)
      .find((c) => c.textContent?.includes(label))!
      .querySelector('button')!;
  const send = (f: Fixture) => el(f).querySelector<HTMLButtonElement>('[data-testid="cancellation-send"]')!;
  const type = (f: Fixture, text: string) => {
    const input = el(f).querySelector<HTMLTextAreaElement>('#sale-cancellation-comment')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
  };

  afterEach(() => http.verify());

  it('says what it asks, what stays valid and what an approval undoes', async () => {
    const f = await render();
    const text = el(f).textContent ?? '';
    expect(text).toContain('Solicitar anulación de la venta V-000124');
    expect(text).toContain('Factura 1528 · Bs 1.280,00');
    expect(text).toContain('La factura sigue válida hasta que Gerencia apruebe');
    expect(text).toContain('Al aprobarse se anula la factura en el SIAT');
    expect(text).toContain('El stock vuelve a Huayna Kapac');
    expect(text).toContain('Caja 1');
    expect(text).toContain('Plazo de anulación: sin límite');
  });

  it('shows the last day to ask when there is a window', async () => {
    // closes at the start of 17 Oct in La Paz: the last day is the 16th
    const f = await render(sale({ windowEndsAt: '2026-10-17T04:00:00.000Z' }));
    expect(el(f).textContent).toContain('Plazo de anulación: 16/10/2026');
  });

  it('offers the four reasons', async () => {
    const f = await render();
    expect(chips(f).map((c) => c.textContent?.trim())).toEqual([
      'Error en datos del cliente',
      'Error en productos o precios',
      'Venta no concretada',
      'Otro',
    ]);
  });

  it('cannot be sent without a reason and a comment', async () => {
    const f = await render();
    expect(send(f).disabled).toBe(true);
    chipButton(f, 'Otro').click();
    f.detectChanges();
    expect(send(f).disabled).toBe(true);
    type(f, '   ');
    expect(send(f).disabled).toBe(true);
    type(f, 'Precio mal cargado');
    expect(send(f).disabled).toBe(false);
  });

  it('keeps one reason at a time and lets the chosen one be cleared', async () => {
    const f = await render();
    type(f, 'x');
    chipButton(f, 'Otro').click();
    f.detectChanges();
    chipButton(f, 'Venta no concretada').click();
    f.detectChanges();
    expect(chips(f).filter((c) => c.querySelector('button')?.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
    expect(chipButton(f, 'Venta no concretada').getAttribute('aria-pressed')).toBe('true');
    expect(send(f).disabled).toBe(false);
    chipButton(f, 'Venta no concretada').click();
    f.detectChanges();
    expect(send(f).disabled).toBe(true);
  });

  it('sends the reason and the trimmed comment, closes and says it was requested', async () => {
    const f = await render();
    const requested: SaleCancellationResponse[] = [];
    f.componentInstance.requested.subscribe((r) => requested.push(r));
    chipButton(f, 'Error en datos del cliente').click();
    f.detectChanges();
    type(f, '  Pidió la factura a nombre de la empresa ');
    send(f).click();
    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'CUSTOMER_DATA_ERROR', comment: 'Pidió la factura a nombre de la empresa' });
    req.flush({ saleId: 's1', status: 'CANCELLATION_PENDING' });
    f.detectChanges();
    expect(requested).toEqual([{ saleId: 's1', status: 'CANCELLATION_PENDING' }]);
    expect(f.componentInstance.open()).toBe(false);
  });

  it('shows the API error in Spanish and stays open so nothing is lost', async () => {
    const f = await render();
    chipButton(f, 'Otro').click();
    f.detectChanges();
    type(f, 'Motivo');
    send(f).click();
    http.expectOne(URL).flush({ code: 'CANCELLATION_ALREADY_PENDING', message: 'x' }, { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    expect(el(f).textContent).toContain('Esta venta ya tiene una solicitud de anulación esperando a Gerencia.');
    expect(f.componentInstance.open()).toBe(true);
    expect(send(f).disabled).toBe(false);
  });

  it('starts empty every time it opens', async () => {
    const f = await render();
    chipButton(f, 'Otro').click();
    f.detectChanges();
    type(f, 'algo');
    f.componentInstance.open.set(false);
    f.detectChanges();
    f.componentInstance.open.set(true);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    expect(el(f).querySelector<HTMLTextAreaElement>('#sale-cancellation-comment')!.value).toBe('');
    expect(send(f).disabled).toBe(true);
  });
});
