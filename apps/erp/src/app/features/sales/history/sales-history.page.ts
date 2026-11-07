import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { SaleListItem, SaleListResponse } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  type DateRangeValue,
  DateRangePickerComponent,
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
  SkeletonComponent,
  StatusPillComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { catchError, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import {
  METHOD_OPTIONS,
  parseMethod,
  parseStatus,
  rangeLabel,
  ROW_MENU,
  SALES_PAGE_SIZE,
  SaleUrlFilters,
  STATUS_OPTIONS,
  toCsv,
  toQuery,
  toRow,
  toTotals,
} from './sale-format';
import { SalesHistoryApi } from './sales-history-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type FilterKey = 'status' | 'method';

/** "Exportar" reads pages of 100 (the API's largest) and stops after this many, so a huge list cannot hang the tab. */
const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_PAGES = 50;

/** The columns of the Figma table of VP-01a, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'N.º', type: 'custom', width: '8rem' },
  { key: 'customer', label: 'Cliente', type: 'text' },
  { key: 'date', label: 'Fecha', type: 'number', width: '10rem' },
  { key: 'items', label: 'Ítems', type: 'number', width: '6.25rem' },
  { key: 'total', label: 'Total', type: 'number', width: '9rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '13rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

/** VP-01a/b/c/d · Sales made: filters, the list with its row menu, and the loading, empty, error and no-permission states. */
@Component({
  selector: 'rs-sales-history-page',
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
  templateUrl: './sales-history.page.html',
  styleUrl: './sales-history.page.scss',
})
export class SalesHistoryPage {
  private readonly api = inject(SalesHistoryApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Ventas y POS', link: '/sales' }, { label: 'Ventas realizadas' }];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly methodOptions = METHOD_OPTIONS;
  protected readonly rowMenu = ROW_MENU;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly filters = computed<SaleUrlFilters>(() => {
    const q = this.queryParams();
    return {
      q: q.get('q') ?? '',
      status: parseStatus(q.get('status')),
      method: parseMethod(q.get('method')),
      from: q.get('from'),
      to: q.get('to'),
      cashierId: q.get('cashierId'),
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });

  protected readonly range = computed<DateRangeValue>(() => ({ from: this.filters().from, to: this.filters().to }));

  protected readonly exporting = signal(false);
  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<SaleListResponse | null>(null);

  protected readonly items = computed<readonly SaleListItem[]>(() => this.data()?.items ?? []);
  protected readonly rows = computed(() => this.items().map(toRow));
  protected readonly totals = computed(() => toTotals(this.items()));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / SALES_PAGE_SIZE)));
  protected readonly rangeText = computed(() => rangeLabel(this.filters().page, this.items().length, this.total()));

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.status || f.method || f.from || f.to || f.q || f.cashierId) || this.searchText().trim() !== '';
  });
  /** The company has no sales at all: the first-use empty state (VP-01b). */
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
        tap(() => this.state.set('loading')),
        switchMap((params) =>
          this.api.list(params).pipe(
            map((data) => ({ data })),
            catchError((err) => of({ error: problemOf(err) })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.show(result));
  }

  private show(result: { data: SaleListResponse } | { error: ReturnType<typeof problemOf> }) {
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

  protected setRange(range: DateRangeValue) {
    this.navigate({ from: range.from, to: range.to, page: null });
  }

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null, page: null }), 300);
  }

  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.navigate({ q: null, status: null, method: null, from: null, to: null, cashierId: null, page: null });
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

  protected itemOf(rowId: string): SaleListItem | null {
    return this.items().find((i) => i.id === rowId) ?? null;
  }

  protected menuLabel(item: SaleListItem): string {
    return `Acciones de la venta ${item.number}`;
  }

  protected openNewSale() {
    void this.router.navigate(['/sales/pos']);
  }

  /** The chosen action of a row's ⋯ menu. */
  protected onAction(item: SaleListItem, key: string) {
    if (key === 'view') void this.router.navigate(['/sales/history', item.id]);
    if (key === 'reprint') window.open(this.router.serializeUrl(this.router.createUrlTree(['/sales/receipts', item.id, 'print'], { queryParams: { reprint: 1 } })), '_blank', 'noopener');
  }

  /**
   * "Exportar": the sales the filters leave, every page of them, as a CSV the user saves. It reads the pages one after
   * the other (the API caps a page at 100) and stops at a safety limit, which the toast says when it is reached.
   */
  protected async exportCsv() {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const items: SaleListItem[] = [];
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
      link.download = `ventas-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      if (items.length < total) this.toast.warning(`Se exportaron ${items.length} de ${total} ventas. Filtra para exportar el resto.`);
      else this.toast.success(`${items.length} ${items.length === 1 ? 'venta exportada' : 'ventas exportadas'}`);
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
