import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import {
  DEFAULT_COPY_PARTS,
  type DuplicateProductResponse,
  type ProductCopyPart,
  type ProductFilterOptions,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  FilterChipComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  ModalComponent,
  NoteComponent,
  SelectComponent,
  SelectOption,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { flagOf } from './product-list.mapper';
import { ProductsApi } from './products-api.service';

interface CopyChip {
  part: ProductCopyPart;
  label: string;
  disabled: boolean;
}

/** What the dialog needs to know about the product it copies; the list rows and the product sheet both fit. */
export interface DuplicateSourceSummary {
  id: string;
  manufacturerCode: string;
  brand: { id: string; name: string };
  country: { id: string } | null;
}

const COPY_CHIPS: readonly CopyChip[] = [
  { part: 'dimensions', label: 'Dimensiones', disabled: false },
  { part: 'specifications', label: 'Especificaciones', disabled: false },
  { part: 'price', label: 'Precio', disabled: false },
  { part: 'media', label: 'Fotos y ficha técnica', disabled: false },
  { part: 'equivalences', label: 'Equivalencias', disabled: false },
];

/**
 * IN-19 · Duplicate product: asks for the new code, brand, industry and what to copy. Shared by the list and the product
 * sheet. After copying it opens the copy: the edit screen, or the wizard when the copy is a draft (no price copied).
 */
@Component({
  selector: 'rs-duplicate-product-dialog',
  imports: [
    ButtonComponent,
    FieldComponent,
    FilterChipComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    ModalComponent,
    NoteComponent,
    ReactiveFormsModule,
    SelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './duplicate-product.dialog.html',
  styleUrl: './duplicate-product.dialog.scss',
})
export class DuplicateProductDialog {
  private readonly api = inject(ProductsApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly open = model(false);
  /** Product being copied; the dialog resets whenever it opens for a product. */
  readonly product = input<DuplicateSourceSummary | null>(null);
  readonly options = input.required<ProductFilterOptions>();
  readonly created = output<DuplicateProductResponse>();

  protected readonly chips = COPY_CHIPS;
  protected readonly form = new FormGroup({
    manufacturerCode: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    brandId: new FormControl<string | null>(null, { validators: [Validators.required] }),
    countryId: new FormControl<string | null>(null),
  });
  protected readonly copy = signal<ReadonlySet<ProductCopyPart>>(new Set(DEFAULT_COPY_PARTS));
  protected readonly saving = signal(false);
  protected readonly codeError = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly attempted = signal(false);

  protected readonly brandOptions = computed<SelectOption[]>(() =>
    this.options().brands.map((b) => ({
      value: b.id,
      label: b.name,
      media: { type: 'brand', text: b.name.slice(0, 3).toUpperCase() },
    })),
  );
  protected readonly countryOptions = computed<SelectOption[]>(() => [
    { value: null, label: 'Sin industria' },
    ...this.options().countries.map((c) => {
      const flag = flagOf(c.code);
      return {
        value: c.id,
        label: c.name,
        media: flag ? { type: 'flag' as const, country: flag } : { type: 'brand' as const, text: c.code },
      };
    }),
  ]);
  protected readonly subtitle = computed(() => {
    const p = this.product();
    return p ? `Crea una copia de ${p.manufacturerCode} · ${p.brand.name} con un código nuevo.` : '';
  });
  protected readonly codeInvalid = computed(
    () => !!this.codeError() || (this.attempted() && this.form.controls.manufacturerCode.invalid),
  );
  protected readonly codeMessage = computed(() => {
    if (this.codeError()) return this.codeError();
    return this.attempted() && this.form.controls.manufacturerCode.invalid ? 'Ingresa el código nuevo.' : null;
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      // only opening resets the form: a re-emitted product must not wipe the code the user is typing
      const p = untracked(() => this.product());
      if (!p) return;
      this.form.reset({ manufacturerCode: '', brandId: p.brand.id, countryId: p.country?.id ?? null });
      this.copy.set(new Set(DEFAULT_COPY_PARTS));
      this.saving.set(false);
      this.attempted.set(false);
      this.codeError.set(null);
      this.submitError.set(null);
    });
    // a changed code or brand makes the previous "already exists" answer stale
    this.form.controls.manufacturerCode.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.codeError.set(null));
    this.form.controls.brandId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.codeError.set(null));
  }

  protected isCopied(part: ProductCopyPart): boolean {
    return this.copy().has(part);
  }

  protected setCopied(part: ProductCopyPart, selected: boolean) {
    const next = new Set(this.copy());
    if (selected) next.add(part);
    else next.delete(part);
    this.copy.set(next);
  }

  protected cancel() {
    if (!this.saving()) this.open.set(false);
  }

  protected submit() {
    const p = this.product();
    this.attempted.set(true);
    this.submitError.set(null);
    if (!p || this.saving() || this.form.invalid) return;
    const { manufacturerCode, brandId, countryId } = this.form.getRawValue();
    this.saving.set(true);
    this.api
      .duplicate(p.id, { manufacturerCode: manufacturerCode.trim(), brandId: brandId as string, countryId, copy: [...this.copy()] })
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.open.set(false);
          this.created.emit(result);
          this.toast.success(`Copia creada: ${result.sku}`);
          void this.router.navigate(['/inventory/products', result.id, result.status === 'DRAFT' ? 'draft' : 'edit']);
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.saving.set(false);
          if (problem.code === 'DUPLICATE_MANUFACTURER_CODE') this.codeError.set(problem.message);
          else this.submitError.set(problem.message);
        },
      });
  }
}
