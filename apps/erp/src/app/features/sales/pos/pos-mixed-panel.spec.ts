import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { PosQrPayment } from '@rodasoft/domain';
import { of } from 'rxjs';
import { PosApi } from './pos-api.service';
import { PosMixedPanel, type PosMixedConfirmation } from './pos-mixed-panel';

const qr = (status: PosQrPayment['status'] = 'PENDING', amount = '511.00'): PosQrPayment => ({
  paymentId: 'q1',
  idempotencyKey: 'mix-key-0001',
  amount,
  qrPayload: `RODASOFT-MOCK|ref-1|${amount}`,
  status,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
});

@Component({
  imports: [PosMixedPanel],
  template: `<rs-pos-mixed-panel
    total="1111.00"
    [resume]="resume()"
    [busy]="busy()"
    (confirmed)="confirmed.push($event)"
    (changeMethod)="changed = changed + 1"
    (lockedChange)="locked.push($event)"
    (problem)="problems.push($event)"
  />`,
})
class HostComponent {
  readonly resume = signal<PosQrPayment | null>(null);
  readonly busy = signal(false);
  confirmed: PosMixedConfirmation[] = [];
  locked: boolean[] = [];
  problems: unknown[] = [];
  changed = 0;
}

describe('PosMixedPanel (VP-04c)', () => {
  const api = { startQr: jest.fn(), qrPayment: jest.fn(), confirmQr: jest.fn(), cancelQr: jest.fn() };

  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    api.startQr.mockReturnValue(of({ payment: qr() }));
    api.qrPayment.mockReturnValue(of({ payment: qr() }));
    api.confirmQr.mockReturnValue(of({ payment: qr('CONFIRMED') }));
    TestBed.configureTestingModule({ providers: [{ provide: PosApi, useValue: api }] });
  });

  async function render(resume: PosQrPayment | null = null) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.resume.set(resume);
    await fixture.whenStable();
    const root = (): HTMLElement => fixture.nativeElement;
    const panel = (): PosMixedPanel => fixture.debugElement.query(By.directive(PosMixedPanel)).componentInstance;
    const byId = (id: string) => root().querySelector<HTMLElement>(`[data-testid=${id}]`);
    const text = (id: string) => byId(id)?.textContent?.trim();
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const field = (id: string) => root().querySelector<HTMLInputElement>(`#${id}`)!;
    const typeIn = async (id: string, value: string) => {
      const input = field(id);
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
    };
    const submit = async () => {
      panel().submit();
      await settle();
    };
    return { fixture, host: fixture.componentInstance, panel, byId, text, field, typeIn, submit, settle };
  }

  it('starts with both fields empty and the whole total uncovered', async () => {
    const { text, field, panel } = await render();
    expect(field('mix-cash').value).toBe('');
    expect(field('mix-qr-field').value).toBe('');
    expect(text('mix-paid')).toBe('Bs 0,00');
    expect(text('mix-remaining')).toBe('Bs 1.111,00');
    expect(panel().canSubmit()).toBe(false);
  });

  it('typing the QR part fills the cash with the rest and shows "Pagado" and "Restante"', async () => {
    const { text, field, typeIn, panel } = await render();
    await typeIn('mix-qr-field', '511');
    expect(field('mix-cash').value).toBe('600');
    expect(text('mix-paid')).toBe('Bs 1.111,00');
    expect(text('mix-remaining')).toBe('Bs 0,00');
    expect(panel().canSubmit()).toBe(true);
  });

  it('shows how much is still uncovered when the cash is less than the rest', async () => {
    const { text, typeIn, panel } = await render();
    await typeIn('mix-qr-field', '511');
    await typeIn('mix-cash', '500');
    expect(text('mix-remaining')).toBe('Bs 100,00');
    expect(panel().canSubmit()).toBe(false);
  });

  it('cash above the rest is accepted and shows the change', async () => {
    const { text, typeIn, panel } = await render();
    await typeIn('mix-qr-field', '511');
    await typeIn('mix-cash', '700');
    expect(text('mix-remaining')).toBe('Bs 0,00');
    expect(text('mix-change-amount')).toBe('Bs 100,00');
    expect(panel().canSubmit()).toBe(true);
  });

  it('a QR part that is the whole total or more is refused with a message', async () => {
    const { fixture, text, typeIn, panel } = await render();
    await typeIn('mix-qr-field', '1111');
    expect(panel().canSubmit()).toBe(false);
    // an invalid part is not counted as paid
    expect(text('mix-paid')).toBe('Bs 0,00');
    expect(text('mix-remaining')).toBe('Bs 1.111,00');
    expect(fixture.nativeElement.textContent).toContain('menor que el total');
  });

  it('"Confirmar cobro" opens the QR for the QR part only', async () => {
    const { typeIn, submit, byId } = await render();
    await typeIn('mix-qr-field', '511');
    await submit();
    expect(api.startQr).toHaveBeenCalledWith(expect.objectContaining({ expectedTotal: '1111.00', amount: '511.00' }));
    expect(byId('qr-received')).not.toBeNull();
  });

  it('once the customer paid the QR, the panel hands the cash and the payment to the page', async () => {
    const { host, typeIn, submit, byId, settle } = await render();
    await typeIn('mix-qr-field', '511');
    await typeIn('mix-cash', '700');
    await submit();
    byId('qr-received')!.click();
    await settle();
    expect(host.locked).toContain(true);
    expect(host.confirmed).toHaveLength(1);
    expect(host.confirmed[0]).toMatchObject({ received: '700.00', payment: { paymentId: 'q1', idempotencyKey: 'mix-key-0001' } });
  });

  it('changing the method from the QR screen goes back to the form with the amounts kept', async () => {
    api.cancelQr.mockReturnValue(of({ payment: qr('CANCELLED') }));
    const { typeIn, submit, byId, field, settle } = await render();
    await typeIn('mix-qr-field', '511');
    await submit();
    byId('qr-change')!.click();
    await settle();
    expect(field('mix-qr-field').value).toBe('511');
    expect(field('mix-cash').value).toBe('600');
  });

  it('waits while the sale is being saved', async () => {
    const { host, typeIn, panel, settle } = await render();
    await typeIn('mix-qr-field', '511');
    host.busy.set(true);
    await settle();
    expect(panel().canSubmit()).toBe(false);
  });

  it('Enter in a field confirms, like the footer button', async () => {
    const { typeIn, field, byId, settle } = await render();
    await typeIn('mix-qr-field', '511');
    field('mix-cash').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(api.startQr).toHaveBeenCalled();
    expect(byId('qr-received')).not.toBeNull();
  });

  it('resumes on a confirmed QR (a refresh): QR field fixed, cash for the rest, locked; confirming completes', async () => {
    const { host, text, field, submit } = await render(qr('CONFIRMED'));
    expect(host.locked).toEqual([true]);
    expect(field('mix-qr-field').disabled).toBe(true);
    expect(field('mix-qr-field').value).toBe('511');
    expect(field('mix-cash').value).toBe('600');
    expect(text('mix-remaining')).toBe('Bs 0,00');
    await submit();
    expect(api.startQr).not.toHaveBeenCalled();
    expect(host.confirmed).toHaveLength(1);
    expect(host.confirmed[0]).toMatchObject({ received: '600.00', payment: { paymentId: 'q1' } });
  });

  it('resumes on a pending QR: back on the QR screen, without opening another', async () => {
    const { byId } = await render(qr('PENDING'));
    expect(byId('qr-received')).not.toBeNull();
    expect(api.startQr).not.toHaveBeenCalled();
  });

  it('"Cambiar forma de pago" before any charge asks the dialog to change method', async () => {
    const { host, byId, settle } = await render();
    byId('mix-change')!.click();
    await settle();
    expect(host.changed).toBe(1);
  });
});
