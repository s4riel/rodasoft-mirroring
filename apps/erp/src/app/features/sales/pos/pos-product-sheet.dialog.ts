import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { brandInitials, Decimal, fieldIconOf, SPEC_STEP_DIMENSIONS, type PosEquivalentItem, type PosProductSheet } from '@rodasoft/domain';
import {
  BearingDiagramComponent,
  ButtonComponent,
  ChipMediaComponent,
  DataFieldComponent,
  FlagComponent,
  IconComponent,
  IconName,
  ImageViewerComponent,
  ModalComponent,
  QtyStepperComponent,
  SkeletonComponent,
  StatusPillComponent,
  StockFlagComponent,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { flagOf, thumbIconOf } from '../../inventory/products/product-list.mapper';
import { equivalencePill } from '../../inventory/products/sheet/equivalents/equivalence-pill';
import {
  formatKilograms,
  formatMillimeters,
  plural,
  SpecField,
  toSpecField,
} from '../../inventory/products/sheet/product-sheet.mapper';
import { PosApi } from './pos-api.service';

type SheetState = 'loading' | 'ready' | 'error' | 'not-found' | 'forbidden';

/** What "Agregar a la venta" emits: the product on display (the original or an equivalent) and the quantity. */
export interface PosSheetAdd {
  productId: string;
  quantity: number;
}

/**
 * VP-03e · Technical sheet of a bearing inside the POS (HU-VEN-04). A wide modal over the sale: photos, dimensions, price,
 * stock per branch and equivalents, with "Agregar a la venta" in the footer. Clicking an equivalent shows its sheet in the
 * same modal, with "Volver" to go back. It never shows costs (the API does not send them). The page does the adding.
 */
@Component({
  selector: 'rs-pos-product-sheet-dialog',
  imports: [
    BearingDiagramComponent,
    ButtonComponent,
    ChipMediaComponent,
    DataFieldComponent,
    FlagComponent,
    IconComponent,
    ImageViewerComponent,
    ModalComponent,
    QtyStepperComponent,
    SkeletonComponent,
    StatusPillComponent,
    StockFlagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos-product-sheet.dialog.html',
  styleUrl: './pos-product-sheet.dialog.scss',
})
export class PosProductSheetDialog {
  private readonly api = inject(PosApi);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  /** The product whose sheet opens. */
  readonly productId = input<string | null>(null);
  /** The page is adding right now: the button waits for the answer. */
  readonly adding = input(false);

  readonly add = output<PosSheetAdd>();
  /** A request failed; the page checks whether the cash shift was lost. */
  readonly loadFailed = output<unknown>();

  /** Products opened one after another: the last is on display, "Volver" removes it. */
  protected readonly trail = signal<string[]>([]);
  protected readonly current = computed(() => this.trail().at(-1) ?? null);
  protected readonly state = signal<SheetState>('loading');
  protected readonly sheet = signal<PosProductSheet | null>(null);
  protected readonly quantity = signal(1);
  protected readonly galleryOpen = signal(false);
  protected readonly galleryIndex = signal(0);
  /** Object URLs of the photos already fetched, by storage key. */
  protected readonly photoUrls = signal<Readonly<Record<string, string>>>({});
  /** Bumped on every opening, so reopening the same product loads it again. */
  private readonly openings = signal(0);
  private requestSeq = 0;
  private readonly fetching = new Set<string>();

  constructor() {
    // opening (or opening another product) restarts the trail
    effect(() => {
      const id = this.productId();
      if (this.open() && id) {
        untracked(() => {
          this.trail.set([id]);
          this.quantity.set(1);
          this.galleryIndex.set(0);
          this.openings.update((n) => n + 1);
        });
      }
    });
    effect(() => {
      const id = this.current();
      this.openings();
      if (id) untracked(() => this.load(id));
    });
    this.destroyRef.onDestroy(() => Object.values(this.photoUrls()).forEach((url) => URL.revokeObjectURL(url)));
  }

  protected load(id: string = this.current() ?? ''): void {
    if (!id) return;
    const seq = ++this.requestSeq;
    this.state.set('loading');
    this.api
      .sheet(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sheet) => {
          if (seq !== this.requestSeq) return;
          this.sheet.set(sheet);
          this.quantity.set(1);
          this.state.set('ready');
          sheet.product.photos.forEach((key) => this.fetchPhoto(key));
        },
        error: (err: unknown) => {
          if (seq !== this.requestSeq) return;
          const problem = problemOf(err);
          this.state.set(problem.code === 'PRODUCT_NOT_FOUND' ? 'not-found' : problem.status === 403 ? 'forbidden' : 'error');
          this.loadFailed.emit(err);
        },
      });
  }

  private fetchPhoto(key: string): void {
    if (this.photoUrls()[key] || this.fetching.has(key)) return;
    this.fetching.add(key);
    this.api
      .file(key)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => this.photoUrls.update((urls) => ({ ...urls, [key]: URL.createObjectURL(blob) })),
        error: () => this.fetching.delete(key),
      });
  }

  protected openEquivalent(item: PosEquivalentItem): void {
    this.trail.update((t) => [...t, item.productId]);
  }

  protected back(): void {
    this.trail.update((t) => t.slice(0, -1));
  }

  protected confirm(): void {
    const id = this.current();
    if (id && this.canAdd()) this.add.emit({ productId: id, quantity: this.quantity() });
  }

  protected readonly initialsOf = brandInitials;

  protected readonly canGoBack = computed(() => this.trail().length > 1);

  // ── header and photos ──
  protected readonly flag = computed(() => flagOf(this.sheet()?.product.country?.code));
  protected readonly thumbIcon = computed<IconName>(() => thumbIconOf(this.sheet()?.product.category.icon ?? ''));
  /** Photos already fetched, in order; the ones still loading are left out. */
  protected readonly photos = computed(() => {
    const urls = this.photoUrls();
    return (this.sheet()?.product.photos ?? []).map((key) => urls[key]).filter((url): url is string => !!url);
  });
  protected readonly mainPhoto = computed(() => this.photos()[this.galleryIndex()] ?? this.photos()[0] ?? null);

  protected showPhoto(index: number): void {
    this.galleryIndex.set(index);
  }

  protected zoom(): void {
    this.galleryOpen.set(true);
  }

  // ── dimensions and specs ──
  protected readonly dimensionFields = computed(() => {
    const d = this.sheet()?.product.dimensions;
    if (!d) return [];
    return [
      { label: 'Interior d', icon: 'diameter' as IconName, value: formatMillimeters(d.innerDiameter) },
      { label: 'Exterior D', icon: 'diameter' as IconName, value: formatMillimeters(d.outerDiameter) },
      { label: 'Ancho B', icon: 'ruler' as IconName, value: formatMillimeters(d.width) },
      { label: 'Peso', icon: 'package' as IconName, value: formatKilograms(d.weight) },
    ];
  });
  protected readonly dimensionSpecs = computed<SpecField[]>(() =>
    (this.sheet()?.product.specs ?? []).filter((s) => s.step === SPEC_STEP_DIMENSIONS && s.value !== null).map(toSpecField),
  );
  protected readonly otherSpecs = computed<SpecField[]>(() =>
    (this.sheet()?.product.specs ?? []).filter((s) => s.step !== SPEC_STEP_DIMENSIONS && s.value !== null).map(toSpecField),
  );
  protected readonly datasheetUrl = computed(() => this.sheet()?.product.datasheetUrl ?? null);

  // ── price and stock ──
  protected readonly price = computed(() => Decimal.of(this.sheet()?.product.salePrice ?? '0').format());
  protected readonly stockHere = computed(() => {
    const s = this.sheet();
    return s ? `${s.available} en esta sucursal` : '';
  });
  protected readonly branches = computed(() => {
    const s = this.sheet();
    return (s?.product.stockByBranch ?? []).map((b) => ({
      id: b.branchId,
      name: b.branchName,
      quantity: b.quantity,
      availability: b.availability,
      limits: this.limits(b.minStock, b.maxStock),
      current: b.branchId === s?.branchId,
    }));
  });

  /** "Mínimo 5 · máximo 60"; empty when the branch has neither. */
  private limits(min: number | null, max: number | null): string {
    return [min !== null ? `Mínimo ${min}` : null, max !== null ? `máximo ${max}` : null].filter(Boolean).join(' · ');
  }

  // ── equivalents ──
  protected readonly equivalents = computed(() =>
    (this.sheet()?.equivalents ?? []).map((item) => ({ item, pill: equivalencePill(item, 'short') })),
  );
  protected readonly referenceLabel = computed(() => {
    const n = this.sheet()?.equivalents.length ?? 0;
    return `${n} ${plural(n, 'referencia', 'referencias')} de otras marcas`;
  });

  // ── footer ──
  protected readonly canAdd = computed(() => {
    const s = this.sheet();
    return !!s && !this.adding() && (s.maxQuantity === null || s.maxQuantity >= 1);
  });
  protected readonly soldOutHere = computed(() => {
    const s = this.sheet();
    return !!s && s.maxQuantity !== null && s.maxQuantity < 1;
  });

  protected readonly icons = {
    code: fieldIconOf({ type: 'CODE' }),
    sku: fieldIconOf({ type: 'SKU' }),
  } satisfies Record<string, IconName>;
}
