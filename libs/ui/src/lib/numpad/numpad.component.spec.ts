import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { applyNumpadKey, groupThousands, NumpadComponent, type NumpadRules, type NumpadType } from './numpad.component';

const amount: NumpadRules = { type: 'amount', maxDecimals: 2, maxLength: 12 };

describe('applyNumpadKey', () => {
  it('appends digits and drops a leading zero', () => {
    expect(applyNumpadKey('', '1', amount)).toBe('1');
    expect(applyNumpadKey('12', '0', amount)).toBe('120');
    expect(applyNumpadKey('0', '5', amount)).toBe('5');
    expect(applyNumpadKey('', '0', amount)).toBe('0');
  });

  it('accepts one comma, and starts with "0," when it comes first', () => {
    expect(applyNumpadKey('12', ',', amount)).toBe('12,');
    expect(applyNumpadKey('12,5', ',', amount)).toBe('12,5');
    expect(applyNumpadKey('', ',', amount)).toBe('0,');
  });

  it('stops at the decimals limit', () => {
    expect(applyNumpadKey('12,5', '0', amount)).toBe('12,50');
    expect(applyNumpadKey('12,50', '7', amount)).toBe('12,50');
  });

  it('stops at the length limit', () => {
    expect(applyNumpadKey('123456789012', '3', amount)).toBe('123456789012');
  });

  it('has no comma for whole quantities', () => {
    expect(applyNumpadKey('3', ',', { ...amount, type: 'qty' })).toBe('3');
  });

  it('ignores any other key', () => {
    expect(applyNumpadKey('12', 'a', amount)).toBe('12');
  });
});

describe('groupThousands', () => {
  it.each([
    ['1200', '1.200'],
    ['1200,5', '1.200,5'],
    ['999', '999'],
    ['1234567,89', '1.234.567,89'],
    ['0,', '0,'],
  ])('%s → %s', (value, expected) => expect(groupThousands(value)).toBe(expected));
});

@Component({
  imports: [NumpadComponent],
  template: `<rs-numpad [type]="type()" label="Monto recibido" prefix="Bs " [(value)]="value" backspaceLabel="Borrar" decimalLabel="Coma decimal" clearLabel="Borrar todo" />`,
})
class HostComponent {
  readonly type = signal<NumpadType>('amount');
  readonly value = signal('');
  readonly pad = viewChild.required(NumpadComponent);
}

describe('NumpadComponent', () => {
  async function render() {
    const fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
    const el = (): HTMLElement => fixture.nativeElement.querySelector('rs-numpad');
    const key = (text: string) =>
      Array.from(el().querySelectorAll<HTMLButtonElement>('button.key')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
    const display = () => el().querySelector('.amount')?.textContent;
    return { fixture, host: fixture.componentInstance, el, key, display };
  }

  it('draws the 12 keys and the display with its caption', async () => {
    const { el, display } = await render();
    expect(el().querySelectorAll('button.key')).toHaveLength(12);
    expect(el().querySelector('.caption')?.textContent).toBe('Monto recibido');
    expect(display()).toBe('Bs 0');
  });

  it('types 1-2-0-0 and shows "Bs 1.200", two-way', async () => {
    const { fixture, host, key, display } = await render();
    for (const digit of ['1', '2', '0', '0']) key(digit).click();
    await fixture.whenStable();
    expect(host.value()).toBe('1200');
    expect(display()).toBe('Bs 1.200');
  });

  it('types decimals with the comma key, once', async () => {
    const { fixture, host, key } = await render();
    for (const k of ['1', ',', '5', ',', '0', '9']) key(k).click();
    await fixture.whenStable();
    expect(host.value()).toBe('1,50');
  });

  it('backspace removes the last character', async () => {
    const { fixture, host, key } = await render();
    for (const digit of ['1', '2']) key(digit).click();
    key('⌫').click();
    await fixture.whenStable();
    expect(host.value()).toBe('1');
  });

  it('exposes press() so the physical keyboard behaves like the touch keys', async () => {
    const { fixture, host } = await render();
    host.pad().press('7');
    host.pad().press(',');
    host.pad().press('5');
    await fixture.whenStable();
    expect(host.value()).toBe('7,5');
    host.pad().clear();
    expect(host.value()).toBe('');
  });

  it('Type=Qty swaps the comma for a clear-all key', async () => {
    const { fixture, host, el, key } = await render();
    host.type.set('qty');
    await fixture.whenStable();
    expect(el().getAttribute('data-type')).toBe('qty');
    expect(key(',')).toBeUndefined();
    key('4').click();
    key('2').click();
    key('C').click();
    await fixture.whenStable();
    expect(host.value()).toBe('');
  });
});
