import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  PRICE_REASON_MAX,
  validateBulkAdjustment,
  type BulkPriceDirection,
  type BulkPriceInput,
  type BulkPricePreview,
  type PriceListResponse,
  type RoundingMode,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  type DocTableColumn,
  DocTableComponent,
  type DocTableRow,
  EmptyStateIllustratedComponent,
  FieldComponent,
  FilterChipComponent,
  InputDirective,
  InputGroupComponent,
  ModalComponent,
  NoteComponent,
  NumericInputDirective,
  PageHeaderComponent,
  PaginationComponent,
  SelectComponent,
  type SelectOption,
  SkeletonComponent,
  TextareaDirective,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { catchError, debounceTime, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { formatBs } from '../cash/cash-format';
import {
  applyLabel,
  BULK_DIRECTIONS,
  BULK_PAGE_SIZE,
  BULK_ROUNDINGS,
  bulkSkipLabel,
  formatPercent,
  matchCountText,
  skippedText,
} from './price-format';
import { PricesApi } from './prices-api.service';

type PreviewState = 'idle' | 'loading' | 'ready' | 'error' | 'forbidden';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code', width: '10rem' },
  { key: 'product', label: 'Producto', type: 'text' },
  { key: 'current', label: 'Actual', type: 'number', width: '9rem' },
  { key: 'next', label: 'Nuevo', type: 'number', width: '9rem' },
  { key: 'change', label: 'Cambio', type: 'number', width: '7rem' },
];

/** What the user must fix before there is a preview. */
const PERCENT_HINT = 'Ingresa un porcentaje mayor que cero, con hasta 2 decimales. Una rebaja debe ser menor a 100 %.';

/**
 * VP-11c · Actualización masiva de precios (HU-VEN-27, decision #19). Three steps on one screen: which products (a brand and/or a
 * category), how to adjust them (increase or decrease by a percent, with the rounding of the batch), and the preview of what
 * would change. "Aplicar" is possible only over a loaded preview: the apply carries the hash of that preview, so if a price was
 * edited meanwhile the API refuses it and the preview is read again. Nothing is written until the user confirms.
 */
