import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { CashMovementDetail, CashShiftDetail, ManualCashMovementType } from '@rodasoft/domain';
import { ContextStore } from '../../../core/context.store';
import { CashMovementDialog } from './cash-movement.dialog';
import { movementDetail, shiftDetail } from './cash.testing';

const URL = '/api/v1/sales/cash-shifts/s1/movements';

@Component({
  imports: [CashMovementDialog],
  template: `<rs-cash-movement-dialog [(open)]="open" [shift]="shift()" [initialType]="type()" (registered)="registered.set($event)" />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly shift = signal<CashShiftDetail | null>(shiftDetail());
  readonly type = signal<ManualCashMovementType>('EXPENSE');
  readonly registered = signal<CashMovementDetail | null>(null);
}

/** VP-22b · Registrar movimiento de efectivo (HU-VEN-22). */
describe('CashMovementDialog', () => {
  let http: HttpTestingController;

  async function setup(opts: { limit?: string | null; canApprove?: boolean; type?: ManualCashMovementType } = {}) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ContextStore, useValue: { can: (p: string) => !!opts.canApprove && p === 'sales.cash-expenses.approve' } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.shift.set(shiftDetail({ expenseApprovalLimit: opts.limit ?? null }));
    fixture.componentInstance.type.set(opts.type ?? 'EXPENSE');
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement, host: fixture.componentInstance, dialog: dialogOf(fixture) };
  }

  function dialogOf(fixture: ComponentFixture<HostComponent>) {
    return fixture.debugElement.query(By.directive(CashMovementDialog)).componentInstance as {
      concept: { set(v: string | null): void };
      amount: { set(v: string): void };
      detail: { set(v: string): void };
    };
  }

  async function type(fixture: ComponentFixture<HostComponent>, selector: string, value: string) {
    const input = (fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture.whenStable();
  }

  const submit = (el: HTMLElement) => (el.querySelector('[data-testid="cash-movement-submit"]') as HTMLButtonElement).click();
  const text = (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ') ?? '';

  afterEach(() => http.verify());

  it('shows the expected cash of the shift and preselects the type of the button', async () => {
    const { el } = await setup({ type: 'INCOME' });
    expect(text(el)).toContain('Registrar movimiento de efectivo');
    expect(el.querySelector('[data-testid="cash-movement-subtitle"]')?.textContent).toContain('Efectivo esperado en caja: Bs 970,00');
    const chips = Array.from(el.querySelectorAll('rs-filter-chip button')).map((b) => [b.textContent?.trim(), b.getAttribute('aria-pressed')]);
    expect(chips).toEqual([
      ['Ingreso', 'true'],
      ['Egreso', 'false'],
    ]);
    expect(el.querySelector('[data-testid="cash-movement-submit"]')?.textContent?.trim()).toBe('Registrar ingreso');
  });

  it('changes the submit label and the concepts when the type changes, and keeps one chip selected', async () => {
    const { fixture, el } = await setup({ type: 'EXPENSE' });
    expect(el.querySelector('[data-testid="cash-movement-submit"]')?.textContent?.trim()).toBe('Registrar egreso');
    const buttons = el.querySelectorAll('rs-filter-chip button');
    (buttons[0] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="cash-movement-submit"]')?.textContent?.trim()).toBe('Registrar ingreso');
    // clicking the selected chip again does not unselect it
    (buttons[0] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('does not call the API and explains what is missing', async () => {
    const { fixture, el } = await setup();
    submit(el);
    await fixture.whenStable();
    expect(text(el)).toContain('Ingresa un monto mayor que cero');
    expect(text(el)).toContain('Elige un concepto.');
    http.expectNone(URL);
  });

  it('asks for the detail when the concept is Otro', async () => {
    const { fixture, el, dialog } = await setup();
    dialog.concept.set('OTHER');
    await type(fixture, '#cash-movement-amount', '20,00');
    submit(el);
    await fixture.whenStable();
    expect(text(el)).toContain('Escribe el detalle cuando el concepto es "Otro".');
    http.expectNone(URL);
  });

  it('sends the movement with a key as a multipart form, closes and reports it', async () => {
    const { fixture, el, host, dialog } = await setup();
    dialog.concept.set('FREIGHT');
    await type(fixture, '#cash-movement-amount', '1.250,50');
    await type(fixture, '#cash-movement-detail', 'Flete a Oruro');
    submit(el);

    const req = http.expectOne(URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Idempotency-Key')).toBeTruthy();
    const body = req.request.body as FormData;
    expect(body.get('type')).toBe('EXPENSE');
    expect(body.get('amount')).toBe('1250.50');
    expect(body.get('concept')).toBe('FREIGHT');
    expect(body.get('detail')).toBe('Flete a Oruro');
    expect(body.has('receipt')).toBe(false);
    const created = movementDetail({ status: 'POSTED', canDecide: false });
    req.flush(created);
    await fixture.whenStable();

    expect(host.open()).toBe(false);
    expect(host.registered()).toEqual(created);
  });

  it('attaches the receipt, and uses a new key each time the dialog opens', async () => {
    const { fixture, el, host, dialog } = await setup();
    dialog.concept.set('FREIGHT');
    await type(fixture, '#cash-movement-amount', '10');
    const photo = new File([new Uint8Array(2048)], 'recibo.png', { type: 'image/png' });
    fixture.debugElement.query(By.css('rs-file-dropzone')).triggerEventHandler('filesSelected', [photo]);
    await fixture.whenStable();
    expect(text(el)).toContain('recibo.png');
    expect(text(el)).toContain('2 KB');
    submit(el);

    const first = http.expectOne(URL);
    expect((first.request.body as FormData).get('receipt')).toBeInstanceOf(File);
    const firstKey = first.request.headers.get('Idempotency-Key');
    first.flush(movementDetail({ status: 'POSTED' }));
    await fixture.whenStable();

    host.open.set(true);
    await fixture.whenStable();
    dialog.concept.set('SERVICES');
    await type(fixture, '#cash-movement-amount', '10');
    submit(el);
    const second = http.expectOne(URL);
    expect(second.request.headers.get('Idempotency-Key')).not.toBe(firstKey);
    expect((second.request.body as FormData).has('receipt')).toBe(false);
    second.flush(movementDetail({ status: 'POSTED' }));
  });

  it('refuses a receipt that is not a photo or a PDF, and one over 5 MB', async () => {
    const { fixture, el } = await setup();
    const dropzone = fixture.debugElement.query(By.css('rs-file-dropzone'));
    dropzone.triggerEventHandler('filesSelected', [new File(['x'], 'datos.xlsx', { type: 'application/vnd.ms-excel' })]);
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="cash-movement-receipt-error"]')?.textContent).toContain('una foto (JPG, PNG o WebP) o un PDF');

    fixture.debugElement
      .query(By.css('rs-file-dropzone'))
      .triggerEventHandler('filesSelected', [new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.pdf', { type: 'application/pdf' })]);
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="cash-movement-receipt-error"]')?.textContent).toContain('supera el límite de 5 MB');
  });

  it('removes the chosen receipt', async () => {
    const { fixture, el } = await setup();
    fixture.debugElement.query(By.css('rs-file-dropzone')).triggerEventHandler('filesSelected', [new File(['x'], 'r.pdf', { type: 'application/pdf' })]);
    await fixture.whenStable();
    expect(text(el)).toContain('r.pdf');
    (el.querySelector('rs-file-item button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(text(el)).not.toContain('r.pdf');
    expect(el.querySelector('rs-file-dropzone')).not.toBeNull();
  });

  it('warns that an expense over the limit waits for Management', async () => {
    const { fixture, el, dialog } = await setup({ limit: '100.00' });
    dialog.concept.set('FREIGHT');
    await type(fixture, '#cash-movement-amount', '100');
    expect(el.querySelector('[data-testid="cash-movement-approval-note"]')).toBeNull();
    await type(fixture, '#cash-movement-amount', '150');
    expect(el.querySelector('[data-testid="cash-movement-approval-note"]')?.textContent).toContain(
      'Este egreso supera Bs 100,00 y queda pendiente de aprobación de Gerencia.',
    );
  });

  it('does not warn who approves expenses, and never warns for an income', async () => {
    const approver = await setup({ limit: '100.00', canApprove: true });
    await type(approver.fixture, '#cash-movement-amount', '150');
    expect(approver.el.querySelector('[data-testid="cash-movement-approval-note"]')).toBeNull();
    TestBed.resetTestingModule();

    const income = await setup({ limit: '100.00', type: 'INCOME' });
    await type(income.fixture, '#cash-movement-amount', '150');
    expect(income.el.querySelector('[data-testid="cash-movement-approval-note"]')).toBeNull();
  });

  it('warns when an expense is larger than the cash in the register', async () => {
    const { fixture, el } = await setup();
    await type(fixture, '#cash-movement-amount', '971');
    expect(el.querySelector('[data-testid="cash-movement-exceeds"]')?.textContent).toContain('Bs 970,00');
  });

  it('tells the cashier an expense went to approval', async () => {
    const { fixture, el, host, dialog } = await setup({ limit: '100.00' });
    dialog.concept.set('FREIGHT');
    await type(fixture, '#cash-movement-amount', '150');
    submit(el);
    http.expectOne(URL).flush(movementDetail({ status: 'PENDING' }));
    await fixture.whenStable();
    expect(host.registered()?.status).toBe('PENDING');
  });

  it('keeps the dialog open and shows the server message when the request fails', async () => {
    const { fixture, el, host, dialog } = await setup();
    dialog.concept.set('FREIGHT');
    await type(fixture, '#cash-movement-amount', '10');
    submit(el);
    http.expectOne(URL).flush({ code: 'CASH_EXPENSE_EXCEEDS_CASH', message: 'x' }, { status: 422, statusText: 'Unprocessable' });
    await fixture.whenStable();
    expect(host.open()).toBe(true);
    expect(el.querySelector('[data-testid="cash-movement-error"]')?.textContent).toContain('El egreso supera el efectivo que hay en la caja.');
  });

  it('closes without sending anything when cancelled', async () => {
    const { fixture, el, host } = await setup();
    const cancel = Array.from(el.querySelectorAll('[role=dialog] button')).find((b) => b.textContent?.trim() === 'Cancelar') as HTMLButtonElement;
    cancel.click();
    await fixture.whenStable();
    expect(host.open()).toBe(false);
    http.expectNone(URL);
  });
});
