import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { PeriodCloseError, VatPeriodBlockers } from '@rodasoft/domain';
import { ButtonComponent, ModalComponent, NoteComponent, SkeletonComponent, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { formatBs } from '../sales/cash/cash-format';
import { periodLabel } from './credit-note-format';
import { BLOCKER_LABELS } from './fiscal-format';
import { InvoicingApi } from './invoicing-api.service';

const ERROR_TEXTS: Record<PeriodCloseError, string> = {
  PERIOD_ALREADY_CLOSED: 'Este período ya está cerrado.',
  PERIOD_NOT_ENDED: 'El mes todavía no terminó: solo se cierra un período ya vencido.',
  PREVIOUS_PERIOD_OPEN: 'El período anterior sigue abierto. Ciérralo primero.',
};

/**
 * FS-40 · Close a VAT period (HU-FAC-21). It asks the API what stops the close and shows it: the documents the SIAT has not issued,
 * the observed purchases and the cancellations under way. With nothing pending, "Cerrar período" freezes the books.
 */
@Component({
  selector: 'rs-vat-period-close-dialog',
  imports: [ButtonComponent, ModalComponent, NoteComponent, RouterLink, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vat-period-close.dialog.html',
  styleUrl: './vat-period-close.dialog.scss',
})
export class VatPeriodCloseDialog {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly period = input<string | null>(null);
  readonly closed = output<void>();

  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly blockers = signal<VatPeriodBlockers | null>(null);

  protected readonly name = computed(() => (this.period() ? periodLabel(this.period() as string) : ''));
  protected readonly errorText = computed(() => {
    const error = this.blockers()?.error;
    return error ? ERROR_TEXTS[error] : null;
  });
  protected readonly lines = computed(() => (this.blockers()?.blockers ?? []).map((b) => BLOCKER_LABELS[b.code](b.count)));
  /** Cancellation requests still waiting for a decision: they do not stop the close, but after it they can only be corrected with a credit note. */
  protected readonly requestsText = computed(() => {
    const count = this.blockers()?.cancellationRequests ?? 0;
    if (count === 0) return null;
    const subject = count === 1 ? 'Hay 1 solicitud de anulación pendiente de este período' : `Hay ${count} solicitudes de anulación pendientes de este período`;
    return `${subject}. Si cierras ahora, ya no se podrán aprobar: la factura se corrige con una nota de crédito. Resuélvelas antes si quieres anularlas.`;
  });
  /** Pending documents or purchases (not the date rules): the dialog then sends the person to the documents. */
  protected readonly hasPending = computed(() => this.lines().length > 0);
  protected readonly heading = computed(() => (this.blockers() !== null && (this.hasPending() || this.errorText() !== null) ? `No se puede cerrar ${this.name()}` : `Cerrar ${this.name()}`));
  protected readonly canClose = computed(() => !this.loading() && this.blockers() !== null && this.blockers()?.error === null && this.lines().length === 0);
  protected readonly formatBs = formatBs;

  constructor() {
    effect(() => {
      const period = this.period();
      if (!this.open() || !period) return;
      untracked(() => this.load(period));
    });
  }

  private load(period: string) {
    this.loading.set(true);
    this.loadError.set(null);
    this.saveError.set(null);
    this.blockers.set(null);
    this.api
      .periodBlockers(period)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blockers) => {
          this.blockers.set(blockers);
          this.loading.set(false);
        },
        error: (err) => {
          this.loadError.set(problemOf(err).message);
          this.loading.set(false);
        },
      });
  }

  protected confirm() {
    const period = this.period();
    if (!period || this.saving() || !this.canClose()) return;
    this.saving.set(true);
    this.saveError.set(null);
    this.api
      .closePeriod(period)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(`${periodLabel(period)} cerrado`);
          this.open.set(false);
          this.closed.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.saveError.set(problemOf(err).message);
        },
      });
  }
}
