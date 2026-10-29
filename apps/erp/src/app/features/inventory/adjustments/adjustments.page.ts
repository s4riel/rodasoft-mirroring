import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { AdjustmentListItem, AdjustmentListResponse, WarehouseListItem } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DateRangePickerComponent,
  DateRangeValue,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  IconComponent,
  PageHeaderComponent,
  PaginationComponent,
  RowActionComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  StatusPillComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { WarehousesApi } from '../warehouses/warehouses-api.service';
import { AdjustmentsApi } from './adjustments-api.service';
import {
  ADJUSTMENT_STATUS_PILLS,
  adjustmentErrorMessage,
  ADJUSTMENTS_PAGE_SIZE,
  AdjustmentUrlFilters,
  parseDate,
  parseReason,
  parseStatus,
  rangeLabel,
  REASON_OPTIONS,
  STATUS_OPTIONS,
  toQuery,
  toRow,
  toTotals,
} from './adjustments.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type FilterKey = 'status' | 'warehouseId' | 'reason' | 'from' | 'to';

/** The columns of the Figma table of IN-27, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'N.º', type: 'custom', width: '7.5rem' },
  { key: 'date', label: 'Fecha', type: 'number', width: '8.125rem' },
  { key: 'warehouse', label: 'Almacén', type: 'text' },
  { key: 'reason', label: 'Motivo', type: 'text' },
  { key: 'lines', label: 'Ítems', type: 'number', width: '6.25rem' },
  { key: 'value', label: 'Valor', type: 'number', width: '8.125rem' },
  { key: 'createdBy', label: 'Registrado por', type: 'text' },
  { key: 'status', label: 'Estado', type: 'custom', width: '13rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

/** IN-27 · Stock adjustments, with filters, loading, empty, error and no-permission states. */
@Component({
  selector: 'rs-adjustments-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DateRangePickerComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    RouterLink,
    RowActionComponent,
    SelectComponent,
    SkeletonComponent,
    StatusPillComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './adjustments.page.html',
  styleUrl: './adjustments.page.scss',
})
export class AdjustmentsPage {
  private readonly api = inject(AdjustmentsApi);
  private readonly warehousesApi = inject(WarehousesApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Inventario', link: '/inventory' }, { label: 'Ajustes' }];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly reasonOptions = REASON_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);
  protected readonly rowMenu = [{ key: 'open', label: 'Ver detalle', icon: 'eye' as const }];

  protected readonly canView = computed(() => this.ctx.can('inventory.adjustments.create') || this.ctx.can('inventory.adjustments.approve'));
  protected readonly canCreate = computed(() => this.ctx.can('inventory.adjustments.create'));

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly filters = computed<AdjustmentUrlFilters>(() => {
    const q = this.queryParams();
    return {
      q: q.get('q') ?? '',
      status: parseStatus(q.get('status')),
      warehouseId: q.get('warehouseId'),
      reason: parseReason(q.get('reason')),
      from: parseDate(q.get('from')),
      to: parseDate(q.get('to')),
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });

  protected readonly dateRange = computed<DateRangeValue>(() => ({ from: this.filters().from, to: this.filters().to }));

  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<AdjustmentListResponse | null>(null);
  private readonly warehouses = signal<readonly WarehouseListItem[]>([]);

  protected readonly items = computed<readonly AdjustmentListItem[]>(() => this.data()?.items ?? []);
  protected readonly rows = computed(() => this.items().map(toRow));
  protected readonly totals = computed(() => toTotals(this.items()));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / ADJUSTMENTS_PAGE_SIZE)));
  protected readonly range = computed(() => rangeLabel(this.filters().page, this.items().length, this.total()));

  protected readonly warehouseOptions = computed<SelectOption[]>(() =>
    this.warehouses().map((w) => ({ value: w.id, label: `${w.branch.name} · ${w.name}` })),
  );

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.status || f.warehouseId || f.reason || f.from || f.to || f.q) || this.searchText().trim() !== '';
  });
  /** The company has no adjustments at all: the first-use empty state. */
  protected readonly showEmpty = computed(() => this.state() === 'ready' && this.total() === 0 && !this.hasFilters());
  /** Filters that leave nothing: another empty state, with "Limpiar filtros". */
  protected readonly showNoResults = computed(() => this.state() === 'ready' && this.total() === 0 && this.hasFilters());

  private readonly params = computed(() => toQuery(this.filters()));

  constructor() {
    // keep the search box in sync with the URL (back/forward, "clear")
    effect(() => this.searchText.set(this.filters().q));
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));

    // the warehouses only fill the filter select: without them the list still works
    this.warehousesApi
      .list({ status: 'ACTIVE', pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (r) => this.warehouses.set(r.items), error: () => this.warehouses.set([]) });

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

  private show(result: { data: AdjustmentListResponse } | { error: ReturnType<typeof problemOf> } | null) {
    if (!result) return;
    if ('error' in result) {
      this.errorMessage.set(adjustmentErrorMessage(result.error));
      this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    this.data.set(result.data);
    this.state.set('ready');
  }

  protected setFilter(key: FilterKey, value: unknown) {
    this.navigate({ [key]: value ? String(value) : null, page: null });
  }

  protected onDateRange(range: DateRangeValue) {
    this.navigate({ from: range.from, to: range.to, page: null });
  }

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null, page: null }), 300);
  }

  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.navigate({ q: null, status: null, warehouseId: null, reason: null, from: null, to: null, page: null });
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

  protected pillOf(item: AdjustmentListItem) {
    return ADJUSTMENT_STATUS_PILLS[item.status];
  }

  protected itemOf(rowId: string): AdjustmentListItem | null {
    return this.items().find((i) => i.id === rowId) ?? null;
  }

  protected openNew() {
    void this.router.navigate(['/inventory/adjustments/new']);
  }

  protected openRow(item: AdjustmentListItem) {
    void this.router.navigate(['/inventory/adjustments', item.id]);
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
