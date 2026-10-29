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
  PageHeaderComponent,
  PaginationComponent,
  RowActionComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  StatusPillComponent,
  ToastOutletComponent,
  ToastService,
  TooltipDirective,
} from '@rodasoft/ui';
import { catchError, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { TransfersApi } from './transfers-api.service';
import { parseStatus, pendingAdjustmentTooltip, rangeLabel, rowMenuOf, STATUS_OPTIONS, toCsv, toQuery, toRow, toTotals, TRANSFERS_PAGE_SIZE, TransferUrlFilters, TRANSFER_STATUS_PILLS } from './transfers.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type FilterKey = 'status' | 'originWarehouseId' | 'destinationWarehouseId';

/** "Exportar" reads pages of 100 (the API's largest) and stops after this many, so a huge list cannot hang the tab. */
const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_PAGES = 50;

/** The columns of the Figma table of IN-05, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'N.º', type: 'custom', width: '7.5rem' },
  { key: 'route', label: 'Ruta', type: 'text' },
  { key: 'detail', label: 'Detalle', type: 'text' },
  { key: 'products', label: 'Ítems', type: 'number', width: '6.25rem' },
  { key: 'date', label: 'Fecha', type: 'number', width: '8.125rem' },
  // a custom cell: the pill, and a warning next to it when the receipt left an adjustment to review
  { key: 'status', label: 'Estado', type: 'custom', width: '13rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

/** IN-05 · Transfers between branches, with filters, loading, empty, error and no-permission states. */
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
    PageHeaderComponent,
    PaginationComponent,
    RowActionComponent,
    RouterLink,
    SelectComponent,
    SkeletonComponent,
    StatusPillComponent,
    ToastOutletComponent,
    TooltipDirective,
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
  private readonly toast = inject(ToastService);

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
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });

  protected readonly exporting = signal(false);
  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<TransferListResponse | null>(null);
  private readonly warehouses = signal<readonly TransferWarehouseOption[]>([]);

  protected readonly items = computed<readonly TransferListItem[]>(() => this.data()?.items ?? []);
  protected readonly rows = computed(() => this.items().map(toRow));
  protected readonly totals = computed(() => toTotals(this.items()));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / TRANSFERS_PAGE_SIZE)));
  protected readonly range = computed(() => rangeLabel(this.filters().page, this.items().length, this.total()));

  protected readonly warehouseOptions = computed<SelectOption[]>(() =>
    this.warehouses().map((w) => ({ value: w.id, label: `${w.branch.name} · ${w.name}` })),
  );

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.status || f.originWarehouseId || f.destinationWarehouseId || f.q) || this.searchText().trim() !== '';
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

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null, page: null }), 300);
  }

  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.navigate({ q: null, status: null, originWarehouseId: null, destinationWarehouseId: null, page: null });
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

  protected pillOf(item: TransferListItem) {
    return TRANSFER_STATUS_PILLS[item.status];
  }

  protected reviewTooltip(number: string): string {
    return pendingAdjustmentTooltip(number);
  }

  protected itemOf(rowId: string): TransferListItem | null {
    return this.items().find((i) => i.id === rowId) ?? null;
  }

  /** A draft opens in the editor; every other status opens the read-only detail. */
  protected linkOf(item: TransferListItem): string[] {
    return ['/inventory/transfers', item.id, ...(item.status === 'DRAFT' ? ['edit'] : [])];
  }

  protected openIncoming() {
    void this.router.navigate(['/inventory/transfers/incoming']);
  }

  protected openNew() {
    void this.router.navigate(['/inventory/transfers/new']);
  }

  /** The ⋯ menu of a row: edit a draft, or read any other transfer. */
  protected menuOf(item: TransferListItem) {
    return rowMenuOf(item);
  }

  protected openRow(item: TransferListItem) {
    void this.router.navigate(this.linkOf(item));
  }

  /**
   * "Exportar": the transfers the filters leave, every page of them, as a CSV the user saves. It reads the pages one after
   * the other (the API caps a page at 100) and stops at a safety limit, which the toast says when it is reached.
   */
  protected async exportCsv() {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const items: TransferListItem[] = [];
      let page = 1;
      let total = 0;
      do {
        const response = await firstValueFrom(this.api.list({ ...this.params(), page, pageSize: EXPORT_PAGE_SIZE }));
        items.push(...response.items);
        total = response.total;
        page += 1;
      } while (items.length < total && page <= EXPORT_MAX_PAGES);

      // a byte order mark makes Excel read the accents as UTF-8
      const blob = new Blob(['﻿', toCsv(items)], { type: 'text/csv;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `transferencias-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      if (items.length < total) this.toast.warning(`Se exportaron ${items.length} de ${total} transferencias. Filtra para exportar el resto.`);
      else this.toast.success(`${items.length} ${items.length === 1 ? 'transferencia exportada' : 'transferencias exportadas'}`);
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    } finally {
      this.exporting.set(false);
    }
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
