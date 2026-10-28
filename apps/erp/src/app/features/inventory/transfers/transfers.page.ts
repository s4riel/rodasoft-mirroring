import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { TransferListItem, TransferListResponse, TransferWarehouseOption } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  IconComponent,
  InputDirective,
  PageHeaderComponent,
  PaginationComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { TransfersApi } from './transfers-api.service';
import { parseDay, parseStatus, rangeLabel, STATUS_OPTIONS, toQuery, toRow, TRANSFERS_PAGE_SIZE, TransferUrlFilters } from './transfers.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type FilterKey = 'status' | 'originWarehouseId' | 'destinationWarehouseId' | 'from' | 'to';

const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'Número', type: 'custom' },
  { key: 'route', label: 'Origen → destino', type: 'text' },
  { key: 'status', label: 'Estado', type: 'status' },
  { key: 'products', label: 'Productos', type: 'number' },
  { key: 'pieces', label: 'Piezas', type: 'number' },
  { key: 'value', label: 'Valor', type: 'number' },
  { key: 'createdBy', label: 'Creada por', type: 'text' },
  { key: 'createdAt', label: 'Creada', type: 'text' },
  { key: 'sentAt', label: 'Enviada', type: 'text' },
];

/** IN-05 · Transfers between warehouses, with filters, loading, empty, error and no-permission states. */
@Component({
  selector: 'rs-transfers-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    IconComponent,
    InputDirective,
    PageHeaderComponent,
    PaginationComponent,
    RouterLink,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfers.page.html',
  styleUrl: './transfers.page.scss',
})
export class TransfersPage {
  private readonly api = inject(TransfersApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Inventario', link: '/inventory' }, { label: 'Transferencias' }];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  protected readonly canView = computed(() => this.ctx.can('inventory.transfers.create') || this.ctx.can('inventory.transfers.receive'));
  protected readonly canCreate = computed(() => this.ctx.can('inventory.transfers.create'));

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly filters = computed<TransferUrlFilters>(() => {
    const q = this.queryParams();
    return {
      q: q.get('q') ?? '',
      status: parseStatus(q.get('status')),
      originWarehouseId: q.get('originWarehouseId'),
      destinationWarehouseId: q.get('destinationWarehouseId'),
      from: parseDay(q.get('from')),
      to: parseDay(q.get('to')),
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });

  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<TransferListResponse | null>(null);
  private readonly warehouses = signal<readonly TransferWarehouseOption[]>([]);

  protected readonly items = computed<readonly TransferListItem[]>(() => this.data()?.items ?? []);
  protected readonly rows = computed(() => this.items().map(toRow));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / TRANSFERS_PAGE_SIZE)));
  protected readonly range = computed(() => rangeLabel(this.filters().page, this.items().length, this.total()));

  protected readonly warehouseOptions = computed<SelectOption[]>(() =>
    this.warehouses().map((w) => ({ value: w.id, label: `${w.branch.name} · ${w.name}` })),
  );

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.status || f.originWarehouseId || f.destinationWarehouseId || f.from || f.to || f.q) || this.searchText().trim() !== '';
  });
  /** The company has no transfers at all: the first-use empty state. */
  protected readonly showEmpty = computed(() => this.state() === 'ready' && this.total() === 0 && !this.hasFilters());
  /** Filters that leave nothing: another empty state, with "Limpiar filtros". */
  protected readonly showNoResults = computed(() => this.state() === 'ready' && this.total() === 0 && this.hasFilters());

  private readonly params = computed(() => toQuery(this.filters()));

  constructor() {
    // keep the search box in sync with the URL (back/forward, "clear")
    effect(() => this.searchText.set(this.filters().q));
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));

    if (this.canCreate()) {
      // the warehouses only fill the filter selects: without them the list still works
      this.api
        .warehouses()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({ next: (r) => this.warehouses.set(r.items), error: () => this.warehouses.set([]) });
    }

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

  private show(result: { data: TransferListResponse } | { error: ReturnType<typeof problemOf> } | null) {
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

  protected onDate(key: 'from' | 'to', event: Event) {
    this.setFilter(key, (event.target as HTMLInputElement).value);
  }

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null, page: null }), 300);
  }

  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.navigate({ q: null, status: null, originWarehouseId: null, destinationWarehouseId: null, from: null, to: null, page: null });
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

  protected itemOf(rowId: string): TransferListItem | null {
    return this.items().find((i) => i.id === rowId) ?? null;
  }

  /** A draft opens in the editor; every other status opens the read-only detail. */
  protected linkOf(item: TransferListItem): string[] {
    return ['/inventory/transfers', item.id, ...(item.status === 'DRAFT' ? ['edit'] : [])];
  }

  protected openNew() {
    void this.router.navigate(['/inventory/transfers/new']);
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
