import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { WarehouseListItem, WarehouseListResponse } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  IconButtonComponent,
  IconComponent,
  PageHeaderComponent,
  PaginationComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  ToastOutletComponent,
  TooltipDirective,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { WarehousesApi } from './warehouses-api.service';
import { parseStatus, rangeLabel, STATUS_OPTIONS, toQuery, toRow, WAREHOUSES_PAGE_SIZE, WarehouseUrlFilters } from './warehouses.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type FilterKey = 'branchId' | 'status';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code' },
  { key: 'name', label: 'Nombre', type: 'text' },
  { key: 'branch', label: 'Sucursal', type: 'text' },
  { key: 'main', label: 'Principal', type: 'status' },
  { key: 'visibleInStore', label: 'Tienda en línea', type: 'status' },
  { key: 'products', label: 'Productos', type: 'number' },
  { key: 'units', label: 'Unidades', type: 'number' },
  { key: 'status', label: 'Estado', type: 'status' },
  { key: 'actions', label: 'Acciones', type: 'custom', align: 'end' },
];

/** IN-14 · Warehouses of every branch the user operates, with filters, loading, empty, error and no-permission states. */
@Component({
  selector: 'rs-warehouses-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    IconButtonComponent,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
    TooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './warehouses.page.html',
  styleUrl: './warehouses.page.scss',
})
export class WarehousesPage {
  private readonly api = inject(WarehousesApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Inventario', link: '/inventory' }, { label: 'Almacenes' }];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  protected readonly canView = computed(() => this.ctx.can('inventory.products.view'));
  protected readonly canManage = computed(() => this.ctx.can('inventory.warehouses.manage'));

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly filters = computed<WarehouseUrlFilters>(() => {
    const q = this.queryParams();
    return {
      q: q.get('q') ?? '',
      branchId: q.get('branchId'),
      status: parseStatus(q.get('status')),
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });

  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<WarehouseListResponse | null>(null);

  protected readonly items = computed<readonly WarehouseListItem[]>(() => this.data()?.items ?? []);
  protected readonly rows = computed(() => this.items().map(toRow));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / WAREHOUSES_PAGE_SIZE)));
  protected readonly range = computed(() => rangeLabel(this.filters().page, this.items().length, this.total()));

  protected readonly branchOptions = computed<SelectOption[]>(() => this.ctx.branches().map((b) => ({ value: b.id, label: b.name })));

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.branchId || f.status || f.q) || this.searchText().trim() !== '';
  });
  /** The company has no warehouses at all: the first-use empty state. */
  protected readonly showEmpty = computed(() => this.state() === 'ready' && this.total() === 0 && !this.hasFilters());
  /** Filters that leave nothing: another empty state, with "Limpiar filtros". */
  protected readonly showNoResults = computed(() => this.state() === 'ready' && this.total() === 0 && this.hasFilters());

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
  }

  private show(result: { data: WarehouseListResponse } | { error: ReturnType<typeof problemOf> } | null) {
    if (!result) return;
    if ('error' in result) {
      this.errorMessage.set(result.error.message);
      this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    this.data.set(result.data);
    this.state.set('ready');
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
    this.navigate({ q: null, branchId: null, status: null, page: null });
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
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.show(result));
  }

  protected itemOf(rowId: string): WarehouseListItem | null {
    return this.items().find((i) => i.id === rowId) ?? null;
  }

  protected openNew() {
    void this.router.navigate(['/inventory/warehouses/new']);
  }

  protected openEdit(item: WarehouseListItem) {
    void this.router.navigate(['/inventory/warehouses', item.id, 'edit']);
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
