import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { RETURN_COMMENT_MAX, type SaleReturnDetail } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  EmptyStateIllustratedComponent,
  FieldComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
  StatusTimelineComponent,
  TextareaDirective,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs, formatDateTime } from '../cash/cash-format';
import { ReturnsApi } from './returns-api.service';
import { CONDITION_LABELS, creditNoteText, refundText, returnAuditLabel, returnReasonLabel, returnStatusPill, timelineSteps } from './returns-format';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'gone';
type Deciding = 'approve' | 'reject';

/**
 * VP-21 · Return detail (HU-VEN-21): what came back and where it went, the timeline with the credit note and the refund, the
 * audit, and, for who may approve returns, the decision of a return that is waiting for it.
 */
@Component({
  selector: 'rs-return-detail-page',
  imports: [
    ButtonComponent,
    CanDirective,
    EmptyStateIllustratedComponent,
    FieldComponent,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    RouterLink,
    SkeletonComponent,
    StatusPillComponent,
    StatusTimelineComponent,
    TextareaDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './return-detail.page.html',
  styleUrl: './return-detail.page.scss',
})
export class ReturnDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ReturnsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly replyMax = RETURN_COMMENT_MAX;
  protected readonly conditionLabels = CONDITION_LABELS;
  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly detail = signal<SaleReturnDetail | null>(null);

  protected readonly reply = signal('');
  protected readonly deciding = signal<Deciding | null>(null);
  protected readonly replyMissing = signal(false);
  protected readonly actionError = signal('');

  private readonly returnId = signal('');

  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Devoluciones', link: '/sales/returns' },
    { label: this.detail()?.number ?? 'Devolución' },
  ]);
  protected readonly title = computed(() => (this.detail() ? `Devolución ${this.detail()!.number}` : 'Devolución'));
  protected readonly subtitle = computed(() => {
    const d = this.detail();
    if (!d) return '';
    return `${d.customerName ?? 'Consumidor final'} · Venta ${d.saleNumber} · ${formatDateTime(d.createdAt)}`;
  });
  protected readonly pill = computed(() => {
    const d = this.detail();
    return d ? returnStatusPill(d) : null;
  });
  protected readonly steps = computed(() => {
    const d = this.detail();
    return d ? timelineSteps(d) : [];
  });
  protected readonly amount = computed(() => formatBs(this.detail()?.total ?? '0'));
  protected readonly noteText = computed(() => {
    const d = this.detail();
    return d ? `Nota de crédito y débito · ${creditNoteText(d)}` : '';
  });
  protected readonly refund = computed(() => {
    const d = this.detail();
    return d ? refundText(d) : '';
  });
  protected readonly reasonText = computed(() => returnReasonLabel(this.detail()?.reason ?? ''));
  protected readonly items = computed(() =>
    (this.detail()?.items ?? []).map((item) => ({
      key: `${item.saleItemId}-${item.condition}`,
      name: item.productName,
      sku: item.sku,
      quantity: item.quantity,
      destination: CONDITION_LABELS[item.condition],
      amount: formatBs(item.refundAmount),
    })),
  );
  protected readonly audit = computed(() =>
    (this.detail()?.audit ?? []).map((entry) => ({
      label: returnAuditLabel(entry.action),
      when: entry.userName ? `${formatDateTime(entry.at)} · ${entry.userName}` : formatDateTime(entry.at),
    })),
  );
  protected readonly decisionText = computed(() => {
    const d = this.detail()?.decision;
    return d ? `${d.status === 'APPROVED' ? 'Aprobada' : 'Rechazada'} por ${d.decidedBy} el ${formatDateTime(d.decidedAt)}` : '';
  });
  protected readonly canDecide = computed(() => this.detail()?.status === 'PENDING_APPROVAL' && this.detail()?.approval != null);

  ngOnInit() {
    this.returnId.set(this.route.snapshot.paramMap.get('id') ?? '');
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .detail(this.returnId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.state.set('ready');
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : problem.status === 404 ? 'gone' : 'error');
        },
      });
  }

  protected setReply(value: string) {
    this.reply.set(value);
    if (value.trim() !== '') this.replyMissing.set(false);
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
    const call = decision === 'approve' ? this.api.approve(this.returnId(), body) : this.api.reject(this.returnId(), body);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (detail) => {
        this.deciding.set(null);
        this.reply.set('');
        this.detail.set(detail);
      },
      error: (err: unknown) => {
        const problem = problemOf(err);
        this.deciding.set(null);
        this.actionError.set(problem.message);
        // someone else may have decided in between, or the shift closed: show what the return is now
        this.refreshQuietly();
      },
    });
  }

  /** Reloads the return without the skeleton, so the error stays on screen. */
  private refreshQuietly() {
    this.api
      .detail(this.returnId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (detail) => this.detail.set(detail), error: () => undefined });
  }

  protected backToList() {
    void this.router.navigate(['/sales/returns']);
  }
}
