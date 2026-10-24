import { Directive, ElementRef, inject, input } from '@angular/core';

export type NumericInputKind = 'integer' | 'decimal';

/**
 * Keeps a text input numeric while the user types or pastes: `integer` accepts digits only, `decimal` accepts digits
 * and one separator (comma or dot, as in Bolivia) with at most `decimals` places after it. What does not fit is
 * refused before it reaches the field, so the value never holds letters, signs or a thousands separator.
 *   <input rsInput rsNumeric="decimal" [decimals]="2" />
 * It does not replace validation: autofill and scripts can still set any text, so the form checks the final value too.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: 'input[rsNumeric]',
  host: { '(beforeinput)': 'onBeforeInput($event)' },
})
export class NumericInputDirective {
  private readonly host = inject<ElementRef<HTMLInputElement>>(ElementRef);

  readonly kind = input<NumericInputKind | '' | null>('decimal', { alias: 'rsNumeric' });
  /** Most digits after the separator (decimal only). */
  readonly decimals = input(2);

  protected onBeforeInput(event: InputEvent): void {
    // deletions and cursor moves have no `data`; only what is inserted can break the format
    if (!event.data || !this.kind()) return;
    const el = this.host.nativeElement;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + event.data + el.value.slice(end);
    if (!this.accepts(next)) event.preventDefault();
  }

  private accepts(text: string): boolean {
    if (this.kind() === 'integer') return /^\d*$/.test(text);
    return new RegExp('^[0-9]*([.,][0-9]{0,' + this.decimals() + '})?$').test(text);
  }
}
