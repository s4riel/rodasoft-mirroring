import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isProductionConfirmation, PRODUCTION_CONFIRMATION, PRODUCTION_REQUIREMENT_LABELS, type ProductionReadiness } from '@rodasoft/domain';
import { ButtonComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { InvoicingApi } from './invoicing-api.service';

/**
 * FS-36 · Switch to production (HU-FAC-27). While a requirement is missing the dialog lists it and the button stays disabled; when
 * everything is ready the person types the confirmation word (the API checks it again). There is no way back to the test environment.
 */
@Component({
  selector: 'rs-production-dialog',
  imports: [ButtonComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './production.dialog.html',
  styleUrl: './production.dialog.scss',
})
export class ProductionDialog {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly readiness = input.required<ProductionReadiness>();
  readonly switched = output<void>();

  protected readonly word = PRODUCTION_CONFIRMATION;
  protected readonly typed = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly missing = computed(() => this.readiness().requirements.map((code) => PRODUCTION_REQUIREMENT_LABELS[code]));
  protected readonly canConfirm = computed(() => this.readiness().ready && isProductionConfirmation(this.typed()) && !this.saving());

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.typed.set('');
        this.saving.set(false);
        this.error.set(null);
      });
    });
  }

  protected confirm() {
    if (!this.canConfirm()) return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .enableProduction(this.typed())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Tu empresa ya factura en producción');
          this.open.set(false);
          this.switched.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(problemOf(err).message);
        },
      });
  }
}
