import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { KardexLedgerResponse, KardexLedgerRow, KardexResponse, ProductListItem } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DateRangePickerComponent,
  DateRangeValue,
  DocTableCellDirective,
  DocTableComponent,
  DocTableRow,
  EmptyStateIllustratedComponent,
  FlagComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  PageHeaderComponent,
  PaginationComponent,
  ProductThumbComponent,
  RowActionComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  StatusPillComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { catchError, debounceTime, distinctUntilChanged, map, type Observable, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { flagOf, thumbIconOf } from '../products/product-list.mapper';
import { ProductsApi } from '../products/products-api.service';
import { WarehousesApi } from '../warehouses/warehouses-api.service';
import { KardexApi } from './kardex-api.service';
import {
  columnsOf,
  counterpartText,
  hasLedgerFilters,
  kardexErrorMessage,
  KardexUrlFilters,
  KARDEX_PAGE_SIZE,
  ledgerColumnsOf,
  ledgerDocumentRoute,
  LEDGER_PILLS,
  ledgerMenuOf,
  ledgerTotalsRow,
  openingRow,
  parseDay,
  parseType,
  rangeLabel,
  shownRange,
  toLedgerRow,
  toQuery,
  toRow,
  totalsRow,
  TYPE_OPTIONS,
} from './kardex.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type Loaded = { kind: 'product'; data: KardexResponse } | { kind: 'ledger'; data: KardexLedgerResponse };

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_RESULTS = 8;

/** The "all warehouses" option of the filter: the value is `null`, the same as no warehouse in the URL. */
const ALL_WAREHOUSES: SelectOption = { value: null, label: 'Todos los almacenes' };

/**
 * IN-09 · Kardex. Without a product it is the ledger of every movement (search, branch, type and dates); with a product it is
 * that product's kardex: opening balance, running balance and closing balance by warehouse and dates.
 */
@Component({
  selector: 'rs-kardex-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DateRangePickerComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FlagComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    PageHeaderComponent,
    PaginationComponent,
    ProductThumbComponent,
    RowActionComponent,
    SelectComponent,
    SkeletonComponent,
    StatusPillComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kardex.page.html',
  styleUrl: './kardex.page.scss',
})
export class KardexPage {
  private readonly api = inject(KardexApi);
  private readonly products = inject(ProductsApi);
  private readonly warehousesApi = inject(WarehousesApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Inventario', link: '/inventory' }, { label: 'Kardex' }];
  protected readonly skeletonRows = Array.from({ length: 6 }, (_, i) => i);
  protected readonly typeOptions = TYPE_OPTIONS;

  protected readonly canView = computed(() => this.ctx.can('inventory.kardex.view'));

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly filters = computed<KardexUrlFilters>(() => {
    const q = this.queryParams();
    return {
      productId: q.get('productId'),
      warehouseId: q.get('warehouseId'),
      branchId: q.get('branchId'),
      type: parseType(q.get('type')),
      q: q.get('q') ?? '',
      from: parseDay(q.get('from')),
      to: parseDay(q.get('to')),
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });

  /** No product picked: the page is the ledger of every movement. */
  protected readonly isLedger = computed(() => !this.filters().productId);

  /** The range the picker shows: the URL's, or the current month the API falls back to. */
  protected readonly dateRange = computed<DateRangeValue>(() => shownRange(this.filters()));

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorCode = signal('');
  protected readonly errorMessage = signal('');
  /** The kardex of the product in the URL. */
  protected readonly data = signal<KardexResponse | null>(null);
  /** The ledger, when there is no product in the URL. */
  protected readonly ledgerData = signal<KardexLedgerResponse | null>(null);
  protected readonly exporting = signal(false);
  private readonly warehouses = signal<readonly { id: string; label: string }[]>([]);
  private readonly reload = signal(0);

  protected readonly warehouseOptions = computed<SelectOption[]>(() => [
    ALL_WAREHOUSES,
    ...this.warehouses().map((w) => ({ value: w.id, label: w.label })),
  ]);
  protected readonly branchOptions = computed<SelectOption[]>(() => [
    { value: null, label: 'Todas las sucursales' },
    ...this.ctx.branches().map((b) => ({ value: b.id, label: b.name })),
  ]);
  protected readonly allTypes: SelectOption = { value: null, label: 'Todos los tipos' };
  protected readonly typeChoices = computed<SelectOption[]>(() => [this.allTypes, ...this.typeOptions]);

  // ── The kardex of a product ──────────────────────────────────────────────────

  protected readonly includesCost = computed(() => (this.isLedger() ? this.ledgerData()?.includesCost : this.data()?.includesCost) ?? false);
  protected readonly columns = computed(() => columnsOf(this.includesCost()));
  protected readonly items = computed(() => this.data()?.items ?? []);
  protected readonly rows = computed<DocTableRow[]>(() => {
    const d = this.data();
    if (!d) return [];
    return [openingRow(d.openingBalance, d.includesCost), ...d.items.map((r) => toRow(r, d.includesCost))];
  });
  protected readonly totals = computed(() => {
    const d = this.data();
    return d ? totalsRow(d) : null;
  });

  /** The product the page is about, once the kardex has answered for the one in the URL. */
  protected readonly product = computed(() => {
    const d = this.data();
    return d && d.product.id === this.filters().productId ? d.product : null;
  });

  // ── The ledger of every movement ─────────────────────────────────────────────

  protected readonly ledgerColumns = computed(() => ledgerColumnsOf(this.includesCost()));
  protected readonly ledgerItems = computed<readonly KardexLedgerRow[]>(() => this.ledgerData()?.items ?? []);
  protected readonly ledgerRows = computed<DocTableRow[]>(() => this.ledgerItems().map((r) => toLedgerRow(r, this.includesCost())));
  protected readonly ledgerTotals = computed(() => {
    const d = this.ledgerData();
    return d ? ledgerTotalsRow(d) : null;
  });
  protected readonly hasFilters = computed(() => hasLedgerFilters(this.filters()) || this.searchText().trim() !== '');
  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  // ── Both ─────────────────────────────────────────────────────────────────────

  protected readonly total = computed(() => (this.isLedger() ? this.ledgerData()?.total : this.data()?.total) ?? 0);
  protected readonly shown = computed(() => (this.isLedger() ? this.ledgerItems().length : this.items().length));
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / KARDEX_PAGE_SIZE)));
  protected readonly range = computed(() => rangeLabel(this.filters().page, this.shown(), this.total()));
  protected readonly isEmptyRange = computed(() => this.state() === 'ready' && this.total() === 0);
  protected readonly pills = LEDGER_PILLS;

  // ── Product picker ──────────────────────────────────────────────────────────

  protected readonly query = signal('');
  protected readonly results = signal<readonly ProductListItem[] | null>(null);
  protected readonly searching = signal(false);
  protected readonly searchFailed = signal(false);

  constructor() {
    // keep the search box in sync with the URL (back/forward, "clear")
    effect(() => this.searchText.set(this.filters().q));
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));

    // the warehouses only fill the filter: without them the kardex still works for all warehouses
    this.warehousesApi
      .list({ pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => this.warehouses.set(r.items.map((w) => ({ id: w.id, label: `${w.branch.name} · ${w.name}` }))),
        error: () => this.warehouses.set([]),
      });

    toObservable(computed(() => ({ query: toQuery(this.filters()), can: this.canView(), reload: this.reload() })))
      .pipe(
        tap(({ can }) => this.state.set(can ? 'loading' : 'forbidden')),
        switchMap(({ query, can }) => {
          if (!can) return of(null);
          const request: Observable<Loaded> =
            query.productId !== undefined
              ? this.api.get({ ...query, productId: query.productId }).pipe(map((data) => ({ kind: 'product' as const, data })))
              : this.api.ledger(query).pipe(map((data) => ({ kind: 'ledger' as const, data })));
          return request.pipe(catchError((err) => of({ error: problemOf(err) })));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.show(result));

    toObservable(this.query)
      .pipe(
        map((text) => text.trim()),
        distinctUntilChanged(),
        tap((text) => {
          if (!text) {
            this.results.set(null);
            this.searching.set(false);
          }
        }),
        debounceTime(SEARCH_DEBOUNCE_MS),
        switchMap((text) => {
          if (!text) return of(null);
          this.searching.set(true);
          return this.products.list({ search: text, page: 1, pageSize: SEARCH_RESULTS }).pipe(
            map((res) => ({ items: res.items })),
            catchError(() => of({ failed: true as const })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        this.searching.set(false);
        if (!res) return;
        this.searchFailed.set('failed' in res);
        this.results.set('failed' in res ? [] : res.items);
      });
  }

  private show(result: Loaded | { error: ReturnType<typeof problemOf> } | null) {
    if (!result) {
      this.data.set(null);
      this.ledgerData.set(null);
      return;
    }
    if ('error' in result) {
      this.data.set(null);
      this.ledgerData.set(null);
      this.errorCode.set(result.error.code);
      this.errorMessage.set(kardexErrorMessage(result.error));
      this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    if (result.kind === 'product') {
      this.data.set(result.data);
      this.ledgerData.set(null);
    } else {
      this.ledgerData.set(result.data);
      this.data.set(null);
    }
    this.state.set('ready');
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  protected setQuery(text: string) {
    this.query.set(text);
  }

  /** Picks the product: the page turns from the ledger into that product's kardex, and the ledger-only filters go away. */
  protected pick(product: ProductListItem) {
    this.openProduct(product.id);
  }

  private openProduct(productId: string) {
    this.query.set('');
    this.results.set(null);
    clearTimeout(this.searchTimer);
    this.navigate({ productId, warehouseId: null, branchId: null, type: null, q: null, page: null });
  }

  /** Back to the ledger of every movement. */
  protected changeProduct() {
    this.data.set(null);
    this.state.set('loading');
    this.navigate({ productId: null, warehouseId: null, page: null });
  }

  protected setWarehouse(value: unknown) {
    this.navigate({ warehouseId: value ? String(value) : null, page: null });
  }

  protected setBranch(value: unknown) {
    this.navigate({ branchId: value ? String(value) : null, page: null });
  }

  protected setType(value: unknown) {
    this.navigate({ type: value ? String(value) : null, page: null });
  }

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null, page: null }), SEARCH_DEBOUNCE_MS);
  }

  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.navigate({ q: null, type: null, branchId: null, warehouseId: null, from: null, to: null, page: null });
  }

  protected onDateRange(range: DateRangeValue) {
    this.navigate({ from: range.from, to: range.to, page: null });
  }

  protected goToPage(page: number) {
    if (page !== this.filters().page) this.navigate({ page: page > 1 ? String(page) : null });
  }

  protected retry() {
    this.reload.update((n) => n + 1);
  }

  /** The row menu of the ledger: open the source document, or the kardex of the row's product. */
  protected onRowMenu(item: KardexLedgerRow, key: string) {
    if (key === 'product') {
      this.openProduct(item.product.id);
      return;
    }
    const route = key === 'document' ? ledgerDocumentRoute(item) : null;
    if (route) void this.router.navigateByUrl(route);
  }

  protected export() {
    if (this.exporting() || this.state() !== 'ready') return;
    this.exporting.set(true);
    const { page: _page, pageSize: _pageSize, ...query } = toQuery(this.filters());
    this.api
      .export(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.exporting.set(false);
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = this.product() ? `kardex-${this.product()?.manufacturerCode}.xlsx` : 'kardex-movimientos.xlsx';
          link.click();
          URL.revokeObjectURL(url);
        },
        error: (err) => {
          this.exporting.set(false);
          this.toast.danger(this.exportError(err));
        },
      });
  }

  /** The error body of a blob response is a blob too, so the code is read from the status only. */
  private exportError(err: unknown): string {
    const status = (err as { status?: number }).status;
    if (status === 422) return kardexErrorMessage({ code: 'EXPORT_TOO_LARGE', message: '' });
    return 'No pudimos exportar el kardex. Intenta de nuevo.';
  }

  // ── View helpers ────────────────────────────────────────────────────────────

  protected ledgerItemOf(rowId: string): KardexLedgerRow | null {
    return this.ledgerItems().find((i) => i.id === rowId) ?? null;
  }

  protected menuOf(item: KardexLedgerRow) {
    return ledgerMenuOf(item);
  }

  protected counterpart(item: KardexLedgerRow): string {
    return counterpartText(item);
  }

  protected thumbIcon(product: ProductListItem) {
    return thumbIconOf(product.category.icon);
  }

  protected flag(product: ProductListItem) {
    return flagOf(product.country?.code);
  }

  protected measures(product: ProductListItem): string {
    const d = product.dimensions;
    const parts = d ? [d.innerDiameter, d.outerDiameter, d.width].filter((x): x is string => !!x) : [];
    return parts.length ? `${parts.join(' × ')} mm · ${product.name}` : product.name;
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
