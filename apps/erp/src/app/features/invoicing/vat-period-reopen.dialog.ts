import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VAT_PERIOD_REOPEN_REASON_MAX, type VatPeriodReopenError, validateReopenReason } from '@rodasoft/domain';
import { ButtonComponent, FieldComponent, ModalComponent, NoteComponent, TextareaDirective, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { periodLabel } from './credit-note-format';
import { InvoicingApi } from './invoicing-api.service';

const REASON_ERRORS: Record<VatPeriodReopenError, string> = {
  REASON_REQUIRED: 'Escribe el motivo para reabrir el período.',
  REASON_TOO_SHORT: 'Cuéntanos un poco más: el motivo es muy corto.',
  REASON_TOO_LONG: 'El motivo es demasiado largo.',
};

/** Reopen a closed VAT period (HU-FAC-21): the reason is required and stays in the audit log. */
@Component({
  selector: 'rs-vat-period-reopen-dialog',
  imports: [ButtonComponent, FieldComponent, ModalComponent, NoteComponent, TextareaDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vat-period-reopen.dialog.html',
  styleUrl: './vat-period-reopen.dialog.scss',
})
export class VatPeriodReopenDialog {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly period = input<string | null>(null);
  readonly reopened = output<void>();

  protected readonly max = VAT_PERIOD_REOPEN_REASON_MAX;
  protected readonly reason = signal('');
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly name = computed(() => (this.period() ? periodLabel(this.period() as string) : ''));
  protected readonly reasonError = computed(() => {
    const [error] = validateReopenReason(this.reason());
    return this.touched() && error ? REASON_ERRORS[error] : null;
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.reason.set('');
        this.touched.set(false);
        this.saving.set(false);
        this.saveError.set(null);
      });
    });
  }

  protected confirm() {
    const period = this.period();
    this.touched.set(true);
    if (!period || this.saving() || validateReopenReason(this.reason()).length > 0) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.api
      .reopenPeriod(period, this.reason().trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(`${periodLabel(period)} reabierto`);
          this.open.set(false);
          this.reopened.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.saveError.set(problemOf(err).message);
        },
      });
  }
}
