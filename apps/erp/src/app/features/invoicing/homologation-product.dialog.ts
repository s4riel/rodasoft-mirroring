import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { HomologationRow } from '@rodasoft/domain';
import { ButtonComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent, SelectComponent, type SelectOption, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { InvoicingApi } from './invoicing-api.service';

/** Sets the SIN code (and unit) of one product (HU-FAC-26). The API checks the code against the synced catalogue. */
@Component({
  selector: 'rs-homologation-product-dialog',
  imports: [ButtonComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './homologation-product.dialog.html',
  styleUrl: './homologation-product.dialog.scss',
})
export class HomologationProductDialog {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly product = input<HomologationRow | null>(null);
  readonly units = input<readonly { code: number; description: string }[]>([]);
  readonly saved = output<void>();

  protected readonly code = signal('');
  protected readonly unit = signal<number | null>(null);
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly unitOptions = computed<SelectOption[]>(() => this.units().map((u) => ({ value: u.code, label: `${u.code} · ${u.description}` })));
  protected readonly codeError = computed(() => (this.touched() && this.code().trim() === '' ? 'Escribe el código del catálogo del SIN.' : null));

  constructor() {
    effect(() => {
      const product = this.product();
      if (!this.open()) return;
      untracked(() => {
        this.code.set(product?.sinProductCode ?? '');
        this.unit.set(product?.sinUnitCode ?? null);
        this.touched.set(false);
        this.saving.set(false);
        this.error.set(null);
      });
    });
  }

  protected save() {
    const product = this.product();
    this.touched.set(true);
    if (!product || this.saving() || this.code().trim() === '') return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .homologateProduct(product.id, { sinProductCode: this.code().trim(), sinUnitCode: this.unit() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success(`${product.sku} homologado`);
          this.open.set(false);
          this.saved.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(problemOf(err).message);
        },
      });
  }
}
