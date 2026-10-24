import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NumericInputDirective } from './numeric-input.directive';

@Component({
  imports: [NumericInputDirective],
  template: `<input id="money" rsNumeric="decimal" [decimals]="2" /><input id="whole" rsNumeric="integer" />`,
})
class HostComponent {}

describe('NumericInputDirective', () => {
  const setup = () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    return { money: el.querySelector('#money') as HTMLInputElement, whole: el.querySelector('#whole') as HTMLInputElement };
  };
  /** Types a text at the end of the field; returns whether the browser would have accepted it. */
  const type = (input: HTMLInputElement, data: string) => {
    const event = new InputEvent('beforeinput', { data, cancelable: true, bubbles: true });
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(event);
    if (!event.defaultPrevented) input.value += data;
    return !event.defaultPrevented;
  };

  it('accepts digits and one separator with up to the allowed decimals', () => {
    const { money } = setup();
    for (const key of ['2', '4', '5', ',', '5', '0']) expect(type(money, key)).toBe(true);
    expect(money.value).toBe('245,50');
  });

  it('refuses letters, signs, a second separator and extra decimals', () => {
    const { money } = setup();
    type(money, '1');
    for (const key of ['a', '-', 'e', ' ']) expect(type(money, key)).toBe(false);
    type(money, ',');
    expect(type(money, ',')).toBe(false);
    expect(type(money, '.')).toBe(false);
    type(money, '2');
    type(money, '5');
    expect(type(money, '9')).toBe(false);
    expect(money.value).toBe('1,25');
  });

  it('refuses a pasted text that is not an amount', () => {
    const { money } = setup();
    expect(type(money, '1.250,50')).toBe(false);
    expect(type(money, '12,5')).toBe(true);
  });

  it('accepts digits only in an integer field', () => {
    const { whole } = setup();
    expect(type(whole, '1')).toBe(true);
    expect(type(whole, ',')).toBe(false);
    expect(type(whole, '2')).toBe(true);
    expect(whole.value).toBe('12');
  });

  it('lets the user delete', () => {
    const { money } = setup();
    const event = new InputEvent('beforeinput', { inputType: 'deleteContentBackward', cancelable: true });
    money.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
