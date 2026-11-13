import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { invoiceNumberLabel } from './invoice-format';
import { CANCELLATION_COMMENT_MAX, SIAT_CANCELLATION_REASONS, siatCancellationReasonCode } from '@rodasoft/domain';
import { ButtonComponent, FieldComponent, FilterChipComponent, ModalComponent, NoteComponent, TextareaDirective, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { formatBs } from '../sales/cash/cash-format';
import { CANCELLATION_REASON_OPTIONS } from '../sales/history/sale-format';
import { InvoicingApi } from './invoicing-api.service';

/**
 * FS-09 / FS-12 · Solicitar anulación de la factura (HU-FAC-09). The user picks one of the same four reasons the sale uses (each maps to
 * a SIN code) and writes a comment; Management decides. The invoice stays valid until the approval, which cancels it in the SIAT before the stock goes back and the
 * refund is registered. If the SIAT does not answer, the approval waits: nothing moves.
 */
@Component({
  selector: 'rs-invoice-cancellation-dialog',
  imports: [ButtonComponent, FieldComponent, FilterChipComponent, ModalComponent, NoteComponent, TextareaDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-cancellation.dialog.html',
  styleUrl: './invoice-cancellation.dialog.scss',
})
export class InvoiceCancellationDialog {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly invoiceId = input.required<string>();
  /** Printed number, for the title. */
  readonly invoiceNumber = input<number | null>(null);
  /** The sale and its total, for the line under the title. */
  readonly saleNumber = input('');
  readonly total = input('');
  /** The request was saved: the sale now waits for Management. */
  readonly requested = output<void>();

  protected readonly options = CANCELLATION_REASON_OPTIONS;
  /** The four SIN reasons the chips map to (kept for the form tests and the approver's inbox). */
  protected readonly reasons = SIAT_CANCELLATION_REASONS;
  protected readonly commentMax = CANCELLATION_COMMENT_MAX;
  protected readonly reason = signal<string | null>(null);
  /** The SIN code the chosen reason goes to the SIAT with. */
  protected readonly reasonCode = computed(() => (this.reason() ? siatCancellationReasonCode(this.reason() as string) : null));
  protected readonly sinReasonLabel = computed(() => SIAT_CANCELLATION_REASONS.find((r) => r.code === this.reasonCode())?.description ?? '');
  protected readonly summary = computed(() => [this.saleNumber() ? `Venta ${this.saleNumber()}` : null, this.total() ? formatBs(this.total()) : null].filter(Boolean).join(' · '));
  protected readonly comment = signal('');
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly heading = computed(() => (this.invoiceNumber() === null ? 'Solicitar anulación de la factura' : `Solicitar anulación de la factura ${invoiceNumberLabel(this.invoiceNumber())}`));
  protected readonly canSend = computed(() => !this.saving() && this.reasonCode() !== null && this.comment().trim() !== '' && this.comment().trim().length <= CANCELLATION_COMMENT_MAX);
  protected readonly commentError = computed(() => (this.touched() && this.comment().trim() === '' ? 'Cuenta qué pasó para que Gerencia decida' : null));

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.reason.set(null);
        this.comment.set('');
        this.touched.set(false);
        this.saving.set(false);
        this.error.set(null);
      });
    });
  }

  protected choose(value: string, selected: boolean) {
    this.reason.set(selected ? value : null);
  }

  protected send() {
    this.touched.set(true);
    const reasonCode = this.reasonCode();
    if (!this.canSend() || reasonCode === null) return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .requestCancellation(this.invoiceId(), { reasonCode, comment: this.comment().trim() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Solicitud de anulación enviada a Gerencia');
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
