import { ChangeDetectionStrategy, Component, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import type { ProductStatusResponse } from '@rodasoft/domain';
import { ButtonComponent, IconComponent, ModalComponent, NoteComponent, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { ProductsApi } from './products-api.service';

/** What the dialog needs to know about the product it deactivates; the list rows and the product sheet both fit. */
export interface DeactivateSourceSummary {
  id: string;
  manufacturerCode: string;
}

/**
 * IN-18a · Deactivate product: explains that it stops being offered but keeps its history and stock, then deactivates it.
 * Shared by the list and the product sheet. Reactivating needs no confirmation, so it is not part of this dialog.
 */
@Component({
  selector: 'rs-deactivate-product-dialog',
  imports: [ButtonComponent, IconComponent, ModalComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './deactivate-product.dialog.html',
  styleUrl: './deactivate-product.dialog.scss',
})
export class DeactivateProductDialog {
  private readonly api = inject(ProductsApi);
  private readonly toast = inject(ToastService);

  readonly open = model(false);
  /** Product being deactivated; the dialog resets whenever it opens. */
  readonly product = input<DeactivateSourceSummary | null>(null);
  readonly deactivated = output<ProductStatusResponse>();

  protected readonly saving = signal(false);
  protected readonly submitError = signal<string | null>(null);

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.saving.set(false);
        this.submitError.set(null);
      });
    });
  }

  protected cancel() {
    if (!this.saving()) this.open.set(false);
  }

  protected confirm() {
    const product = this.product();
    if (!product || this.saving()) return;
    this.saving.set(true);
    this.submitError.set(null);
    this.api.deactivate(product.id).subscribe({
      next: (result) => {
        this.saving.set(false);
        this.open.set(false);
        this.toast.success('Producto desactivado');
        this.deactivated.emit(result);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.submitError.set(problemOf(err).message);
      },
    });
  }
}