@Component({
  selector: 'rs-price-bulk-update-page',
  imports: [
    ButtonComponent,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    FilterChipComponent,
    InputDirective,
    InputGroupComponent,
    ModalComponent,
    NoteComponent,
    NumericInputDirective,
    PageHeaderComponent,
    PaginationComponent,
    SelectComponent,
    SkeletonComponent,
    TextareaDirective,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './price-bulk-update.page.html',
  styleUrl: './price-bulk-update.page.scss',
})
export class PriceBulkUpdatePage {
  private readonly api = inject(PricesApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Precios y descuentos', link: '/sales/prices' },
    { label: 'Actualización masiva' },
  ];
  protected readonly columns = COLUMNS;
  protected readonly directions = BULK_DIRECTIONS;
  protected readonly roundings = BULK_ROUNDINGS;
  protected readonly reasonMax = PRICE_REASON_MAX;
  protected readonly percentHint = PERCENT_HINT;
  protected readonly skeletonRows = Array.from({ length: 4 }, (_, i) => i);

  // ── step 1 · which products ──
  protected readonly brandId = signal<string | null>(null);
  protected readonly categoryId = signal<string | null>(null);
  /** The brands and categories of the filter selects, and how many products the filter matches. */
  protected readonly catalog = signal<PriceListResponse | null>(null);
  protected readonly catalogError = signal<string | null>(null);

  // ── step 2 · how to adjust ──
  protected readonly direction = signal<BulkPriceDirection>('INCREASE');
  protected readonly percent = signal('');
  /** The rounding the user picked; until then the company's own (`defaultRounding`, from the first preview). */
  private readonly pickedRounding = signal<RoundingMode | null>(null);
  private readonly defaultRounding = signal<RoundingMode>('NONE');
  protected readonly rounding = computed(() => this.pickedRounding() ?? this.defaultRounding());
  protected readonly percentTouched = signal(false);

  // ── step 3 · the preview ──
  protected readonly page = signal(1);
  protected readonly state = signal<PreviewState>('idle');
  protected readonly errorMessage = signal('');
  protected readonly preview = signal<BulkPricePreview | null>(null);

  // ── confirmation ──
  protected readonly confirmOpen = signal(false);
  protected readonly reason = signal('');
  protected readonly applying = signal(false);
  protected readonly applyError = signal<string | null>(null);

  protected readonly brandOptions = computed<SelectOption[]>(() => (this.catalog()?.brands ?? []).map((b) => ({ value: b.id, label: b.name })));
  protected readonly categoryOptions = computed<SelectOption[]>(() => (this.catalog()?.categories ?? []).map((c) => ({ value: c.id, label: c.name })));
  protected readonly hasFilter = computed(() => this.brandId() !== null || this.categoryId() !== null);
  protected readonly matchText = computed(() => (this.hasFilter() && this.catalog() ? matchCountText(this.catalog()?.total ?? 0) : ''));

  private readonly validation = computed(() => validateBulkAdjustment({ direction: this.direction(), percent: this.percent(), rounding: this.rounding() }));
  protected readonly percentError = computed(() => (this.percentTouched() && this.percent().trim() !== '' && !this.validation().ok ? PERCENT_HINT : ''));

  /** The batch the user described; null while there is no filter or no valid percent, so nothing is asked. */
  private readonly batch = computed<BulkPriceInput | null>(() => {
    const valid = this.validation();
    if (!this.hasFilter() || !valid.ok) return null;
    return {
      ...(this.brandId() ? { brandId: this.brandId() as string } : {}),
      ...(this.categoryId() ? { categoryId: this.categoryId() as string } : {}),
      direction: valid.value.direction,
      percent: valid.value.percent.toString(),
      rounding: valid.value.rounding,
    };
  });
  /** The request of the preview: the batch and the page of the table. */
  private readonly request = computed<BulkPriceInput | null>(() => {
    const batch = this.batch();
    return batch ? { ...batch, page: this.page(), pageSize: BULK_PAGE_SIZE } : null;
  });

  protected readonly counts = computed(() => this.preview()?.counts ?? { matched: 0, toChange: 0, unchanged: 0, invalid: 0 });
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.counts().matched / BULK_PAGE_SIZE)));
  protected readonly previewTitle = computed(() => `3. Vista previa (${this.counts().toChange} de ${this.counts().matched})`);
  protected readonly skipped = computed(() => skippedText(this.counts().unchanged, this.counts().invalid));
  protected readonly requiresApproval = computed(() => this.preview()?.requiresApproval ?? false);

  protected readonly canApply = computed(
    () => this.state() === 'ready' && this.counts().toChange > 0 && !this.requiresApproval() && !this.applying(),
  );
  protected readonly applyText = computed(() => applyLabel(this.counts().toChange));
  protected readonly warningTitle = computed(() => (this.counts().toChange === 1 ? 'Afecta a 1 producto' : `Afecta a ${this.counts().toChange} productos`));

  protected readonly rows = computed<DocTableRow[]>(() =>
    (this.preview()?.items ?? []).map((item) => ({
      id: item.productId,
      label: item.manufacturerCode,
      cells: {
        code: item.manufacturerCode,
        product: `${item.name} · ${item.brand.name}`,
        current: item.currentPrice === '0.00' ? '—' : formatBs(item.currentPrice),
        next: item.status === 'CHANGE' && item.newPrice ? formatBs(item.newPrice) : bulkSkipLabel(item.status === 'INVALID' ? 'INVALID' : 'UNCHANGED'),
        change: item.status === 'CHANGE' ? formatPercent(item.percent) : '—',
      },
    })),
  );

  protected readonly noMatch = computed(() => this.state() === 'ready' && this.counts().matched === 0);

  constructor() {
    // the select options and the live count of "1. Qué productos"
    toObservable(computed(() => ({ brandId: this.brandId(), categoryId: this.categoryId() })))
      .pipe(
        switchMap((filter) =>
          this.api.list({ brandId: filter.brandId ?? undefined, categoryId: filter.categoryId ?? undefined, page: 1, pageSize: 1 }).pipe(
            map((data) => ({ data })),
            catchError((err: unknown) => of({ error: problemOf(err).message })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if ('data' in result) {
          this.catalog.set(result.data);
          this.catalogError.set(null);
        } else this.catalogError.set(result.error);
      });

    // the preview: any change reads it again; typing the percent waits a moment
    toObservable(this.request)
      .pipe(
        tap((request) => {
          if (!request) {
            this.state.set('idle');
            this.preview.set(null);
          } else this.state.set('loading');
        }),
        debounceTime(300),
        switchMap((request) => (request ? this.fetch(request) : of(null))),
        takeUntilDestroyed(),
      )
      .subscribe((result) => result && this.show(result));
  }

  private fetch(request: BulkPriceInput) {
    return this.api.bulkPreview(request).pipe(
      map((data) => ({ data })),
      catchError((err: unknown) => of({ error: problemOf(err) })),
    );
  }

  private show(result: { data: BulkPricePreview } | { error: ReturnType<typeof problemOf> }) {
    if ('error' in result) {
      this.errorMessage.set(result.error.message);
      this.preview.set(null);
      this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    // the first preview tells the company's rounding; if the user has not picked one, the preview is read again with it
    if (this.pickedRounding() === null && result.data.defaultRounding !== this.rounding()) {
      this.defaultRounding.set(result.data.defaultRounding);
      return;
    }
    this.preview.set(result.data);
    this.state.set('ready');
  }

  protected setBrand(value: unknown) {
    this.brandId.set(value ? String(value) : null);
    this.page.set(1);
  }

  protected setCategory(value: unknown) {
    this.categoryId.set(value ? String(value) : null);
    this.page.set(1);
  }

  protected pickDirection(direction: BulkPriceDirection, selected: boolean) {
    // a chip group has always one choice: clicking the chosen one does nothing
    if (!selected) return;
    this.direction.set(direction);
    this.page.set(1);
  }

  protected pickRounding(rounding: RoundingMode, selected: boolean) {
    if (!selected) return;
    this.pickedRounding.set(rounding);
    this.page.set(1);
  }

  protected setPercent(text: string) {
    this.percent.set(text);
    this.percentTouched.set(true);
    this.page.set(1);
  }

  protected goToPage(page: number) {
    if (page !== this.page()) this.page.set(page);
  }

  protected retry() {
    const request = this.request();
    if (!request) return;
    this.state.set('loading');
    this.fetch(request)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.show(result));
  }

  protected cancel() {
    void this.router.navigate(['/sales/prices']);
  }

  protected askConfirmation() {
    if (!this.canApply()) return;
    this.reason.set('');
    this.applyError.set(null);
    this.confirmOpen.set(true);
  }

  protected closeConfirmation() {
    if (!this.applying()) this.confirmOpen.set(false);
  }

  protected apply() {
    const batch = this.batch();
    const preview = this.preview();
    if (!batch || !preview || this.applying()) return;
    this.applying.set(true);
    this.applyError.set(null);
    this.api
      .bulkApply({ ...batch, previewHash: preview.previewHash, reason: this.reason().trim() || undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.applying.set(false);
          this.confirmOpen.set(false);
          this.toast.success(result.updated === 1 ? 'Se actualizó el precio de 1 producto' : `Se actualizaron los precios de ${result.updated} productos`);
          void this.router.navigate(['/sales/prices']);
        },
        error: (err: unknown) => {
          this.applying.set(false);
          const problem = problemOf(err);
          if (problem.code === 'BULK_PREVIEW_STALE') {
            // a price changed since the preview: read it again so the user decides over what is true now
            this.confirmOpen.set(false);
            this.toast.warning(problem.message);
            this.retry();
            return;
          }
          this.applyError.set(problem.message);
        },
      });
  }
}
