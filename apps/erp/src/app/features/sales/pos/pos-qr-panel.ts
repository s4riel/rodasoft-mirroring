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
import { Decimal, type PosQrOutcome, type PosQrPayment } from '@rodasoft/domain';
import { ButtonComponent, NoteComponent, QrCodeComponent, SkeletonComponent } from '@rodasoft/ui';
import { catchError, EMPTY, filter, interval, switchMap, type Observable } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { newIdempotencyKey } from './idempotency-key';
import { PosApi } from './pos-api.service';

/** How often the screen asks the server whether the customer paid. */
export const QR_POLL_MS = 2000;

/** How often the countdown redraws. */
const CLOCK_TICK_MS = 1000;

type QrScreen = 'starting' | 'pending' | 'confirmed' | 'declined' | 'expired' | 'failed';

/** The screen for a payment status; anything that is not pending, confirmed or declined is a dead (cancelled) QR. */
function screenOf(status: PosQrPayment['status']): QrScreen {
  if (status === 'CONFIRMED') return 'confirmed';
  if (status === 'PENDING') return 'pending';
  if (status === 'DECLINED') return 'declined';
  return 'expired';
}

/**
 * VP-04b · Cobrar con QR (HU-VEN-08). Opens the QR for the frozen total, draws it with the amount and waits. With the mock
 * provider (decision #6) the cashier reports the outcome ("Pago recibido" / "Pago no recibido"); a real provider would confirm
 * on its own and the polling below would pick it up unchanged. The page decides what a confirmed payment means: this panel only
 * tells it (`confirmed`), and tells it when the cashier wants another method (`changeMethod`) or the cart needs attention
 * (`problem`). Leaving the panel stops the polling.
 */
@Component({
  selector: 'rs-pos-qr-panel',
  imports: [ButtonComponent, NoteComponent, QrCodeComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos-qr-panel.html',
  styleUrl: './pos-qr-panel.scss',
})
export class PosQrPanel implements OnInit {
  private readonly api = inject(PosApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  /** The total the server froze (`pay`), a decimal string. */
  readonly total = input.required<string>();
  /** A QR the server already has for this cart (after a refresh): shown instead of opening a new one. */
  readonly resume = input<PosQrPayment | null>(null);
  /** The sale is being saved: the buttons wait. */
  readonly busy = input(false);

  /** The customer paid: the page completes the sale with this payment. */
  readonly confirmed = output<PosQrPayment>();
  /** The cashier chose another way to pay (the QR was dropped on the server). */
  readonly changeMethod = output<void>();
  /** The QR is confirmed: the cart can no longer go back, so the page keeps its cancel buttons off. */
  readonly lockedChange = output<boolean>();
  /** The server refused something the panel cannot fix (the cart changed, the shift closed…). */
  readonly problem = output<unknown>();

  protected readonly screen = signal<QrScreen>('starting');
  protected readonly payment = signal<PosQrPayment | null>(null);
  /** A call of the cashier is in flight. */
  protected readonly working = signal(false);
  /** The wall clock, once a second, for the countdown. */
  private readonly now = signal(Date.now());

  protected readonly amountText = computed(() => Decimal.of(this.payment()?.amount ?? this.total()).format());
  protected readonly secondsLeft = computed(() => {
    const payment = this.payment();
    if (!payment || this.screen() !== 'pending') return 0;
    return Math.max(0, Math.ceil((new Date(payment.expiresAt).getTime() - this.now()) / 1000));
  });
  protected readonly countdown = computed(() => {
    const left = this.secondsLeft();
    return `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
  });
  protected readonly disabled = computed(() => this.working() || this.busy());

  constructor() {
    // each screen replaces its buttons: focus moves to the main action of the new one, so a keyboard cashier is never left on nothing
    effect(() => {
      this.screen();
      afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('[data-autofocus]')?.focus(), { injector: this.injector });
    });
    interval(CLOCK_TICK_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.now.set(Date.now()));
    // the server cancels a QR past its deadline; asking again is how the screen finds out
    interval(QR_POLL_MS)
      .pipe(
        filter(() => this.screen() === 'pending' && !this.working()),
        switchMap(() => {
          const current = this.payment();
          return current ? this.api.qrPayment(current.paymentId).pipe(catchError(() => EMPTY)) : EMPTY;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ payment }) => this.adopt(payment));
  }

  ngOnInit() {
    const resumed = this.resume();
    if (resumed) this.adopt(resumed);
    else this.start();
  }

  /** Opens a QR. Each attempt has its own key, so a retry after a failure never reuses a dead payment. */
  protected start() {
    this.screen.set('starting');
    this.payment.set(null);
    this.run(this.api.startQr({ idempotencyKey: newIdempotencyKey(), expectedTotal: this.total() }), 'failed');
  }

  /** "Pago recibido" / "Pago no recibido": the cashier reports what happened. */
  protected report(outcome: PosQrOutcome) {
    const current = this.payment();
    if (current) this.run(this.api.confirmQr(current.paymentId, outcome));
  }

  /** "Cambiar método": drops the QR on the server, then lets the page show the other methods. */
  protected switchMethod() {
    const current = this.payment();
    // nothing to drop when the QR is already dead or never opened
    if (!current || this.screen() !== 'pending') {
      this.changeMethod.emit();
      return;
    }
    this.working.set(true);
    this.api
      .cancelQr(current.paymentId)
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

  /** Retries the completion of a sale whose answer was lost: the payment is already confirmed. */
  protected retryConfirmed() {
    const current = this.payment();
    if (current && this.screen() === 'confirmed') this.confirmed.emit(current);
  }

  private run(call: Observable<{ payment: PosQrPayment }>, onError?: QrScreen) {
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
  private adopt(payment: PosQrPayment) {
    const before = this.screen();
    this.payment.set(payment);
    const next = screenOf(payment.status);
    this.screen.set(next);
    if (next === 'confirmed' && before !== 'confirmed') {
      this.lockedChange.emit(true);
      this.confirmed.emit(payment);
    }
  }

  protected readonly screenIs = (screen: QrScreen) => this.screen() === screen;
}
