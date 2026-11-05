import { ChangeDetectionStrategy, Component, computed, input, output, signal, type OnInit } from '@angular/core';
import {
  Decimal,
  isPartialAmount,
  mixedRemaining,
  MONEY_SCALE,
  validateMixedPayments,
  validateOpeningFloat,
  type PosQrPayment,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  NoteComponent,
  NumericInputDirective,
} from '@rodasoft/ui';
import { PosQrPanel } from './pos-qr-panel';
import { typedAmount } from './typed-amount';

/** The cash and the QR payment that, together, pay the sale. */
export interface PosMixedConfirmation {
  /** What the customer hands over in cash, a decimal string. */
  received: string;
  /** The QR payment, already confirmed. */
  payment: PosQrPayment;
}

type MixedStep = 'form' | 'qr';

/** Parses what the field holds ("300", "300,5", "12,") into money; anything unreadable is 0. */
function parseTyped(text: string): Decimal {
  const clean = text.trim().replace(/,$/, '');
  if (clean === '') return Decimal.zero(MONEY_SCALE);
  const parsed = validateOpeningFloat(clean);
  return parsed.ok ? parsed.value : Decimal.zero(MONEY_SCALE);
}

/**
 * VP-04c · Cobrar con pago mixto (HU-VEN-09, decision #7): the total is split between cash and QR in two amount fields, with a
 * "Pagado / Restante" card that shows how much is still uncovered. Typing the QR part fills the cash with the rest (the cashier
 * can change it, e.g. when the customer hands over a bigger note). "Confirmar cobro" (the dialog's footer button, `submit`) opens
 * the QR for its part (VP-04b); once the customer pays it the panel tells the page (`confirmed`), which completes the sale with
 * both payments. Once the QR is confirmed the customer already paid that part, so the dialog cannot be cancelled
 * (`lockedChange`) and the QR field is fixed.
 */
@Component({
  selector: 'rs-pos-mixed-panel',
  imports: [
    ButtonComponent,
    FieldComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    NoteComponent,
    NumericInputDirective,
    PosQrPanel,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.enter)': 'onEnter($event)' },
  templateUrl: './pos-mixed-panel.html',
  styleUrl: './pos-mixed-panel.scss',
})
export class PosMixedPanel implements OnInit {
  /** The total the server froze (`pay`), a decimal string. */
  readonly total = input.required<string>();
  /** A QR the server already has for this cart (after a refresh): the panel continues from it. */
  readonly resume = input<PosQrPayment | null>(null);
  /** The sale is being saved: the buttons wait. */
  readonly busy = input(false);

  /** The QR is paid: the page completes the sale with the cash and this payment. */
  readonly confirmed = output<PosMixedConfirmation>();
  /** The cashier wants another way to pay; nothing was charged yet. */
  readonly changeMethod = output<void>();
  /** The QR is confirmed: the cart can no longer go back. */
  readonly lockedChange = output<boolean>();
  /** The server refused something the panel cannot fix. */
  readonly problem = output<unknown>();

  protected readonly step = signal<MixedStep>('form');
  /** What the two fields hold. */
  protected readonly cashTyped = signal('');
  protected readonly qrTyped = signal('');
  /** The cashier changed the cash by hand: typing the QR part no longer overwrites it. */
  private cashEdited = false;
  /** The QR of this payment once it is confirmed (or resumed as confirmed). */
  protected readonly payment = signal<PosQrPayment | null>(null);
  /** The pending QR to resume in the QR step, until the cashier goes back to the form. */
  protected readonly qrResume = signal<PosQrPayment | null>(null);

