import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Decimal, type PosQrPayment } from '@rodasoft/domain';
import { of } from 'rxjs';
import { PosApi } from './pos-api.service';
import { PosPaymentDialog, typedAmount } from './pos-payment.dialog';

describe('typedAmount', () => {
  it.each([
    ['1150.00', '1150'],
    ['1111.50', '1111,5'],
    ['89.05', '89,05'],
    ['0.10', '0,1'],
  ])('%s is typed as %s', (amount, expected) => expect(typedAmount(Decimal.of(amount))).toBe(expected));
});

@Component({
  imports: [PosPaymentDialog],
  template: `<rs-pos-payment-dialog
    [open]="open()"
    total="1111.00"
    [suggested]="['1150.00', '1200.00']"
    [busy]="busy()"
    (confirm)="confirmed.push($event)"
    [resumeQr]="resumeQr()"
    [allowMixed]="allowMixed()"
    (cancelled)="cancelled = cancelled + 1"
    (qrConfirmed)="paidByQr.push($event)"
  />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly busy = signal(false);
  readonly resumeQr = signal<PosQrPayment | null>(null);
  readonly allowMixed = signal(true);
  paidByQr: PosQrPayment[] = [];
  confirmed: string[] = [];
  cancelled = 0;
}

describe('PosPaymentDialog', () => {
  const qr = (status: PosQrPayment['status'] = 'PENDING'): PosQrPayment => ({
    paymentId: 'q1',
    idempotencyKey: 'qr-key-0001',
    amount: '1111.00',
    qrPayload: 'RODASOFT-MOCK|ref|1111.00',
    status,
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
  });

  async function render(resume: PosQrPayment | null = null) {
    TestBed.configureTestingModule({
      providers: [{ provide: PosApi, useValue: { startQr: () => of({ payment: qr() }), qrPayment: () => of({ payment: qr() }) } }],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.resumeQr.set(resume);
    await fixture.whenStable();
    const root = (): HTMLElement => fixture.nativeElement;
    const text = (id: string) => root().querySelector(`[data-testid=${id}]`)?.textContent;
    const key = (k: string) => Array.from(root().querySelectorAll<HTMLButtonElement>('rs-numpad button.key')).find((b) => b.textContent?.trim() === k)!;
    const confirm = () => root().querySelector<HTMLButtonElement>('[data-testid=pay-confirm]')!;
    const settle = async () => {
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    return { fixture, host: fixture.componentInstance, root, text, key, confirm, settle };
  }

  it('starts empty: nothing received and no change', async () => {
    const { text, confirm } = await render();
    expect(text('pay-total')).toBe('Bs 1.111,00');
    expect(text('pay-received')).toBe('Bs 0,00');
    expect(text('pay-change')).toBe('Bs 0,00');
    expect(confirm().disabled).toBe(true);
  });

  it('draws the six payment methods with cash, QR and Mixto enabled', async () => {
    const { root } = await render();
    const chips = Array.from(root().querySelectorAll('.methods rs-filter-chip'));
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['Efectivo', 'QR', 'Tarjeta', 'Transferencia', 'Crédito', 'Mixto']);
    expect(chips.map((c) => c.getAttribute('data-disabled'))).toEqual([null, null, 'true', 'true', 'true', null]);
  });

  it('"Exacto" receives the total with no change and confirms it', async () => {
    const { host, root, text, confirm, settle } = await render();
    root().querySelector<HTMLButtonElement>('.quick rs-filter-chip button')!.click();
    await settle();
    expect(text('pay-received')).toBe('Bs 1.111,00');
    expect(text('pay-change')).toBe('Bs 0,00');
    confirm().click();
    expect(host.confirmed).toEqual(['1111.00']);
  });

  it('the keypad computes the change: 1.200 for 1.111,00 gives Bs 89,00', async () => {
    const { host, key, text, confirm, settle } = await render();
    for (const k of ['1', '2', '0', '0']) key(k).click();
    await settle();
    expect(text('pay-received')).toBe('Bs 1.200,00');
    expect(text('pay-change')).toBe('Bs 89,00');
    confirm().click();
    expect(host.confirmed).toEqual(['1200.00']);
  });

  it('with decimals: 1.111,5 is accepted and sent as 1111.50', async () => {
    const { host, key, confirm, settle } = await render();
    for (const k of ['1', '1', '1', '1', ',', '5']) key(k).click();
    await settle();
    confirm().click();
    expect(host.confirmed).toEqual(['1111.50']);
  });

  it('less than the total shows what is missing and cannot be confirmed', async () => {
    const { host, key, text, confirm, settle } = await render();
    for (const k of ['1', '0', '0', '0']) key(k).click();
    await settle();
    expect(text('pay-shortfall')).toBe('Bs 111,00');
    expect(confirm().disabled).toBe(true);
    confirm().click();
    expect(host.confirmed).toEqual([]);
  });

  it('waits for the answer while the sale is being saved', async () => {
    const { host, key, confirm, settle } = await render();
    for (const k of ['2', '0', '0', '0']) key(k).click();
    host.busy.set(true);
    await settle();
    expect(confirm().disabled).toBe(true);
    expect(Array.from(fixtureButtons()).find((b) => b.textContent?.includes('Cancelar'))?.disabled).toBe(true);

    function fixtureButtons() {
      return document.body.querySelectorAll<HTMLButtonElement>('button');
    }
  });

  it('"Cancelar" asks the page to go back to the cart', async () => {
    const { host, root, settle } = await render();
    Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Cancelar'))!.click();
    await settle();
    expect(host.cancelled).toBe(1);
  });

  it('QR shows the QR screen instead of the keypad and the cash confirmation', async () => {
    const { root, settle, confirm } = await render();
    root().querySelectorAll<HTMLButtonElement>('.methods rs-filter-chip button')[1].click();
    await settle();
    expect(root().querySelector('rs-pos-qr-panel')).not.toBeNull();
    expect(root().querySelector('rs-numpad')).toBeNull();
    expect(root().querySelector('[data-testid=pay-confirm]')).toBeNull();
    expect(confirm()).toBeNull();
  });

  it('Enter does not confirm a cash amount while the QR screen is on', async () => {
    const { host, root, settle } = await render();
    root().querySelectorAll<HTMLButtonElement>('.methods rs-filter-chip button')[1].click();
    await settle();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(host.confirmed).toEqual([]);
  });

  it('opens on the QR the server already has (a refresh)', async () => {
    const { root, settle } = await render(qr());
    await settle();
    expect(root().querySelector('rs-pos-qr-panel')).not.toBeNull();
    expect(root().querySelector('[data-testid=qr-waiting]')).not.toBeNull();
  });

  it('a confirmed QR locks "Cancelar" and the close button, and tells the page to complete the sale', async () => {
    const { host, root, settle } = await render(qr('CONFIRMED'));
    await settle();
    expect(host.paidByQr).toHaveLength(1);
    const cancel = Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Cancelar'))!;
    expect(cancel.disabled).toBe(true);
    root().querySelector<HTMLButtonElement>('.close')?.click();
    await settle();
    expect(host.cancelled).toBe(0);
    // the modal closed itself on the X: the dialog opens it again, because the page still has the payment open
    expect(root().querySelector('[role=dialog]')).not.toBeNull();
  });

  it('"Mixto" shows the mixed panel instead of the cash keypad', async () => {
    const { root, settle } = await render();
    root().querySelectorAll<HTMLButtonElement>('.methods rs-filter-chip button')[5].click();
    await settle();
    expect(root().querySelector('rs-pos-mixed-panel')).not.toBeNull();
    expect(root().querySelector('[data-testid=pay-confirm]')).toBeNull();
  });

  it('does not draw "Mixto" when the company turned mixed payment off', async () => {
    const { fixture, root, settle } = await render();
    fixture.componentInstance.allowMixed.set(false);
    await settle();
    const chips = Array.from(root().querySelectorAll('.methods rs-filter-chip'));
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['Efectivo', 'QR', 'Tarjeta', 'Transferencia', 'Crédito']);
  });

  it('resumes a QR that covers only part of the total on the mixed panel', async () => {
    const { root, settle } = await render({ ...qr('CONFIRMED'), amount: '700.00' });
    await settle();
    expect(root().querySelector('rs-pos-mixed-panel')).not.toBeNull();
    expect(root().querySelector('[data-testid=mix-confirm]')).not.toBeNull();
    const cancel = Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes('Cancelar'))!;
    expect(cancel.disabled).toBe(true);
  });

  it('every opening starts empty', async () => {
    const { host, key, text, settle } = await render();
    key('5').click();
    await settle();
    expect(text('pay-received')).toBe('Bs 5,00');
    host.open.set(false);
    await settle();
    host.open.set(true);
    await settle();
    expect(text('pay-received')).toBe('Bs 0,00');
  });
});
