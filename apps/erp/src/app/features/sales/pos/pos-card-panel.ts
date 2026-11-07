import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  type OnInit,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CARD_DECLINE_REASONS,
  Decimal,
  normalizeAuthorizationCode,
  type CardDeclineReason,
  type PosCardPayment,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  InputDirective,
  InputGroupComponent,
  NoteComponent,
  RadioComponent,
  RadioGroupComponent,
  SkeletonComponent,
} from '@rodasoft/ui';
import { type Observable } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { newIdempotencyKey } from './idempotency-key';
import { PosApi } from './pos-api.service';

type CardScreen = 'starting' | 'pending' | 'confirmed' | 'declined' | 'failed';

/** What the cashier is reporting while the terminal waits: the approval with its code, or the decline with its reason. */
type Reporting = 'approve' | 'decline' | null;

/** The reasons as the cashier reads them (Figma VP-12). */
export const CARD_DECLINE_LABELS: Readonly<Record<CardDeclineReason, string>> = {
  INSUFFICIENT_FUNDS: 'Fondos insuficientes',
  CARD_DECLINED: 'Tarjeta rechazada',
  TERMINAL_ERROR: 'Error del terminal',
  OTHER: 'Otro motivo',
};

/** The screen for a payment status; a cancelled attempt is shown like a declined one, so the cashier can retry. */
function screenOf(status: PosCardPayment['status']): CardScreen {
  if (status === 'CONFIRMED') return 'confirmed';
  if (status === 'PENDING') return 'pending';
  return 'declined';
}

/**
 * VP-12 · Cobrar con tarjeta (HU-VEN-10). Opens a card attempt for the frozen total and waits for the terminal. With the mock
 * provider (decision #8) the cashier reads the terminal and reports it: "Aprobado" with the voucher's authorization code, or
 * "Rechazado" with a reason. A decline is shown as in Figma VP-12: a danger note, "Reintentar cobro" (a new attempt) and "Cancelar"
 * in the dialog's footer, and the other methods as chips. The page decides what an approved payment means: this panel only
 * tells it (`confirmed`), and tells it when the cashier wants another method while the terminal waits (`changeMethod`) or when
 * the cart needs attention (`problem`).
 */
