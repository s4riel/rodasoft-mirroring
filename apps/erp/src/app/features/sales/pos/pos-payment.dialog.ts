import { ChangeDetectionStrategy, Component, computed, effect, input, output, signal, untracked, viewChild } from '@angular/core';
import { Decimal, MONEY_SCALE, validateCashTendered, validateOpeningFloat, type PosCardPayment, type PosQrPayment } from '@rodasoft/domain';
import { ButtonComponent, ChipMediaComponent, FilterChipComponent, IconComponent, ModalComponent, NumpadComponent, groupThousands } from '@rodasoft/ui';
import { PosCardPanel } from './pos-card-panel';
import { PosMixedPanel, type PosMixedConfirmation } from './pos-mixed-panel';
import { PosQrPanel } from './pos-qr-panel';
import { typedAmount } from './typed-amount';

/** The ways to pay that have a screen so far (cash, QR, the two together and card); transfer and credit arrive with HU-VEN-34. */
export type PosPayMethod = 'CASH' | 'QR' | 'MIXED' | 'CARD';

export { typedAmount };

/**
 * VP-04 · Cobrar venta, in cash (HU-VEN-07) or by QR (HU-VEN-08). The total comes frozen from the server (`pay`); the cashier types what the
 * customer handed over on the keypad (or taps a quick amount) and sees the change. Confirming with less than the total is not
 * possible. The page decides what happens next: it sends `confirm` to the server and closes this dialog once the sale is saved.
 * Enter confirms, Esc cancels, digits and the comma type on the physical keyboard too.
 * With QR the panel (VP-04b) takes the body: the page completes the sale once the QR is confirmed, and the dialog cannot be
 * cancelled from then on, because the customer already paid. "Mixto" (VP-04c, HU-VEN-09) pays part by QR and the rest in cash
 * through its own panel, with the same lock once the QR is confirmed. "Tarjeta" (VP-12, HU-VEN-10) waits for the terminal: the
 * cashier reports it approved or declined, a decline offers a retry, and an approved card locks the dialog like a confirmed QR.
 */
@Component({
  selector: 'rs-pos-payment-dialog',
  imports: [ButtonComponent, ChipMediaComponent, FilterChipComponent, IconComponent, ModalComponent, NumpadComponent, PosCardPanel, PosMixedPanel, PosQrPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  templateUrl: './pos-payment.dialog.html',
  styleUrl: './pos-payment.dialog.scss',
})
export class PosPaymentDialog {
  private readonly pad = viewChild(NumpadComponent);
  private readonly modal = viewChild(ModalComponent);
  /** The mixed payment panel while "Mixto" is chosen: its form is confirmed from this dialog's footer. */
  protected readonly mixedPanel = viewChild(PosMixedPanel);
  /** The card panel while "Tarjeta" is chosen: its decline (VP-12) frees the other chips and shows "Reintentar cobro" here. */
  protected readonly cardPanel = viewChild(PosCardPanel);
  protected readonly cardDeclined = computed(() => this.cardPanel()?.declined() ?? false);
  /** A live card attempt holds the dialog: the other chips wait until it is declined (Figma VP-12). */
  private readonly cardHolds = computed(() => this.method() === 'CARD' && !this.cardDeclined());
  protected readonly cashChipDisabled = computed(() => this.method() !== 'CASH' && !this.cardDeclined());
  protected readonly qrChipDisabled = computed(() => this.busy() || this.method() === 'MIXED' || this.cardHolds());
  protected readonly cardChipDisabled = computed(() => !this.cardEnabled() || this.busy() || this.method() === 'QR' || this.method() === 'MIXED');
  protected readonly mixedChipDisabled = computed(() => this.busy() || this.method() === 'QR' || this.cardHolds());

  readonly open = input(false);
  /** The total to charge, a decimal string the server froze (`pay`). */
  readonly total = input.required<string>();
  /** The quick amounts the server suggests, decimal strings. */
  readonly suggested = input<string[]>([]);
  /** The sale is being saved: the buttons wait for the answer. */
  readonly busy = input(false);
  /** A QR the server already has for the cart (after a refresh): the dialog opens on it. */
  readonly resumeQr = input<PosQrPayment | null>(null);
  /** The company allows mixed payment (`sales.allowMixedPayment`); without it the "Mixto" chip is not drawn. */
  readonly allowMixed = input(true);
  /** The company takes cards (`sales.cardPaymentEnabled`); without it the "Tarjeta" chip is disabled. */
  readonly cardEnabled = input(true);
  /** A card attempt the server already has for the cart (after a refresh): the dialog opens on it. */
  readonly resumeCard = input<PosCardPayment | null>(null);

  /** The amount received, as a decimal string, when the cashier confirms. */
  readonly confirm = output<string>();
  /** "Cancelar", Esc or the close button: the page returns the cart to `OPEN`. */
  readonly cancelled = output<void>();
  /** The QR was confirmed: the page completes the sale with this payment. */
  readonly qrConfirmed = output<PosQrPayment>();
  /** The mixed panel has the QR paid and the cash typed: the page completes the sale with both. */
  readonly mixedConfirmed = output<PosMixedConfirmation>();
  /** The card was approved: the page completes the sale with this payment. */
  readonly cardConfirmed = output<PosCardPayment>();
  /** The server refused something the QR or card panel cannot fix. */
  readonly qrProblem = output<unknown>();

  protected readonly method = signal<PosPayMethod>('CASH');
  /** The QR was confirmed: there is no way back to the cart. */
  protected readonly locked = signal(false);
  /** The QR to resume, until the cashier changes method (a dropped QR is never resumed). */
  protected readonly resume = signal<PosQrPayment | null>(null);
  /** The card attempt to resume, until the cashier changes method. */
  protected readonly resumeCardPayment = signal<PosCardPayment | null>(null);

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
          this.resumeCardPayment.set(this.resumeCard());
          this.method.set(this.methodToResume());
          this.locked.set(false);
        });
    });
  }

  /** After a refresh: a QR that covers only part of the total belongs to a mixed payment. */
  private methodToResume(): PosPayMethod {
    if (this.resumeCard()) return 'CARD';
    const resumed = this.resumeQr();
    if (!resumed) return 'CASH';
    return Decimal.of(resumed.amount).cmp(this.totalAmount()) < 0 ? 'MIXED' : 'QR';
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
    // the X of the "Tarjeta" chip after a decline (Figma VP-12): the attempt is final, so the cashier simply leaves it
    if (!selected && method === 'CARD' && this.cardDeclined()) {
      this.backToCash();
      return;
    }
    if (!selected) {
      chip.selected.set(true);
      return;
    }
    this.method.set(method);
  }

  /** "Cambiar método" in the QR panel: the QR is dropped, back to cash. */
  protected backToCash() {
    this.resume.set(null);
    this.resumeCardPayment.set(null);
    // the panel that locked the dialog is gone: a dropped or declined attempt holds nothing
    this.locked.set(false);
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
