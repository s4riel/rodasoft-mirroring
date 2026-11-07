import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { PosCardPayment } from '@rodasoft/domain';
import { of, throwError } from 'rxjs';
import { PosApi } from './pos-api.service';
import { PosCardPanel } from './pos-card-panel';

const payment = (over: Partial<PosCardPayment> = {}): PosCardPayment => ({
  paymentId: 'c1',
  idempotencyKey: 'card-key-0001',
  amount: '490.00',
  status: 'PENDING',
  attempt: 1,
  authorizationCode: null,
  declineReason: null,
  ...over,
});

@Component({
  imports: [PosCardPanel],
  template: `<rs-pos-card-panel
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
  readonly resume = signal<PosCardPayment | null>(null);
  readonly busy = signal(false);
  confirmed: PosCardPayment[] = [];
  locked: boolean[] = [];
  problems: unknown[] = [];
  changed = 0;
}

describe('PosCardPanel', () => {
  const api = { startCard: jest.fn(), confirmCard: jest.fn(), cancelCard: jest.fn() };

  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    TestBed.configureTestingModule({ providers: [{ provide: PosApi, useValue: api }] });
  });

  function render(resume: PosCardPayment | null = null) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.resume.set(resume);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const byId = (id: string) => root.querySelector<HTMLElement>(`[data-testid=${id}]`);
    const click = (id: string) => {
      byId(id)!.click();
      fixture.detectChanges();
    };
    const type = (id: string, value: string) => {
      const input = byId(id) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    };
    return { fixture, host: fixture.componentInstance, root, byId, click, type };
  }

  it('opens an attempt for the total with a key of its own and waits for the terminal', () => {
    api.startCard.mockReturnValue(of({ payment: payment() }));
    const { byId } = render();
    expect(api.startCard).toHaveBeenCalledWith({ idempotencyKey: expect.any(String), expectedTotal: '490.00' });
    expect(api.startCard.mock.calls[0][0].idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(byId('card-amount')!.textContent).toBe('Bs 490,00');
    expect(byId('card-waiting')).not.toBeNull();
  });

  it('resumes an attempt the server already has instead of opening a new one', () => {
    const { byId } = render(payment({ attempt: 2 }));
    expect(api.startCard).not.toHaveBeenCalled();
    expect(byId('card-waiting')!.parentElement!.textContent).toContain('Intento 2');
  });

  it('shows a retry when the attempt could not be opened', () => {
    api.startCard.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    const { byId } = render();
    expect(byId('card-retry')).not.toBeNull();
    api.startCard.mockReturnValue(of({ payment: payment() }));
    byId('card-retry')!.click();
    expect(api.startCard).toHaveBeenCalledTimes(2);
  });

  describe('approval', () => {
    it('needs a valid authorization code before it asks the server', () => {
      api.startCard.mockReturnValue(of({ payment: payment() }));
      const { click, type, byId, root } = render();
      click('card-approved');
      type('card-code', 'AB');
      click('card-approve-confirm');
      expect(api.confirmCard).not.toHaveBeenCalled();
      expect(root.textContent).toContain('código de autorización');
      expect(byId('card-code')).not.toBeNull();
    });

    it('sends the code, locks the screen and tells the page the card was approved', () => {
      api.startCard.mockReturnValue(of({ payment: payment() }));
      const approved = payment({ status: 'CONFIRMED', authorizationCode: 'A1B2C3' });
      api.confirmCard.mockReturnValue(of({ payment: approved }));
      const { click, type, host, byId } = render();
      click('card-approved');
      type('card-code', ' a1b2c3 ');
      click('card-approve-confirm');
      expect(api.confirmCard).toHaveBeenCalledWith('c1', { outcome: 'APPROVED', authorizationCode: 'A1B2C3' });
      expect(host.confirmed).toEqual([approved]);
      expect(host.locked).toEqual([true]);
      expect(byId('card-complete')).not.toBeNull();
    });

    it('lets the cashier retry the completion of an approved card', () => {
      const { click, host } = render(payment({ status: 'CONFIRMED', authorizationCode: 'A1B2C3' }));
      click('card-complete');
      expect(host.confirmed).toHaveLength(2);
    });
  });

  describe('decline (VP-12)', () => {
    function declinedScreen() {
      api.startCard.mockReturnValue(of({ payment: payment() }));
      api.confirmCard.mockReturnValue(of({ payment: payment({ status: 'DECLINED', declineReason: 'INSUFFICIENT_FUNDS' }) }));
      const view = render();
      view.click('card-declined');
      const radio = view.root.querySelector<HTMLInputElement>('rs-radio input')!;
      radio.click();
      view.fixture.detectChanges();
      view.click('card-decline-confirm');
      return view;
    }

    it('asks for a reason first: nothing is sent without one', () => {
      api.startCard.mockReturnValue(of({ payment: payment() }));
      const { click, byId } = render();
      click('card-declined');
      expect((byId('card-decline-confirm') as HTMLButtonElement).disabled).toBe(true);
      expect(api.confirmCard).not.toHaveBeenCalled();
    });

    it('sends the reason and shows the decline with its reason and the attempt number', () => {
      const { byId, root } = declinedScreen();
      expect(api.confirmCard).toHaveBeenCalledWith('c1', { outcome: 'DECLINED', reason: 'INSUFFICIENT_FUNDS' });
      expect(root.textContent).toContain('Tarjeta rechazada');
      expect(byId('card-decline-reason')!.textContent).toBe('Fondos insuficientes');
      expect(root.textContent).toContain('Intento 1');
    });

    it('is only the note: retrying, changing method and going back belong to the dialog (Figma VP-12)', () => {
      const { root, byId, fixture } = declinedScreen();
      expect(root.querySelector('rs-note')!.textContent).toContain('Tarjeta rechazada');
      expect(root.textContent).toContain('Prueba otra tarjeta o cambia la forma de pago');
      expect(root.querySelector('.actions')).toBeNull();
      expect(byId('card-new')).toBeNull();
      const panel = fixture.debugElement.query(By.directive(PosCardPanel)).componentInstance as PosCardPanel;
      expect(panel.declined()).toBe(true);
    });

    it('"Reintentar cobro" (the dialog calls `start`) opens a new attempt with a new key', () => {
      const { fixture } = declinedScreen();
      api.startCard.mockReturnValue(of({ payment: payment({ paymentId: 'c2', attempt: 2, idempotencyKey: 'card-key-0002' }) }));
      const panel = fixture.debugElement.query(By.directive(PosCardPanel)).componentInstance as PosCardPanel;
      panel.start();
      fixture.detectChanges();
      expect(api.startCard).toHaveBeenCalledTimes(2);
      const [first, second] = api.startCard.mock.calls.map((call) => call[0].idempotencyKey);
      expect(second).not.toBe(first);
      expect(panel.declined()).toBe(false);
    });
  });

  describe('changing method while the terminal waits', () => {
    it('drops the pending attempt on the server, then lets the page change method', () => {
      api.startCard.mockReturnValue(of({ payment: payment() }));
      api.cancelCard.mockReturnValue(of({ payment: payment({ status: 'CANCELLED' }) }));
      const { click, host } = render();
      click('card-change');
      expect(api.cancelCard).toHaveBeenCalledWith('c1');
      expect(host.changed).toBe(1);
    });

    it('reports what the server refuses and does not change method', () => {
      api.startCard.mockReturnValue(of({ payment: payment() }));
      api.cancelCard.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
      const { click, host } = render();
      click('card-change');
      expect(host.problems).toHaveLength(1);
      expect(host.changed).toBe(0);
    });
  });

  describe('lock', () => {
    it('locks the dialog while the terminal waits, since the customer may already be charged', () => {
      api.startCard.mockReturnValue(of({ payment: payment() }));
      const { host } = render();
      expect(host.locked).toEqual([true]);
    });

    it('frees the dialog when the terminal declines', () => {
      api.startCard.mockReturnValue(of({ payment: payment() }));
      api.confirmCard.mockReturnValue(of({ payment: payment({ status: 'DECLINED', declineReason: 'OTHER' }) }));
      const { click, host, root, fixture } = render();
      click('card-declined');
      root.querySelector<HTMLInputElement>('rs-radio input')!.click();
      fixture.detectChanges();
      click('card-decline-confirm');
      expect(host.locked).toEqual([true, false]);
    });

    it('does not lock a declined attempt that is resumed after a refresh', () => {
      const { host } = render(payment({ status: 'DECLINED', declineReason: 'OTHER' }));
      expect(host.locked).toEqual([]);
    });
  });

  it('keeps every button off while the sale is being saved', () => {
    api.startCard.mockReturnValue(of({ payment: payment() }));
    const { fixture, host, byId } = render();
    host.busy.set(true);
    fixture.detectChanges();
    expect((byId('card-approved') as HTMLButtonElement).disabled).toBe(true);
    expect((byId('card-declined') as HTMLButtonElement).disabled).toBe(true);
    expect((byId('card-change') as HTMLButtonElement).disabled).toBe(true);
  });
});
