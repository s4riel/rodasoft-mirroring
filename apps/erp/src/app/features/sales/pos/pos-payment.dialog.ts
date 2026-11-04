import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked, viewChild } from '@angular/core';
import { Decimal, MONEY_SCALE, validateCashTendered, validateOpeningFloat } from '@rodasoft/domain';
import { ButtonComponent, ChipMediaComponent, FilterChipComponent, IconComponent, ModalComponent, NumpadComponent, groupThousands } from '@rodasoft/ui';

/** What the amount looks like when typed: no cents when there are none ("1150"), a comma otherwise ("1150,5"). */
export function typedAmount(amount: Decimal): string {
  const [integer, cents] = amount.round(MONEY_SCALE).toString().split('.');
  return cents === '00' ? integer : `${integer},${cents.replace(/0$/, '')}`;
}

/**
 * VP-04 · Cobrar venta, cash only (HU-VEN-07). The total comes frozen from the server (`pay`); the cashier types what the
 * customer handed over on the keypad (or taps a quick amount) and sees the change. Confirming with less than the total is not
 * possible. The page decides what happens next: it sends `confirm` to the server and closes this dialog once the sale is saved.
 * Enter confirms, Esc cancels, digits and the comma type on the physical keyboard too.
 */
@Component({
  selector: 'rs-pos-payment-dialog',
  imports: [ButtonComponent, ChipMediaComponent, FilterChipComponent, IconComponent, ModalComponent, NumpadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  templateUrl: './pos-payment.dialog.html',
  styleUrl: './pos-payment.dialog.scss',
})
export class PosPaymentDialog {
  private readonly pad = viewChild(NumpadComponent);

  readonly open = input(false);
  /** The total to charge, a decimal string the server froze (`pay`). */
  readonly total = input.required<string>();
  /** The quick amounts the server suggests, decimal strings. */
  readonly suggested = input<string[]>([]);
  /** The sale is being saved: the buttons wait for the answer. */
  readonly busy = input(false);

  /** The amount received, as a decimal string, when the cashier confirms. */
  readonly confirm = output<string>();
  /** "Cancelar", Esc or the close button: the page returns the cart to `OPEN`. */
  readonly cancelled = output<void>();

  /** What is typed on the keypad ("1200", "1200,5"). */
  protected readonly received = signal('');

  protected readonly totalAmount = computed(() => Decimal.of(this.total()));
  protected readonly totalText = computed(() => this.totalAmount().format());
  protected readonly quickAmounts = computed(() => [
    { key: 'exact', label: 'Exacto', typed: typedAmount(this.totalAmount()) },
    ...this.suggested().map((amount) => {
      const typed = typedAmount(Decimal.of(amount));
      return { key: amount, label: `Bs ${groupThousands(typed)}`, typed };
    }),
  ]);

  /** The amount typed so far; a trailing comma ("12,") counts as the whole number. */
  private readonly typedValue = computed(() => {
    const text = this.received().replace(/,$/, '');
    if (text === '') return Decimal.zero(MONEY_SCALE);
    const parsed = validateOpeningFloat(text);
    return parsed.ok ? parsed.value : Decimal.zero(MONEY_SCALE);
  });
  private readonly tendered = computed(() => validateCashTendered(this.totalAmount(), this.received().replace(/,$/, '') || null));

  protected readonly receivedText = computed(() => this.typedValue().format());
  protected readonly changeText = computed(() => {
    const tendered = this.tendered();
    return (tendered.ok ? tendered.change : Decimal.zero(MONEY_SCALE)).format();
  });
  /** What is still missing while the cashier has typed something that does not cover the total. */
  protected readonly shortfallText = computed(() => {
    if (this.received() === '' || this.tendered().ok) return null;
    return this.totalAmount().sub(this.typedValue()).format();
  });
  protected readonly canConfirm = computed(() => this.tendered().ok && !this.busy());

  constructor() {
    // every opening starts empty: a previous amount never carries over to the next sale
    effect(() => {
      if (this.open()) untracked(() => this.received.set(''));
    });
  }

  protected isSelected(typed: string): boolean {
    return this.received() === typed;
  }

  protected pickAmount(typed: string, selected: boolean) {
    this.received.set(selected ? typed : '');
  }

  protected doConfirm() {
    const tendered = this.tendered();
    if (!tendered.ok || this.busy()) return;
    this.confirm.emit(tendered.received.toString());
  }

  protected onOpenChange(open: boolean) {
    if (!open) this.cancelled.emit();
  }

  /** The physical keyboard types like the touch keys; Enter confirms. */
  protected onKey(event: KeyboardEvent) {
    // a held key repeats: only the first press counts, or a held Enter would confirm and then press the next dialog too
    if (!this.open() || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const pad = this.pad();
    if (event.key === 'Enter') {
      // Enter on "Cancelar" or on the close button does what that button does; anywhere else (the keypad, a quick amount, the
      // dialog itself) it confirms, as the button says
      if (event.target instanceof HTMLElement && event.target.closest('[data-cancel], .close')) return;
      event.preventDefault();
      this.doConfirm();
      return;
    }
    if (!pad) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      pad.press(event.key);
    } else if (event.key === ',' || event.key === '.') {
      event.preventDefault();
      pad.press(',');
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      pad.backspace();
    }
  }
}
