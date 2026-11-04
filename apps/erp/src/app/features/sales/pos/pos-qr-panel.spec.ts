import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { PosQrPayment } from '@rodasoft/domain';
import { of, throwError } from 'rxjs';
import { PosApi } from './pos-api.service';
import { PosQrPanel, QR_POLL_MS } from './pos-qr-panel';

const payment = (status: PosQrPayment['status'] = 'PENDING', expiresInMs = 300_000): PosQrPayment => ({
  paymentId: 'q1',
  idempotencyKey: 'qr-key-0001',
  amount: '490.00',
  qrPayload: 'RODASOFT-MOCK|ref-1|490.00',
  status,
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
});

@Component({
  imports: [PosQrPanel],
  template: `<rs-pos-qr-panel
    total="490.00"
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
  confirmed: PosQrPayment[] = [];
  locked: boolean[] = [];
  problems: unknown[] = [];
  changed = 0;
}

describe('PosQrPanel', () => {
  const api = {
    startQr: jest.fn(),
    qrPayment: jest.fn(),
    confirmQr: jest.fn(),
    cancelQr: jest.fn(),
  };

  beforeEach(() => {
    jest.useFakeTimers();
    Object.values(api).forEach((fn) => fn.mockReset());
    TestBed.configureTestingModule({ providers: [{ provide: PosApi, useValue: api }] });
  });

  afterEach(() => jest.useRealTimers());

  function render(resume: PosQrPayment | null = null) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.resume.set(resume);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const byId = (id: string) => root.querySelector<HTMLElement>(`[data-testid=${id}]`);
    const click = (id: string) => {
      byId(id)!.click();
      fixture.detectChanges();
    };
    return { fixture, host: fixture.componentInstance, root, byId, click };
  }

  it('opens a QR for the total with a key of its own and draws it with the amount', () => {
    api.startQr.mockReturnValue(of({ payment: payment() }));
    const { fixture, byId, root } = render();
    expect(api.startQr).toHaveBeenCalledWith({ idempotencyKey: expect.any(String), expectedTotal: '490.00' });
    expect(api.startQr.mock.calls[0][0].idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(root.querySelector('rs-qr-code')).not.toBeNull();
    expect(byId('qr-amount')!.textContent).toBe('Bs 490,00');
    expect(byId('qr-waiting')).not.toBeNull();
    fixture.destroy();
  });

  it('shows a countdown to the deadline', () => {
    const waiting = payment('PENDING', 125_000);
    api.startQr.mockReturnValue(of({ payment: waiting }));
    api.qrPayment.mockReturnValue(of({ payment: waiting }));
    const { fixture, byId } = render();
    expect(byId('qr-countdown')!.textContent).toContain('vence en 02:05');
    jest.advanceTimersByTime(5000);
    fixture.detectChanges();
    expect(byId('qr-countdown')!.textContent).toContain('vence en 02:00');
    fixture.destroy();
  });

  it('resumes the QR the server has instead of opening a new one', () => {
    const { fixture, byId } = render(payment());
    expect(api.startQr).not.toHaveBeenCalled();
    expect(byId('qr-waiting')).not.toBeNull();
    fixture.destroy();
  });

  it('asks the server while it waits and tells the page once, when the payment is confirmed', () => {
    api.startQr.mockReturnValue(of({ payment: payment() }));
    api.qrPayment.mockReturnValueOnce(of({ payment: payment() })).mockReturnValue(of({ payment: payment('CONFIRMED') }));
    const { fixture, host, byId } = render();
    jest.advanceTimersByTime(QR_POLL_MS);
    expect(api.qrPayment).toHaveBeenCalledTimes(1);
    expect(host.confirmed).toEqual([]);
    jest.advanceTimersByTime(QR_POLL_MS);
    fixture.detectChanges();
    expect(host.confirmed).toEqual([payment('CONFIRMED')].map((p) => expect.objectContaining({ paymentId: p.paymentId, status: 'CONFIRMED' })));
    expect(host.locked).toEqual([true]);
    expect(byId('qr-received')).toBeNull();
    // it no longer asks once confirmed
    jest.advanceTimersByTime(QR_POLL_MS * 3);
    expect(api.qrPayment).toHaveBeenCalledTimes(2);
    expect(host.confirmed).toHaveLength(1);
    fixture.destroy();
  });

  it('"Pago recibido" reports the payment as approved and confirms it', () => {
    api.startQr.mockReturnValue(of({ payment: payment() }));
    api.confirmQr.mockReturnValue(of({ payment: payment('CONFIRMED') }));
    const { fixture, host, click } = render();
    click('qr-received');
    expect(api.confirmQr).toHaveBeenCalledWith('q1', 'APPROVED');
    expect(host.confirmed).toHaveLength(1);
    fixture.destroy();
  });

  it('"Pago no recibido" reports it and offers a new QR with a new key', () => {
    api.startQr.mockReturnValue(of({ payment: payment() }));
    api.confirmQr.mockReturnValue(of({ payment: payment('DECLINED') }));
    const { fixture, root, click } = render();
    click('qr-not-received');
    expect(api.confirmQr).toHaveBeenCalledWith('q1', 'DECLINED');
    expect(root.textContent).toContain('El pago no llegó');
    click('qr-new');
    expect(api.startQr).toHaveBeenCalledTimes(2);
    expect(api.startQr.mock.calls[1][0].idempotencyKey).not.toBe(api.startQr.mock.calls[0][0].idempotencyKey);
    fixture.destroy();
  });

  it('a QR the server cancelled at its deadline shows as expired', () => {
    api.startQr.mockReturnValue(of({ payment: payment() }));
    api.qrPayment.mockReturnValue(of({ payment: payment('CANCELLED') }));
    const { fixture, root, byId } = render();
    jest.advanceTimersByTime(QR_POLL_MS);
    fixture.detectChanges();
    expect(root.textContent).toContain('El QR venció y se canceló');
    expect(byId('qr-new')).not.toBeNull();
    fixture.destroy();
  });

  it('"Cambiar método" drops the QR on the server and tells the page', () => {
    api.startQr.mockReturnValue(of({ payment: payment() }));
    api.cancelQr.mockReturnValue(of({ payment: payment('CANCELLED') }));
    const { fixture, host, click } = render();
    click('qr-change');
    expect(api.cancelQr).toHaveBeenCalledWith('q1');
    expect(host.changed).toBe(1);
    fixture.destroy();
  });

  it('with no connection it offers to try again, and the retry opens the QR', () => {
    api.startQr
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })))
      .mockReturnValue(of({ payment: payment() }));
    const { fixture, root, byId, click } = render();
    expect(root.textContent).toContain('No pudimos generar el QR');
    click('qr-retry');
    expect(byId('qr-waiting')).not.toBeNull();
    fixture.destroy();
  });

  it('passes on what it cannot fix (the cart changed) to the page', () => {
    const err = new HttpErrorResponse({ status: 409, error: { code: 'CHECKOUT_TOTAL_CHANGED', message: 'x' } });
    api.startQr.mockReturnValue(throwError(() => err));
    const { fixture, host } = render();
    expect(host.problems).toEqual([err]);
    fixture.destroy();
  });

  it('"Completar venta" asks the page again when the answer of the sale was lost', () => {
    api.startQr.mockReturnValue(of({ payment: payment() }));
    api.confirmQr.mockReturnValue(of({ payment: payment('CONFIRMED') }));
    const { fixture, host, click } = render();
    click('qr-received');
    click('qr-complete');
    expect(host.confirmed).toHaveLength(2);
    fixture.destroy();
  });

  it('stops asking the server when it is gone', () => {
    api.startQr.mockReturnValue(of({ payment: payment() }));
    api.qrPayment.mockReturnValue(of({ payment: payment() }));
    const { fixture } = render();
    fixture.destroy();
    jest.advanceTimersByTime(QR_POLL_MS * 3);
    expect(api.qrPayment).not.toHaveBeenCalled();
  });
});
