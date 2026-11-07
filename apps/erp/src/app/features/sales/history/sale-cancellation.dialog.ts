import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CANCELLATION_COMMENT_MAX,
  type CancellationReason,
  type SaleCancellationResponse,
  type SaleDetail,
  validateCancellationRequest,
} from '@rodasoft/domain';
import { ButtonComponent, FieldComponent, FilterChipComponent, ModalComponent, NoteComponent, TextareaDirective } from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs } from '../cash/cash-format';
import { CANCELLATION_REASON_OPTIONS, cancellationDeadlineText, invoiceLabel } from './sale-format';
import { SalesHistoryApi } from './sales-history-api.service';

/**
 * VP-15a · Solicitar anulación (HU-VEN-14). The cashier picks one reason and writes a comment; sending it asks Management
 * to cancel the sale, which then waits as "anulación pendiente". The dialog only asks: the invoice stays valid and nothing
 * moves until Management approves (HU-VEN-15), and the note says what that approval will undo.
 */
@Component({
  selector: 'rs-sale-cancellation-dialog',
  imports: [ButtonComponent, FieldComponent, FilterChipComponent, ModalComponent, NoteComponent, TextareaDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sale-cancellation.dialog.html',
  styleUrl: './sale-cancellation.dialog.scss',
})
export class SaleCancellationDialog {
  private readonly api = inject(SalesHistoryApi);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  /** The sale to cancel: its number, invoice, total and what an approval undoes. */
  readonly sale = input.required<SaleDetail>();
  /** The request was saved: the sale is now waiting for Management. */
  readonly requested = output<SaleCancellationResponse>();

  protected readonly options = CANCELLATION_REASON_OPTIONS;
  protected readonly commentMax = CANCELLATION_COMMENT_MAX;
  protected readonly reason = signal<CancellationReason | null>(null);
  protected readonly comment = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly heading = computed(() => `Solicitar anulación de la venta ${this.sale().number}`);
  protected readonly summary = computed(() => {
    const sale = this.sale();
    return `${invoiceLabel(sale.invoice.status, sale.invoice.number)} · ${formatBs(sale.total)}`;
  });
  protected readonly total = computed(() => formatBs(this.sale().total));
  protected readonly deadline = computed(() => cancellationDeadlineText(this.sale().cancellation.windowEndsAt));
  protected readonly canSend = computed(
    () => !this.saving() && validateCancellationRequest({ reason: this.reason(), comment: this.comment() }).length === 0,
  );

  constructor() {
    // every time the dialog opens it starts empty
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.reason.set(null);
        this.comment.set('');
        this.error.set(null);
        this.saving.set(false);
      });
    });
  }

  /** One reason at a time: choosing another replaces it, and clicking the chosen one clears it. */
  protected choose(reason: CancellationReason, selected: boolean): void {
    if (selected) this.reason.set(reason);
    else if (this.reason() === reason) this.reason.set(null);
  }

  protected send(): void {
    const reason = this.reason();
    if (!reason || !this.canSend()) return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .requestCancellation(this.sale().id, { reason, comment: this.comment().trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.saving.set(false);
          this.open.set(false);
          this.requested.emit(response);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.error.set(problemOf(err).message);
        },
      });
  }
}
