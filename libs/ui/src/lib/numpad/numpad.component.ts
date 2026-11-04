import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

/** Figma Numpad `Type`: `amount` has the decimal comma, `qty` (whole numbers) has "borrar todo" in its place. */
export type NumpadType = 'amount' | 'qty';

export interface NumpadRules {
  type: NumpadType;
  /** Most decimals the amount accepts (Bs: 2). Ignored for `qty`. */
  maxDecimals: number;
  /** Most characters of the value, the comma included. */
  maxLength: number;
}

const DIGIT = /^\d$/;

/**
 * The editing rules of the keypad, as a pure function so the physical keyboard and the touch keys behave the same: digits
 * append (no leading zeros: "0" then "5" is "5"), the comma starts the decimals once, and decimals stop at `maxDecimals`.
 * A key that is not allowed leaves the value as it was.
 */
export function applyNumpadKey(value: string, key: string, rules: NumpadRules): string {
  if (DIGIT.test(key)) {
    if (value.length >= rules.maxLength) return value;
    const comma = value.indexOf(',');
    if (comma >= 0 && value.length - comma - 1 >= rules.maxDecimals) return value;
    return value === '0' ? key : value + key;
  }
  if (key === ',') {
    if (rules.type === 'qty' || value.includes(',') || value.length >= rules.maxLength || rules.maxDecimals < 1) return value;
    return value === '' ? '0,' : `${value},`;
  }
  return value;
}

/** Groups the integer part by thousands with a dot: "1200,5" → "1.200,5". */
export function groupThousands(value: string): string {
  const [integer, decimals] = value.split(',');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimals === undefined ? grouped : `${grouped},${decimals}`;
}

/**
 * Figma: Numpad (Design System `385:36309`, Type=Amount|Qty): the POS touch keypad with its display. 96 × 56 px keys. The
 * component edits `value` (a plain string such as "1200,5") and shows it grouped. `Type=Qty` is estimated: Figma describes it
 * as "con borrar todo" but only Amount was drawn. Every text comes from the app.
 *   <rs-numpad type="amount" label="Monto recibido" prefix="Bs " [(value)]="received" backspaceLabel="Borrar" />
 */
@Component({
  selector: 'rs-numpad',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()' },
  templateUrl: './numpad.component.html',
  styleUrl: './numpad.component.scss',
})
export class NumpadComponent {
  readonly type = input<NumpadType>('amount');
  /** The display's caption ("Monto recibido"). */
  readonly label = input.required<string>();
  /** Shown before the value ("Bs "). */
  readonly prefix = input<string>('');
  /** What the display shows while the value is empty. */
  readonly placeholder = input<string>('0');
  readonly value = model<string>('');
  readonly maxDecimals = input<number>(2);
  readonly maxLength = input<number>(12);
  /** Accessible names of the two action keys; `clearLabel` is the `qty` key that empties the value. */
  readonly backspaceLabel = input.required<string>();
  readonly clearLabel = input<string>('');
  readonly decimalLabel = input.required<string>();

  protected readonly digitRows = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
  ] as const;

  protected readonly shown = computed(() => {
    const value = this.value();
    return value === '' ? this.placeholder() : groupThousands(value);
  });

  /** The same entry point for the touch keys and the physical keyboard. */
  press(key: string): void {
    this.value.update((value) => applyNumpadKey(value, key, { type: this.type(), maxDecimals: this.maxDecimals(), maxLength: this.maxLength() }));
  }

  backspace(): void {
    this.value.update((value) => value.slice(0, -1));
  }

  clear(): void {
    this.value.set('');
  }
}
