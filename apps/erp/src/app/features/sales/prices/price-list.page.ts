import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { PricedFilter, PriceListQuery, PriceListResponse, PriceListRow } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  type DocTableRow,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  KpiCardComponent,
  PageHeaderComponent,
  PaginationComponent,
  ProductThumbComponent,
  RowActionComponent,
  type RowMenuItem,
  SelectComponent,
  type SelectOption,
  SkeletonComponent,
  StockFlagComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { formatBs } from '../cash/cash-format';
import { PriceEditDialog } from './price-edit.dialog';
import { brandLine, formatMargin, lastChangeText, parsePriced, PRICE_PAGE_SIZE, PRICED_OPTIONS, priceStatusPill } from './price-format';
import { PricesApi } from './prices-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

interface PriceFilters {
  q: string;
  brandId: string | null;
  categoryId: string | null;
  priced: PricedFilter | null;
  page: number;
}

/** The columns of the Figma table of VP-11, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code', width: '10rem' },
  { key: 'product', label: 'Producto', type: 'custom' },
  { key: 'lastChange', label: 'Última actualización', type: 'text', width: '17rem' },
  { key: 'stock', label: 'En sucursal', type: 'custom', align: 'end', width: '8rem' },
  { key: 'price', label: 'Precio de venta', type: 'number', width: '9rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '9rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

const ROW_MENU: RowMenuItem[] = [{ key: 'edit', label: 'Editar precio', icon: 'edit' }];

/**
 * VP-11 · Precios y descuentos (HU-VEN-26, decision #18). The sale price of every product, one per product and company, with the
 * stock of the branch and when it last changed; "Editar precio" opens VP-11b. Discount rules, approvals, export, import and the
 * bulk update of the Figma frame belong to other stories (or were retired) and are not drawn.
 */
@Component({
  selector: 'rs-price-list-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    KpiCardComponent,
    PageHeaderComponent,
    PaginationComponent,
    PriceEditDialog,
    ProductThumbComponent,
    RouterLink,
    RowActionComponent,
    SelectComponent,
    SkeletonComponent,
    StockFlagComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './price-list.page.html',
  styleUrl: './price-list.page.scss',
})
export class PriceListPage {
  private readonly api = inject(PricesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Ventas y POS', link: '/sales' }, { label: 'Precios y descuentos' }];
  protected readonly columns = COLUMNS;
  protected readonly rowMenu = ROW_MENU;
  protected readonly pricedOptions = PRICED_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly filters = computed<PriceFilters>(() => {
    const q = this.queryParams();
    return {
      q: q.get('q') ?? '',
      brandId: q.get('brandId'),
      categoryId: q.get('categoryId'),
      priced: parsePriced(q.get('priced')),
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });

  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<PriceListResponse | null>(null);
  protected readonly dialogOpen = signal(false);
  protected readonly editing = signal<string | null>(null);

  protected readonly items = computed<readonly PriceListRow[]>(() => this.data()?.items ?? []);
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PRICE_PAGE_SIZE)));
  protected readonly brandOptions = computed<SelectOption[]>(() => (this.data()?.brands ?? []).map((b) => ({ value: b.id, label: b.name })));
  protected readonly categoryOptions = computed<SelectOption[]>(() => (this.data()?.categories ?? []).map((c) => ({ value: c.id, label: c.name })));
  protected readonly stockLabel = computed(() => {
    const branch = this.data()?.branch;
    return branch ? `Stock en ${branch.name}` : 'Stock en sucursal';
  });

  protected readonly kpis = computed(() => {
    const k = this.data()?.kpis;
    return {
      withPrice: String(k?.withPrice ?? 0),
      withPriceNote: `de ${k?.products ?? 0} productos`,
      withoutPrice: String(k?.withoutPrice ?? 0),
      changes: String(k?.changesThisMonth ?? 0),
      // the margin card exists only when the API sent the figure (`inventory.costs.view`)
      showMargin: k !== undefined && 'averageMarginPercent' in k,
      margin: formatMargin(k?.averageMarginPercent),
    };
  });

  protected readonly rows = computed<DocTableRow[]>(() =>
    this.items().map((item) => ({
      id: item.productId,
      label: item.manufacturerCode,
      cells: {
        code: item.manufacturerCode,
        product: item.name,
        lastChange: lastChangeText(item.lastChange),
        stock: item.branchStock,
        price: item.hasPrice ? formatBs(item.salePrice) : '—',
        status: priceStatusPill(item),
        actions: null,
      },
    })),
  );

  protected readonly rangeText = computed(() => {
    const total = this.total();
    if (!total) return '';
    const from = (this.filters().page - 1) * PRICE_PAGE_SIZE + 1;
    const to = Math.min(total, from + this.items().length - 1);
    return `${from}–${to} de ${total} ${total === 1 ? 'producto' : 'productos'}`;
  });

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.q || f.brandId || f.categoryId || f.priced) || this.searchText().trim() !== '';
  });
  protected readonly showEmpty = computed(() => this.state() === 'ready' && this.total() === 0 && !this.hasFilters());
  protected readonly showNoResults = computed(() => this.state() === 'ready' && this.total() === 0 && this.hasFilters());

  private readonly params = computed<PriceListQuery>(() => {
    const f = this.filters();
    return {
      q: f.q || undefined,
      brandId: f.brandId ?? undefined,
      categoryId: f.categoryId ?? undefined,
      priced: f.priced ?? undefined,
      page: f.page,
      pageSize: PRICE_PAGE_SIZE,
    };
  });

  constructor() {
    // keep the search box in sync with the URL (back/forward, "clear")
    effect(() => this.searchText.set(this.filters().q));
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));

    toObservable(this.params)
      .pipe(
        tap(() => this.state.set('loading')),
        switchMap((params) => this.fetch(params)),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.show(result));
  }

  private fetch(params: PriceListQuery) {
    return this.api.list(params).pipe(
      map((data) => ({ data })),
      catchError((err: unknown) => of({ error: problemOf(err) })),
    );
  }

  private show(result: { data: PriceListResponse } | { error: ReturnType<typeof problemOf> }) {
    if ('error' in result) {
      this.errorMessage.set(result.error.message);
      this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    this.data.set(result.data);
    this.state.set('ready');
  }

  protected itemOf(id: string): PriceListRow | undefined {
    return this.items().find((item) => item.productId === id);
  }

  protected brandLine(item: PriceListRow): string {
    return brandLine(item);
  }

  protected onMenu(item: PriceListRow, key: string) {
    if (key === 'edit') this.edit(item);
  }

  protected edit(item: PriceListRow) {
    this.editing.set(item.productId);
    this.dialogOpen.set(true);
  }

  /** The list, the KPIs and "Última actualización" all change with a saved price: read them again, without the skeleton. */
  protected onSaved() {
    this.fetch(this.params())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => {
        if ('data' in result) this.data.set(result.data);
        // the price was saved: a stale list is worth a warning, not silence
        else this.toast.warning('El precio se guardó, pero no pudimos actualizar la lista. Recárgala.');
      });
  }

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null, page: null }), 300);
  }

  protected setFilter(key: 'brandId' | 'categoryId' | 'priced', value: unknown) {
    this.navigate({ [key]: value ? String(value) : null, page: null });
  }

  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.navigate({ q: null, brandId: null, categoryId: null, priced: null, page: null });
  }

  protected goToPage(page: number) {
    if (page !== this.filters().page) this.navigate({ page: page > 1 ? String(page) : null });
  }

  protected retry() {
    this.state.set('loading');
    this.fetch(this.params())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result) => this.show(result));
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
