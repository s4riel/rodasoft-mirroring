import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NIT_EXCEPTION_REASON_MAX, validateNitExceptionRequest } from '@rodasoft/domain';
import { ButtonComponent, FieldComponent, ModalComponent, NoteComponent, TextareaDirective, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { InvoicingApi } from './invoicing-api.service';

/**
 * FS-22 · Pedir excepción de NIT (HU-FAC-08). The invoice cannot be sent because the SIN does not know the customer's NIT; the user
 * writes why it must go anyway and Management decides. Nothing changes on the invoice until the approval.
 */
@Component({
  selector: 'rs-nit-exception-dialog',
  imports: [ButtonComponent, FieldComponent, ModalComponent, NoteComponent, TextareaDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './nit-exception.dialog.html',
  styleUrl: './nit-exception.dialog.scss',
})
export class NitExceptionDialog {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly invoiceId = input.required<string>();
  /** The request was saved. */
  readonly requested = output<void>();

  protected readonly reasonMax = NIT_EXCEPTION_REASON_MAX;
  protected readonly reason = signal('');
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly errors = computed(() => validateNitExceptionRequest({ reason: this.reason() }));
  protected readonly reasonError = computed(() => {
    if (!this.touched()) return null;
    const [error] = this.errors();
    if (error === 'REASON_REQUIRED') return 'Cuenta por qué la factura debe emitirse igual';
    if (error === 'REASON_TOO_SHORT') return 'Escribe un motivo un poco más completo';
    if (error === 'REASON_TOO_LONG') return 'El motivo es demasiado largo';
    return null;
  });
  protected readonly canSend = computed(() => !this.saving() && this.errors().length === 0);

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.reason.set('');
        this.touched.set(false);
        this.saving.set(false);
        this.error.set(null);
      });
    });
  }

  protected send() {
    this.touched.set(true);
    if (!this.canSend()) return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .requestNitException(this.invoiceId(), this.reason().trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Solicitud enviada a Gerencia');
          this.open.set(false);
          this.requested.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(problemOf(err).message);
        },
      });
  }
}
