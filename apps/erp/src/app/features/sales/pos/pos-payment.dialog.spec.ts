import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Decimal } from '@rodasoft/domain';
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
    (cancelled)="cancelled = cancelled + 1"
  />`,
})
class HostComponent {
  readonly open = signal(true);
  readonly busy = signal(false);
  confirmed: string[] = [];
  cancelled = 0;
}

describe('PosPaymentDialog', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
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

  it('draws the six payment methods with only cash enabled', async () => {
    const { root } = await render();
    const chips = Array.from(root().querySelectorAll('.methods rs-filter-chip'));
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['Efectivo', 'QR', 'Tarjeta', 'Transferencia', 'Crédito', 'Mixto']);
    expect(chips.map((c) => c.getAttribute('data-disabled'))).toEqual([null, 'true', 'true', 'true', 'true', 'true']);
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
