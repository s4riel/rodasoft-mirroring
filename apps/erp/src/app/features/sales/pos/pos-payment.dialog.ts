import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked, viewChild } from '@angular/core';
import { Decimal, MONEY_SCALE, validateCashTendered, validateOpeningFloat, type PosQrPayment } from '@rodasoft/domain';
import { ButtonComponent, ChipMediaComponent, FilterChipComponent, IconComponent, ModalComponent, NumpadComponent, groupThousands } from '@rodasoft/ui';
import { PosQrPanel } from './pos-qr-panel';

/** The ways to pay that have a screen so far; card, transfer, credit and mixed arrive with HU-VEN-09, 10 and 34. */
export type PosPayMethod = 'CASH' | 'QR';

/** What the amount looks like when typed: no cents when there are none ("1150"), a comma otherwise ("1150,5"). */
export function typedAmount(amount: Decimal): string {
  const [integer, cents] = amount.round(MONEY_SCALE).toString().split('.');
  return cents === '00' ? integer : `${integer},${cents.replace(/0$/, '')}`;
}

/**
 * VP-04 · Cobrar venta, in cash (HU-VEN-07) or by QR (HU-VEN-08). The total comes frozen from the server (`pay`); the cashier types what the
 * customer handed over on the keypad (or taps a quick amount) and sees the change. Confirming with less than the total is not
 * possible. The page decides what happens next: it sends `confirm` to the server and closes this dialog once the sale is saved.
 * Enter confirms, Esc cancels, digits and the comma type on the physical keyboard too.
 * With QR the panel (VP-04b) takes the body: the page completes the sale once the QR is confirmed, and the dialog cannot be
 * cancelled from then on, because the customer already paid.
 */
@Component({
  selector: 'rs-pos-payment-dialog',
  imports: [ButtonComponent, ChipMediaComponent, FilterChipComponent, IconComponent, ModalComponent, NumpadComponent, PosQrPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  templateUrl: './pos-payment.dialog.html',
  styleUrl: './pos-payment.dialog.scss',
})
export class PosPaymentDialog {
  private readonly pad = viewChild(NumpadComponent);
  private readonly modal = viewChild(ModalComponent);

  readonly open = input(false);
  /** The total to charge, a decimal string the server froze (`pay`). */
  readonly total = input.required<string>();
  /** The quick amounts the server suggests, decimal strings. */
  readonly suggested = input<string[]>([]);
  /** The sale is being saved: the buttons wait for the answer. */
  readonly busy = input(false);
  /** A QR the server already has for the cart (after a refresh): the dialog opens on it. */
  readonly resumeQr = input<PosQrPayment | null>(null);

  /** The amount received, as a decimal string, when the cashier confirms. */
  readonly confirm = output<string>();
  /** "Cancelar", Esc or the close button: the page returns the cart to `OPEN`. */
  readonly cancelled = output<void>();
  /** The QR was confirmed: the page completes the sale with this payment. */
  readonly qrConfirmed = output<PosQrPayment>();
  /** The server refused something the QR panel cannot fix. */
  readonly qrProblem = output<unknown>();

  protected readonly method = signal<PosPayMethod>('CASH');
  /** The QR was confirmed: there is no way back to the cart. */
  protected readonly locked = signal(false);
  /** The QR to resume, until the cashier changes method (a dropped QR is never resumed). */
  protected readonly resume = signal<PosQrPayment | null>(null);

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
      if (this.open())
        untracked(() => {
          this.received.set('');
          this.resume.set(this.resumeQr());
          this.method.set(this.resumeQr() ? 'QR' : 'CASH');
          this.locked.set(false);
        });
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
    if (open) return;
    // a confirmed QR cannot be dropped and a sale being saved cannot be cancelled: the modal closed itself on Esc or the X, so
    // it opens again (the parent still says it is open, and only a changed value would reopen it)
    if (this.locked() || this.busy()) {
      this.modal()?.open.set(true);
      return;
    }
    this.cancelled.emit();
  }

  /** A method chip: choosing the selected one again does nothing; the other chip is locked while its panel is active. */
  protected pickMethod(method: PosPayMethod, selected: boolean, chip: { selected: { set(value: boolean): void } }) {
    if (!selected) {
      chip.selected.set(true);
      return;
    }
    this.method.set(method);
  }

  /** "Cambiar método" in the QR panel: the QR is dropped, back to cash. */
  protected backToCash() {
    this.resume.set(null);
    this.method.set('CASH');
  }

  /** The physical keyboard types like the touch keys; Enter confirms. */
  protected onKey(event: KeyboardEvent) {
    // a held key repeats: only the first press counts, or a held Enter would confirm and then press the next dialog too
    if (!this.open() || this.method() !== 'CASH' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
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
