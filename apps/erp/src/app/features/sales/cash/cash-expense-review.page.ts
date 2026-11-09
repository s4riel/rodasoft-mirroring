import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CashMovementDetail } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DataFieldComponent,
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
import { formatBs, formatDateTime, movementConceptLabel, movementStatusPill } from './cash-format';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'gone';
type Deciding = 'approve' | 'reject' | 'withdraw';

const REPLY_MAX = 500;

/**
 * Revisión de un egreso de caja (HU-VEN-22, decision #16). The detail of an expense above the company limit: amount, concept,
 * cashier, time and receipt, and, for who may approve cash expenses, the decision card (Figma 103:18941). Management reaches it
 * from the cashier's row menu or its URL until the approvals inbox (HU-VEN-29) lists it.
 */
@Component({
  selector: 'rs-cash-expense-review-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DataFieldComponent,
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
  templateUrl: './cash-expense-review.page.html',
  styleUrl: './cash-expense-review.page.scss',
})
export class CashExpenseReviewPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(CashApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly replyMax = REPLY_MAX;
  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly movement = signal<CashMovementDetail | null>(null);
  protected readonly reply = signal('');
  protected readonly deciding = signal<Deciding | null>(null);
  protected readonly replyMissing = signal(false);
  protected readonly actionError = signal('');
  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Caja', link: '/sales/cash-register' },
    { label: 'Egreso de caja' },
  ];

  private readonly movementId = signal('');

  protected readonly amount = computed(() => formatBs(this.movement()?.amount ?? '0'));
  protected readonly concept = computed(() => {
    const m = this.movement();
    return m ? movementConceptLabel({ type: m.type, concept: m.concept, detail: null }) : '';
  });
  protected readonly pill = computed(() => {
    const m = this.movement();
    return m ? (movementStatusPill(m.status) ?? { label: 'Aprobado', status: 'success' as const }) : null;
  });
  protected readonly when = computed(() => formatDateTime(this.movement()?.createdAt ?? new Date().toISOString()));
  protected readonly decisionText = computed(() => {
    const approval = this.movement()?.approval;
    const m = this.movement();
    if (!approval?.decidedBy || !approval.decidedAt || !m) return '';
    const verb = m.status === 'POSTED' ? 'Aprobado' : m.status === 'REJECTED' ? 'Rechazado' : 'Retirado';
    return `${verb} por ${approval.decidedBy.name} el ${formatDateTime(approval.decidedAt)}`;
  });

  ngOnInit() {
    this.movementId.set(this.route.snapshot.paramMap.get('id') ?? '');
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .movement(this.movementId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (movement) => {
          this.movement.set(movement);
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

  protected withdraw() {
    this.send('withdraw');
  }

  protected openReceipt() {
    this.api
      .receipt(this.movementId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => window.open(URL.createObjectURL(blob), '_blank', 'noopener'),
        error: (err: unknown) => this.actionError.set(problemOf(err).message),
      });
  }

  protected back() {
    void this.router.navigate(['/sales/cash-register']);
  }

  private send(decision: Deciding) {
    if (this.deciding() !== null) return;
    this.deciding.set(decision);
    this.actionError.set('');
    const body = { comment: this.reply().trim() || undefined };
    const id = this.movementId();
    const call = decision === 'approve' ? this.api.approve(id, body) : decision === 'reject' ? this.api.reject(id, body) : this.api.withdraw(id);
    call.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (movement) => {
        this.deciding.set(null);
        this.reply.set('');
        this.movement.set(movement);
        this.toast.success(decision === 'approve' ? 'Egreso aprobado' : decision === 'reject' ? 'Egreso rechazado' : 'Solicitud retirada');
      },
      error: (err: unknown) => {
        this.deciding.set(null);
        this.actionError.set(problemOf(err).message);
        // someone else may have decided in between, or the drawer emptied: show what the expense is now
        this.refreshQuietly();
      },
    });
  }

  /** Reloads the expense without the skeleton, so the error stays on screen. */
  private refreshQuietly() {
    this.api
      .movement(this.movementId())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (movement) => this.movement.set(movement), error: () => undefined });
  }
}