  private readonly totalAmount = computed(() => Decimal.of(this.total()));
  private readonly qrValue = computed(() => parseTyped(this.qrTyped()));
  private readonly cashValue = computed(() => parseTyped(this.cashTyped()));
  private readonly qrValid = computed(() => isPartialAmount(this.totalAmount(), this.qrValue()));
  /** The amount sent to the server when the QR opens, a decimal string. */
  protected readonly qrAmountParam = computed(() => (this.qrValid() ? this.qrValue().round(MONEY_SCALE).toString() : null));
  /** What the QR covers: the stored payment, or what is typed while it is a valid part of the total. */
  private readonly qrAmount = computed(() => {
    const paid = this.payment();
    if (paid) return Decimal.of(paid.amount);
    return this.qrValid() ? this.qrValue() : Decimal.zero(MONEY_SCALE);
  });

  private readonly mix = computed(() =>
    validateMixedPayments(
      this.totalAmount(),
      [
        { method: 'CASH', amount: this.cashValue() },
        { method: 'QR', amount: this.qrAmount() },
      ],
      true,
    ),
  );
  private readonly paid = computed(() => this.cashValue().add(this.qrAmount()));
  private readonly remaining = computed(() =>
    mixedRemaining(this.totalAmount(), [
      { method: 'CASH', amount: this.cashValue() },
      { method: 'QR', amount: this.qrAmount() },
    ]),
  );

  protected readonly paidText = computed(() => this.paid().format());
  protected readonly remainingText = computed(() => this.remaining().format());
  protected readonly covered = computed(() => this.remaining().isZero() && this.mix().ok);
  protected readonly changeText = computed(() => {
    const mix = this.mix();
    return mix.ok ? mix.change.format() : null;
  });
  protected readonly qrError = computed(() =>
    this.payment() === null && this.qrTyped().trim() !== '' && !this.qrValid()
      ? 'El monto por QR debe ser mayor que cero y menor que el total.'
      : null,
  );

  /** The dialog's "Confirmar cobro" shows with the form, not while the QR waits. */
  readonly showSubmit = computed(() => this.step() === 'form');
  /** Both amounts are valid and cover the total. */
  readonly canSubmit = computed(() => this.mix().ok && !this.busy());

  ngOnInit() {
    const resumed = this.resume();
    if (!resumed) return;
    const part = typedAmount(Decimal.of(resumed.amount));
    this.qrTyped.set(part);
    this.cashTyped.set(typedAmount(this.totalAmount().sub(Decimal.of(resumed.amount))));
    if (resumed.status === 'CONFIRMED') {
      this.payment.set(resumed);
      this.lockedChange.emit(true);
    } else {
      this.qrResume.set(resumed);
      this.step.set('qr');
    }
  }

  protected onQr(event: Event) {
    const text = (event.target as HTMLInputElement).value;
    this.qrTyped.set(text);
    // the cash is the rest of the total until the cashier types it himself
    if (!this.cashEdited) {
      const qr = parseTyped(text);
      this.cashTyped.set(isPartialAmount(this.totalAmount(), qr) ? typedAmount(this.totalAmount().sub(qr)) : '');
    }
  }

  protected onCash(event: Event) {
    this.cashEdited = true;
    this.cashTyped.set((event.target as HTMLInputElement).value);
  }

  /** Enter in a field confirms, like the footer button. */
  protected onEnter(event: Event) {
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    this.submit();
  }

  /** "Confirmar cobro": opens the QR for its part; with the QR already paid (a refresh) it completes the sale. */
  submit() {
    if (!this.canSubmit() || this.step() !== 'form') return;
    const paid = this.payment();
    if (paid) this.confirmed.emit({ received: this.cashValue().round(MONEY_SCALE).toString(), payment: paid });
    else this.step.set('qr');
  }

  /** The QR panel dropped its QR ("Cambiar forma de pago"): back to the form with the amounts kept. */
  protected backToForm() {
    this.qrResume.set(null);
    this.step.set('form');
  }

  /** The customer paid the QR part: the page completes the sale with the cash typed here. */
  protected onQrConfirmed(payment: PosQrPayment) {
    this.payment.set(payment);
    this.confirmed.emit({ received: this.cashValue().round(MONEY_SCALE).toString(), payment });
  }
}
