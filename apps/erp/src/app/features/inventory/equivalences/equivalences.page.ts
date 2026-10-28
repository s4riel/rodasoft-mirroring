import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { EquivalenceListItem, EquivalenceListProduct, EquivalenceListResponse, ProductFilterOptions } from '@rodasoft/domain';
import {
  ButtonComponent,
  IconButtonComponent,
  CanDirective,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  FlagComponent,
  IconComponent,
  IllustrationComponent,
  NoteComponent,
  PageHeaderComponent,
  PaginationComponent,
  ProductThumbComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  StatusPillComponent,
  StockFlagComponent,
  ToastOutletComponent,
  ToastService,
  TooltipDirective,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { flagOf, thumbIconOf } from '../products/product-list.mapper';
import { ProductsApi } from '../products/products-api.service';
import { EquivalencesApi } from './equivalences-api.service';
import { EquivalenceUnlinkDialog, type UnlinkTarget } from './link/equivalence-unlink.dialog';
import {
  EQUIVALENCES_PAGE_SIZE,
  EquivalenceUrlFilters,
  KIND_OPTIONS,
  parseKind,
  toQuery,
  toRow,
} from './equivalences.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type FilterKey = 'brandId' | 'categoryId' | 'kind';

const COLUMNS: DocTableColumn[] = [
  { key: 'a', label: 'Producto A', type: 'custom' },
  { key: 'swap', label: '', type: 'custom', width: 'var(--space-12)' },
  { key: 'b', label: 'Producto B', type: 'custom' },
  { key: 'measures', label: 'Medidas', type: 'text' },
  { key: 'kind', label: 'Tipo', type: 'status' },
  { key: 'stock', label: 'Stock', type: 'custom', align: 'end' },
  { key: 'actions', label: 'Acciones', type: 'custom', align: 'end' },
];

/** IN-15a / IN-15b / IN-15f · Equivalence table between brands: every saved link, with filters, empty and read-only states. */
@Component({
  selector: 'rs-equivalences-page',
  imports: [
    ButtonComponent,
    IconButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    EquivalenceUnlinkDialog,
    FilterBarProductsComponent,
    FlagComponent,
    IconComponent,
    IllustrationComponent,
    NgTemplateOutlet,
    NoteComponent,
    PageHeaderComponent,
    PaginationComponent,
    ProductThumbComponent,
    SelectComponent,
    SkeletonComponent,
    StatusPillComponent,
    StockFlagComponent,
    ToastOutletComponent,
    TooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './equivalences.page.html',
  styleUrl: './equivalences.page.scss',
})
export class EquivalencesPage {
  private readonly api = inject(EquivalencesApi);
  private readonly productsApi = inject(ProductsApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Inventario', link: '/inventory' }, { label: 'Equivalencias' }];
  protected readonly columns = COLUMNS;
  protected readonly kindOptions = KIND_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  protected readonly canView = computed(() => this.ctx.can('inventory.products.view'));
  /** IN-15f · Viewing without the permission to link: the same list, with no link actions. */
  protected readonly readOnly = computed(() => !this.ctx.can('inventory.equivalences.link'));

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly filters = computed<EquivalenceUrlFilters>(() => {
    const q = this.queryParams();
    return {
      q: q.get('q') ?? '',
      brandId: q.get('brandId'),
      categoryId: q.get('categoryId'),
      kind: parseKind(q.get('kind')),
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });

  protected readonly unlinkOpen = signal(false);
  protected readonly unlinkTarget = signal<UnlinkTarget | null>(null);
  protected readonly approvingId = signal<string | null>(null);

  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<EquivalenceListResponse | null>(null);
  protected readonly options = signal<ProductFilterOptions>({ countries: [], brands: [], categories: [] });

  protected readonly items = computed<readonly EquivalenceListItem[]>(() => this.data()?.items ?? []);
  protected readonly rows = computed(() => this.items().map(toRow));
  private readonly itemById = computed(() => new Map(this.items().map((i) => [i.id, i])));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / EQUIVALENCES_PAGE_SIZE)));

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.brandId || f.categoryId || f.kind || f.q) || this.searchText().trim() !== '';
  });
  /** IN-15b · The company has no links at all. */
  protected readonly showEmpty = computed(() => this.state() === 'ready' && !!this.data()?.linksEmpty);
  /** Filters that leave nothing: another empty state, with "Limpiar filtros". */
  protected readonly showNoResults = computed(() => this.state() === 'ready' && !this.data()?.linksEmpty && this.total() === 0);

  protected readonly rangeLabel = computed(() => {
    const total = this.total();
    if (!total) return '';
    const from = (this.filters().page - 1) * EQUIVALENCES_PAGE_SIZE + 1;
    const to = Math.min(total, from + this.items().length - 1);
    const fmt = (n: number) => n.toLocaleString('es-BO');
    return `${fmt(from)}–${fmt(to)} de ${fmt(total)} ${total === 1 ? 'vínculo' : 'vínculos'}`;
  });

  protected readonly categoryOptions = computed<SelectOption[]>(() => this.options().categories.map((c) => ({ value: c.id, label: c.name })));
  protected readonly brandOptions = computed<SelectOption[]>(() => this.options().brands.map((b) => ({ value: b.id, label: b.name })));

  private readonly params = computed(() => toQuery(this.filters()));

  constructor() {
    // keep the search box in sync with the URL (back/forward, "clear")
    effect(() => this.searchText.set(this.filters().q));
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));

    toObservable(this.params)
      .pipe(
        tap(() => this.state.set(this.canView() ? 'loading' : 'forbidden')),
        switchMap((params) => {
          if (!this.canView()) return of(null);
          return this.api.list(params).pipe(
            map((data) => ({ data })),
            catchError((err) => of({ error: problemOf(err) })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.show(result));

    if (this.canView()) {
      this.productsApi
        .filterOptions()
        .pipe(
          catchError(() => {
            this.toast.danger('No pudimos cargar las opciones de filtro.');
            return of(null);
          }),
          takeUntilDestroyed(),
        )
        .subscribe((options) => options && this.options.set(options));
    }
  }

  private show(result: { data: EquivalenceListResponse } | { error: ReturnType<typeof problemOf> } | null) {
    if (!result) return;
    if ('error' in result) {
      this.errorMessage.set(result.error.message);
      this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    this.data.set(result.data);
    this.state.set('ready');
  }

  protected productOf(rowId: string, side: 'A' | 'B'): EquivalenceListProduct | null {
    const item = this.itemById().get(rowId);
    return item ? (side === 'A' ? item.productA : item.productB) : null;
  }

  protected flagOf(product: EquivalenceListProduct) {
    return flagOf(product.country?.code);
  }

  protected thumbIcon(product: EquivalenceListProduct) {
    return thumbIconOf(product.categoryIcon);
  }

  /** Both stocks of a row, side A then side B. */
  protected stockOf(rowId: string) {
    const item = this.itemById().get(rowId);
    return item ? [item.productA, item.productB].map((p) => ({ quantity: p.totalStock, out: p.totalStock <= 0 })) : [];
  }

  protected setFilter(key: FilterKey, value: unknown) {
    this.navigate({ [key]: value ? String(value) : null, page: null });
  }

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null, page: null }), 300);
  }

  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.navigate({ q: null, brandId: null, categoryId: null, kind: null, page: null });
  }

  protected goToPage(page: number) {
    if (page !== this.filters().page) this.navigate({ page: page > 1 ? String(page) : null });
  }

  protected retry() {
    this.state.set('loading');
    this.api
      .list(this.params())
      .pipe(
        map((data) => ({ data })),
        catchError((err) => of({ error: problemOf(err) })),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.show(result));
  }

  /** Opens the sheet of a product. */
  protected openProduct(product: EquivalenceListProduct) {
    void this.router.navigate(['/inventory/products', product.id]);
  }

  /** IN-15c · The link form, with no product of its own (the list has none to start from). */
  protected openLink() {
    void this.router.navigate(['/inventory/equivalences/new']);
  }

  protected itemOf(rowId: string): EquivalenceListItem | null {
    return this.itemById().get(rowId) ?? null;
  }

  protected askUnlink(item: EquivalenceListItem) {
    this.unlinkTarget.set({
      id: item.id,
      pairLabel: `${item.productA.manufacturerCode} · ${item.productA.brand.name} y ${item.productB.manufacturerCode} · ${item.productB.brand.name}`,
    });
    this.unlinkOpen.set(true);
  }

  /** Decision #34 · Approves a pending link. */
  protected approve(item: EquivalenceListItem) {
    if (this.approvingId()) return;
    this.approvingId.set(item.id);
    this.api.approve(item.id).subscribe({
      next: () => {
        this.approvingId.set(null);
        this.toast.success('Equivalencia aprobada');
        this.retry();
      },
      error: (err: unknown) => {
        this.approvingId.set(null);
        this.toast.danger(problemOf(err).message);
        this.retry();
      },
    });
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
