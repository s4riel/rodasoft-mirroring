import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CASH_REVIEW_NOTE_MAX, Decimal, type CashShiftReview, type CashShiftReviewDecision } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DataFieldComponent,
  DocTableColumn,
  DocTableComponent,
  type DocTableRow,
  EmptyStateIllustratedComponent,
  FieldComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
  TextareaDirective,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { CashApi } from './cash-api.service';
import { formatBs, formatDateTime, formatSchedule, formatSignedBs, METHOD_LABELS, SHIFT_STATUS_PILLS, timelineText } from './cash-format';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'gone';

/** The columns of the "Por forma de pago" table of VP-06b. */
const METHOD_COLUMNS: DocTableColumn[] = [
  { key: 'method', label: 'Forma', type: 'text' },
  { key: 'system', label: 'Sistema', type: 'number', width: '9rem' },
  { key: 'declared', label: 'Contado o confirmado', type: 'number', width: '12rem' },
  { key: 'difference', label: 'Diferencia', type: 'number', width: '9rem' },
];

/**
 * VP-06b · Revisar cierre (HU-VEN-24, decision #17). Accounting reads the difference of a closing, the cashier's justification,
 * the totals per payment method and the audit trail, and approves it or asks for a recount with a comment. The cashier of the
 * shift opens the same screen read-only; once decided it shows the answer.
 */
@Component({
  selector: 'rs-cash-shift-review-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DataFieldComponent,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    RouterLink,
    SkeletonComponent,
    StatusPillComponent,
    TextareaDirective,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cash-shift-review.page.html',
  styleUrl: './cash-shift-review.page.scss',
})
export class CashShiftReviewPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(CashApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly replyMax = CASH_REVIEW_NOTE_MAX;
  protected readonly methodColumns = METHOD_COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 4 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly review = signal<CashShiftReview | null>(null);
  protected readonly reply = signal('');
  protected readonly deciding = signal<CashShiftReviewDecision | null>(null);
  protected readonly replyMissing = signal(false);
  protected readonly actionError = signal('');
  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Revisión de cierre' },
  ];

  private readonly shiftId = signal('');

  protected readonly title = computed(() => {
    const r = this.review();
    if (!r) return 'Revisar cierre';
    return `${r.canDecide ? 'Revisar cierre' : 'Cierre de caja'} · ${r.register.name}`;
  });
  protected readonly description = computed(() => {
    const r = this.review();
    return r ? `Turno ${r.number} de ${r.cashier.name} · ${formatSchedule(r.openedAt, r.closedAt)} · ${r.branch.name}` : '';
  });
  protected readonly pill = computed(() => {
    const r = this.review();
    return r ? SHIFT_STATUS_PILLS[r.displayStatus] : null;
  });
  protected readonly stats = computed(() => {
    const r = this.review();
    const difference = r?.difference ?? null;
    return {
      expected: r?.expected ? formatBs(r.expected) : '—',
      counted: r?.counted ? formatBs(r.counted) : '—',
      difference: formatSignedBs(difference),
      // a shortage is the bad news of the screen; a surplus is only flagged
      differenceTrend: difference !== null && Decimal.of(difference).isNegative() ? ('negative' as const) : ('neutral' as const),
      sales: formatBs(r?.sales.total ?? '0'),
    };
  });
  protected readonly depositText = computed(() => {
    const r = this.review();
    return r?.deposit && r.closingFloat ? `${formatBs(r.deposit)} a banco · ${formatBs(r.closingFloat)} quedan en caja` : '';
  });
  protected readonly methodRows = computed<DocTableRow[]>(() =>
    (this.review()?.methods ?? []).map((row) => ({
      id: row.method,
      label: METHOD_LABELS[row.method],
      cells: {
        method: METHOD_LABELS[row.method],
        system: formatBs(row.system),
        declared: formatBs(row.declared),
        difference: formatSignedBs(row.difference),
      },
    })),
  );
  protected readonly timeline = computed(() =>
    (this.review()?.timeline ?? []).map((entry) => ({ at: formatDateTime(entry.at), text: timelineText(entry) })),
  );
  protected readonly decisionTitle = computed(() => {
    const r = this.review();
    if (!r?.review) return '';
    const verb = r.status === 'OBSERVED' ? 'Recuento pedido' : 'Cierre aprobado';
    return `${verb} por ${r.review.by.name} el ${formatDateTime(r.review.at)}`;
  });

  ngOnInit() {
    this.shiftId.set(this.route.snapshot.paramMap.get('id') ?? '');
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .review(this.shiftId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (review) => {
          this.review.set(review);
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

  /** Asking for a recount needs the answer: it is what the cashier reads. */
  protected observe() {
    if (this.reply().trim() === '') {
      this.replyMissing.set(true);
      return;
    }
    this.send('observe');
  }

  private send(decision: CashShiftReviewDecision) {
    if (this.deciding() !== null) return;
    this.deciding.set(decision);
    this.actionError.set('');
    const body = { comment: this.reply().trim() || undefined };
    const call = decision === 'approve' ? this.api.approveShift(this.shiftId(), body) : this.api.observeShift(this.shiftId(), body);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (review) => {
        this.deciding.set(null);
        this.reply.set('');
        this.review.set(review);
        this.toast.success(decision === 'approve' ? 'Cierre aprobado' : 'Recuento pedido al cajero');
      },
      error: (err: unknown) => {
        this.deciding.set(null);
        this.actionError.set(problemOf(err).message);
        // someone else may have decided in between: show what the closing is now
        this.refreshQuietly();
      },
    });
  }

  /** Reloads the closing without the skeleton, so the error stays on screen. */
  private refreshQuietly() {
    this.api
      .review(this.shiftId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (review) => this.review.set(review), error: () => undefined });
  }
}
