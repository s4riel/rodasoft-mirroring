import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { type EquivalenceSuggestion, type ProductDetail, wizardSteps } from '@rodasoft/domain';
import {
  ButtonComponent,
  EmptyStateIllustratedComponent,
  FieldComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
  ToastService,
} from '@rodasoft/ui';
import { catchError, debounceTime, forkJoin, of, switchMap } from 'rxjs';
import { problemOf } from '../../../../core/api-error';
import { ProductsApi } from '../products-api.service';
import { equivalencePill } from '../sheet/equivalents/equivalence-pill';
import { WIZARD_STEP_LABELS } from './product-wizard.model';

/**
 * IN-03 · Product created (HU-INV-06): confirms the SKU and offers the equivalents the new product can be linked to.
 * Linking a suggestion creates the equivalence; the sheet's Equivalentes tab shows it afterwards.
 */
@Component({
  selector: 'rs-product-created-page',
  imports: [
    ButtonComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    NoteComponent,
    PageHeaderComponent,
    ReactiveFormsModule,
    RouterLink,
    SkeletonComponent,
    StatusPillComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-created.page.html',
  styleUrl: './product-created.page.scss',
})
export class ProductCreatedPage {
  private readonly api = inject(ProductsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly product = signal<ProductDetail | null>(null);
  protected readonly suggestions = signal<EquivalenceSuggestion[] | null>(null);
  protected readonly suggestionsError = signal(false);
  protected readonly linked = signal<ReadonlySet<string>>(new Set());
  protected readonly linking = signal<ReadonlySet<string>>(new Set());
  protected readonly error = signal<string | null>(null);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly searchResults = signal<{ productId: string; code: string; brand: string }[]>([]);

  /** The six steps of a bearing, all done: a created product has every required field. */
  protected readonly steps = wizardSteps(true).map((step) => ({ key: step.key, label: WIZARD_STEP_LABELS[step.key], required: step.required }));
  protected readonly requiredCount = this.steps.filter((step) => step.required).length;

  protected readonly measures = computed(() => {
    const d = this.product()?.dimensions;
    return d ? `${d.innerDiameter}×${d.outerDiameter}×${d.width} mm` : null;
  });
  /** Measures, price and the first two technical values, as the summary of the wizard shows them. */
  protected readonly chips = computed(() => {
    const p = this.product();
    if (!p) return [];
    const chips: string[] = [];
    const measures = this.measures();
    if (measures) chips.push(measures);
    const price = Number(p.pricing.salePrice);
    if (p.pricing.salePrice && Number.isFinite(price)) chips.push(`Bs ${price.toFixed(2).replace('.', ',')}`);
    const dimensionKeys = ['innerDiameter', 'outerDiameter', 'width'];
    const specs = p.specs.filter((s) => s.value !== null && s.value !== '' && !dimensionKeys.includes(s.key));
    for (const spec of specs.slice(0, 2)) chips.push(String(spec.value));
    return chips;
  });
  protected readonly pending = computed(() => (this.suggestions() ?? []).filter((s) => !this.linked().has(s.productId)));

  constructor() {
    this.api
      .detail(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (product) => this.product.set(product),
        error: (err: unknown) => this.error.set(problemOf(err).message),
      });
    this.loadSuggestions();
    this.search.valueChanges
      .pipe(
        debounceTime(300),
        switchMap((term) => {
          const text = term.trim();
          return text.length < 2 ? of(null) : this.api.list({ search: text, page: 1, pageSize: 5 }).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) =>
        this.searchResults.set(
          (result?.items ?? [])
            .filter((item) => item.id !== this.id && !(this.suggestions() ?? []).some((s) => s.productId === item.id))
            .map((item) => ({ productId: item.id, code: item.manufacturerCode, brand: item.brand.name })),
        ),
      );
  }

  protected loadSuggestions() {
    this.suggestionsError.set(false);
    this.api
      .equivalenceSuggestions(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.suggestions.set(response.items),
        error: () => this.suggestionsError.set(true),
      });
  }

  protected pillOf(item: EquivalenceSuggestion) {
    return equivalencePill(item, 'short');
  }

  protected noteOf(item: EquivalenceSuggestion): string {
    if (item.kind === 'EXACT') return 'Mismas medidas y características.';
    return `Difiere en: ${item.differences.map((d) => d.label.toLowerCase()).join(', ')}.`;
  }

  protected link(productId: string, code: string) {
    this.linking.update((set) => new Set(set).add(productId));
    this.api
      .linkEquivalence(this.id, productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.done(productId);
          this.toast.success(`Equivalencia vinculada con ${code}.`);
        },
        error: (err: unknown) => {
          this.done(productId, false);
          this.toast.danger(problemOf(err).message);
        },
      });
  }

  /** "Vincular equivalencias": links every suggestion that is still pending. */
  protected linkAll() {
    const items = this.pending();
    if (!items.length) return;
    this.linking.set(new Set(items.map((s) => s.productId)));
    forkJoin(items.map((item) => this.api.linkEquivalence(this.id, item.productId).pipe(catchError(() => of(null)))))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((results) => {
        const ok = items.filter((_, i) => results[i]);
        this.linking.set(new Set());
        this.linked.update((set) => new Set([...set, ...ok.map((s) => s.productId)]));
        if (ok.length === items.length) this.toast.success(ok.length === 1 ? 'Equivalencia vinculada.' : `${ok.length} equivalencias vinculadas.`);
        else this.toast.danger('No pudimos vincular todas las equivalencias. Inténtalo de nuevo.');
      });
  }

  private done(productId: string, linked = true) {
    this.linking.update((set) => {
      const next = new Set(set);
      next.delete(productId);
      return next;
    });
    if (linked) this.linked.update((set) => new Set(set).add(productId));
  }

  protected createAnother() {
    void this.router.navigate(['/inventory/products/new']);
  }
}
