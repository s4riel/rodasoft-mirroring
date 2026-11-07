import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CANCELLATION_REPLY_MAX, type CancellationReview } from '@rodasoft/domain';
import {
  ButtonComponent,
  EmptyStateIllustratedComponent,
  FieldComponent,
  InputDirective,
  KpiCardComponent,
  ModalComponent,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs, formatDateTime } from '../cash/cash-format';
import { cancellationReasonLabel, elapsedText, historyLabel, impactSentence, invoiceLabel } from './sale-format';
import { SalesHistoryApi } from './sales-history-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'gone';
type Deciding = 'approve' | 'reject';

/** Someone else decided or withdrew the request in the meantime. */
const isNotPending = (code: string | undefined) => code === 'CANCELLATION_NOT_PENDING';

/**
 * VP-15c · Management decides a cancellation request (HU-VEN-15): the amount, the reason and what an approval will do, with a
 * reply for the cashier. Approving cancels the sale; rejecting needs the reply. Both end on the sale's detail (VP-15d).
 */
@Component({
  selector: 'rs-sale-cancellation-review-page',
  imports: [
    ButtonComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    InputDirective,
    KpiCardComponent,
    ModalComponent,
    NoteComponent,
    PageHeaderComponent,
    SkeletonComponent,
    StatusPillComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sale-cancellation-review.page.html',
  styleUrl: './sale-cancellation-review.page.scss',
})
export class SaleCancellationReviewPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(SalesHistoryApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly replyMax = CANCELLATION_REPLY_MAX;
  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly review = signal<CancellationReview | null>(null);

  protected readonly reply = signal('');
  /** Which decision is being sent; both buttons wait while one is. */
  protected readonly deciding = signal<Deciding | null>(null);
  protected readonly confirmOpen = signal(false);
  /** The reply is missing for a rejection. */
  protected readonly replyMissing = signal(false);
  protected readonly actionError = signal('');

  private readonly saleId = signal('');

  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Ventas realizadas', link: '/sales/history' },
    { label: this.review()?.saleNumber ?? 'Venta', link: `/sales/history/${this.saleId()}` },
    { label: 'Aprobar anulación' },
  ]);

  protected readonly subtitle = computed(() => {
    const r = this.review();
    return r ? `Solicitada por ${r.request.requestedBy} el ${formatDateTime(r.request.requestedAt)} · ${r.impact.warehouseName}` : '';
  });
  protected readonly amount = computed(() => formatBs(this.review()?.sale.total ?? '0'));
  protected readonly invoiceText = computed(() => {
    const i = this.review()?.sale.invoice;
    return i ? invoiceLabel(i.status, i.number) : '';
  });
  protected readonly reasonText = computed(() => cancellationReasonLabel(this.review()?.request.reason ?? ''));
  protected readonly elapsed = computed(() => elapsedText(this.review()?.sale.createdAt ?? new Date().toISOString(), new Date()));
  protected readonly willHappen = computed(() => {
    const r = this.review();
    return r ? impactSentence(r.impact) : '';
  });
  protected readonly audit = computed(() =>
    (this.review()?.audit ?? []).map((entry) => ({
      label: historyLabel({ action: entry.action, email: null }),
      when: entry.userName ? `${formatDateTime(entry.at)} · ${entry.userName}` : formatDateTime(entry.at),
    })),
  );
  /** The refund has nowhere to go: the register of the sale has no open shift. */
  protected readonly shiftClosed = computed(() => {
    const impact = this.review()?.impact;
    return !!impact && impact.cashRefund !== '0.00' && !impact.shiftOpen;
  });
  protected readonly invoiceBlocked = computed(() => this.review()?.impact.invoiceAction === 'BLOCKED');
  /** Figma says "…en el SIAT"; that is only true when the invoice was already issued, otherwise it is voided here. */
  protected readonly approveLabel = computed(() =>
    this.review()?.impact.invoiceAction === 'REQUEST_SIAT_CANCELLATION' ? 'Aprobar y anular en el SIAT' : 'Aprobar anulación',
  );
  protected readonly canApprove = computed(() => !this.shiftClosed() && !this.invoiceBlocked() && this.deciding() === null);

  ngOnInit() {
    this.saleId.set(this.route.snapshot.paramMap.get('id') ?? '');
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .cancellationReview(this.saleId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (review) => {
          this.review.set(review);
          this.state.set('ready');
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : isNotPending(problem.code) ? 'gone' : 'error');
        },
      });
  }

  protected setReply(value: string) {
    this.reply.set(value);
    if (value.trim() !== '') this.replyMissing.set(false);
  }

  /** Approving asks to confirm first: it moves stock and cash. */
  protected askApprove() {
    if (!this.canApprove()) return;
    this.actionError.set('');
    this.confirmOpen.set(true);
  }

  protected approve() {
    this.send('approve');
  }

  /** Rejecting needs the reply: it is what the cashier reads. */
  protected reject() {
    if (this.reply().trim() === '') {
      this.replyMissing.set(true);
      return;
    }
    this.send('reject');
  }

  private send(decision: Deciding) {
    if (this.deciding() !== null) return;
    this.deciding.set(decision);
    this.actionError.set('');
    const body = { comment: this.reply().trim() || undefined };
    const call = decision === 'approve' ? this.api.approveCancellation(this.saleId(), body) : this.api.rejectCancellation(this.saleId(), body);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.deciding.set(null);
        this.confirmOpen.set(false);
        // the detail shows how the sale ended (VP-15d)
        void this.router.navigate(['/sales/history', this.saleId()]);
      },
      error: (err: unknown) => {
        const problem = problemOf(err);
        this.deciding.set(null);
        this.confirmOpen.set(false);
        this.actionError.set(problem.message);
        // someone else may have decided in between, or the shift closed: show what the request is now
        if (isNotPending(problem.code)) this.state.set('gone');
        else this.refreshQuietly();
      },
    });
  }

  /** Reloads the request without the skeleton, so the error stays on screen. */
  private refreshQuietly() {
    this.api
      .cancellationReview(this.saleId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (review) => this.review.set(review), error: () => undefined });
  }

  protected backToSale() {
    void this.router.navigate(['/sales/history', this.saleId()]);
  }
}