@Component({
  selector: 'rs-pos-card-panel',
  imports: [
    ButtonComponent,
    FieldComponent,
    InputDirective,
    InputGroupComponent,
    NoteComponent,
    RadioComponent,
    RadioGroupComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos-card-panel.html',
  styleUrl: './pos-card-panel.scss',
})
export class PosCardPanel implements OnInit {
  private readonly api = inject(PosApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The total the server froze (`pay`), a decimal string. */
  readonly total = input.required<string>();
  /** A card attempt the server already has for this cart (after a refresh): shown instead of opening a new one. */
  readonly resume = input<PosCardPayment | null>(null);
  /** The sale is being saved: the buttons wait. */
  readonly busy = input(false);

  /** The terminal approved: the page completes the sale with this payment. */
  readonly confirmed = output<PosCardPayment>();
  /** The cashier chose another way to pay (a pending attempt was dropped on the server). */
  readonly changeMethod = output<void>();
  /**
   * The terminal waits for an outcome, or the card is approved: the cart cannot go back. A waiting terminal may already have
   * charged the customer, so leaving takes an explicit answer ("Aprobado", "Rechazado" or "Cambiar forma de pago").
   */
  readonly lockedChange = output<boolean>();
  /** The server refused something the panel cannot fix (the cart changed, the shift closed…). */
  readonly problem = output<unknown>();

  private locked = false;

  protected readonly screen = signal<CardScreen>('starting');
  protected readonly payment = signal<PosCardPayment | null>(null);
  protected readonly reporting = signal<Reporting>(null);
  /** A call of the cashier is in flight. */
  protected readonly working = signal(false);

  protected readonly code = signal('');
  protected readonly codeError = signal<string | null>(null);
  protected readonly reason = signal<CardDeclineReason | null>(null);
  protected readonly reasons = CARD_DECLINE_REASONS.map((value) => ({ value, label: CARD_DECLINE_LABELS[value] }));

  /** The terminal declined: the dialog offers "Reintentar cobro" and lets the other methods be chosen (Figma VP-12). */
  readonly declined = computed(() => this.screen() === 'declined');
  protected readonly amountText = computed(() => Decimal.of(this.payment()?.amount ?? this.total()).format());
  protected readonly attempt = computed(() => this.payment()?.attempt ?? 1);
  protected readonly declineText = computed(() => {
    const reason = this.payment()?.declineReason;
    return reason ? CARD_DECLINE_LABELS[reason] : 'El cobro se canceló';
  });
  protected readonly disabled = computed(() => this.working() || this.busy());

  constructor() {
    // each screen replaces its buttons: focus moves to the main action of the new one, so a keyboard cashier is never left on nothing
    effect(() => {
      this.screen();
      this.reporting();
      afterNextRender(() => this.focusMainAction(), { injector: this.injector });
    });
  }

  ngOnInit() {
    const resumed = this.resume();
    if (resumed) this.adopt(resumed);
    else this.start();
  }

  /** Opens a card attempt ("Reintentar cobro" calls it too). Each attempt has its own key, so a retry never reuses a dead payment. */
  start() {
    this.screen.set('starting');
    this.payment.set(null);
    this.reporting.set(null);
    this.run(this.api.startCard({ idempotencyKey: newIdempotencyKey(), expectedTotal: this.total() }), 'failed');
  }

  protected openApproval() {
    this.code.set('');
    this.codeError.set(null);
    this.reporting.set('approve');
  }

  protected openDecline() {
    this.reason.set(null);
    this.reporting.set('decline');
  }

  protected closeReport() {
    this.reporting.set(null);
  }

  protected onCode(event: Event) {
    this.code.set((event.target as HTMLInputElement).value);
    this.codeError.set(null);
  }

  /** "Confirmar aprobación": the voucher's code is checked here and again on the server. */
  protected approve() {
    const current = this.payment();
    if (!current) return;
    const checked = normalizeAuthorizationCode(this.code());
    if (!checked.ok) {
      this.codeError.set('Ingresa el código de autorización del voucher (4 a 12 letras o números).');
      return;
    }
    this.run(this.api.confirmCard(current.paymentId, { outcome: 'APPROVED', authorizationCode: checked.code }));
  }

  /** "Confirmar rechazo": the reason is what the cashier sees on VP-12. */
  protected decline() {
    const current = this.payment();
    const reason = this.reason();
    if (!current || !reason) return;
    this.run(this.api.confirmCard(current.paymentId, { outcome: 'DECLINED', reason }));
  }

  /** "Cambiar forma de pago": drops a pending attempt on the server, then lets the page show the other methods. */
  protected switchMethod() {
    const current = this.payment();
    // nothing to drop when the attempt is already final or never opened
    if (!current || this.screen() !== 'pending') {
      this.changeMethod.emit();
      return;
    }
    this.working.set(true);
    this.api
      .cancelCard(current.paymentId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.working.set(false);
          this.changeMethod.emit();
        },
        error: (err: unknown) => {
          this.working.set(false);
          this.problem.emit(err);
        },
      });
  }

  /** Retries the completion of a sale whose answer was lost: the card is already approved. */
  protected retryConfirmed() {
    const current = this.payment();
    if (current && this.screen() === 'confirmed') this.confirmed.emit(current);
  }

  private focusMainAction() {
    this.host.nativeElement.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }

  private run(call: Observable<{ payment: PosCardPayment }>, onError?: CardScreen) {
    this.working.set(true);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ payment }) => {
        this.working.set(false);
        this.adopt(payment);
      },
      error: (err: unknown) => {
        this.working.set(false);
        // no answer at all: the cashier can try again; anything else is the page's to handle
        if (problemOf(err).status === 0 && onError) this.screen.set(onError);
        else this.problem.emit(err);
      },
    });
  }

  /** Shows what the server says about the payment. */
  private adopt(payment: PosCardPayment) {
    const before = this.screen();
    this.payment.set(payment);
    this.reporting.set(null);
    const next = screenOf(payment.status);
    this.screen.set(next);
    this.lock(next === 'pending' || next === 'confirmed');
    if (next === 'confirmed' && before !== 'confirmed') this.confirmed.emit(payment);
  }

  /** Tells the dialog only when the lock changes. */
  private lock(value: boolean) {
    if (value === this.locked) return;
    this.locked = value;
    this.lockedChange.emit(value);
  }
}
