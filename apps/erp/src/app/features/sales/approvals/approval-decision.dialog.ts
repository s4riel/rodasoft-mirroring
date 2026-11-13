import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { APPROVAL_COMMENT_MAX, type ApprovalInboxItem } from '@rodasoft/domain';
import { ButtonComponent, FieldComponent, ModalComponent, NoteComponent, TextareaDirective, ToastService } from '@rodasoft/ui';
import type { Observable } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { InvoicingApi } from '../../invoicing/invoicing-api.service';
import { CashApi } from '../cash/cash-api.service';
import { ReturnsApi } from '../returns/returns-api.service';
import { approvalAmount, approvalDescription, approvalTitle, decisionHeading } from './approval-format';

export type ApprovalDecision = 'approve' | 'reject';

/** `done`: the request was decided. `stale`: someone else decided it first, so the inbox must read again. */
export type ApprovalDecisionOutcome = 'done' | 'stale';

/** The codes that say the request no longer waits for a decision. */
const NOT_PENDING_CODES = new Set(['RETURN_NOT_PENDING', 'CASH_MOVEMENT_NOT_PENDING', 'NIT_EXCEPTION_NOT_PENDING']);

/**
 * VP-25 · Aprobar / Rechazar from the inbox (HU-VEN-29). It decides a return or a cash expense through the endpoint of its own
 * type, so the audit entry, the state machine and the side effects (stock, cash refund, cash out) are the same as from the detail
 * page. Rejecting needs the reply for the cashier; approving takes an optional one.
 */
@Component({
  selector: 'rs-approval-decision-dialog',
  imports: [ButtonComponent, FieldComponent, ModalComponent, NoteComponent, TextareaDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './approval-decision.dialog.html',
  styleUrl: './approval-decision.dialog.scss',
})
export class ApprovalDecisionDialog {
  private readonly returns = inject(ReturnsApi);
  private readonly cash = inject(CashApi);
  private readonly invoicing = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly item = input<ApprovalInboxItem | null>(null);
  readonly decision = input<ApprovalDecision>('approve');
  readonly decided = output<ApprovalDecisionOutcome>();

  protected readonly commentMax = APPROVAL_COMMENT_MAX;
  protected readonly comment = signal('');
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly submitError = signal<string | null>(null);

  protected readonly rejecting = computed(() => this.decision() === 'reject');
  protected readonly heading = computed(() => {
    const item = this.item();
    return item && (item.type === 'RETURN' || item.type === 'CASH_EXPENSE' || item.type === 'NIT_EXCEPTION') ? decisionHeading(item.type, this.decision()) : 'Decidir solicitud';
  });
  protected readonly title = computed(() => {
    const item = this.item();
    return item ? approvalTitle(item) : '';
  });
  protected readonly summary = computed(() => {
    const item = this.item();
    if (!item) return '';
    const amount = approvalAmount(item);
    return [approvalDescription(item), amount].filter(Boolean).join(' · ');
  });
  protected readonly label = computed(() => (this.rejecting() ? 'Motivo del rechazo' : 'Comentario (opcional)'));
  protected readonly commentError = computed(() => (this.submitted() && this.rejecting() && this.comment().trim() === '' ? 'Escribe el motivo: el cajero lo va a leer.' : ''));
  protected readonly confirmLabel = computed(() => (this.rejecting() ? 'Rechazar' : 'Aprobar'));

  constructor() {
    // every time the dialog opens it starts clean
    effect(() => {
      if (this.open()) {
        untracked(() => {
          this.comment.set('');
          this.submitted.set(false);
          this.saving.set(false);
          this.submitError.set(null);
        });
      }
    });
  }

  protected cancel() {
    if (!this.saving()) this.open.set(false);
  }

  protected submit() {
    const item = this.item();
    if (!item || this.saving()) return;
    this.submitted.set(true);
    const comment = this.comment().trim();
    if (this.rejecting() && comment === '') return;
    this.saving.set(true);
    this.submitError.set(null);
    this.request(item, comment)
      ?.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(this.rejecting() ? 'Solicitud rechazada' : 'Solicitud aprobada');
          this.open.set(false);
          this.decided.emit('done');
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const problem = problemOf(err);
          if (NOT_PENDING_CODES.has(problem.code)) {
            // someone decided it first: say so and let the inbox read again
            this.toast.warning(problem.message);
            this.open.set(false);
            this.decided.emit('stale');
            return;
          }
          this.submitError.set(problem.message);
        },
      });
  }

  private request(item: ApprovalInboxItem, comment: string): Observable<unknown> | null {
    const body = { comment: comment || undefined };
    const approve = this.decision() === 'approve';
    if (item.type === 'RETURN') return approve ? this.returns.approve(item.subjectId, body) : this.returns.reject(item.subjectId, body);
    if (item.type === 'CASH_EXPENSE') return approve ? this.cash.approve(item.subjectId, body) : this.cash.reject(item.subjectId, body);
    if (item.type === 'NIT_EXCEPTION') return approve ? this.invoicing.approveNitException(item.subjectId, body) : this.invoicing.rejectNitException(item.subjectId, body);
    // cancellations and cash differences are decided in their own review pages
    this.saving.set(false);
    return null;
  }
}
