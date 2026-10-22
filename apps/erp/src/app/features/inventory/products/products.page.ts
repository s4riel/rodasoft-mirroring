import { toObservable, takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type {
  DuplicateProductResponse,
  ProductFilterOptions,
  ProductListItem,
  ProductListQuery,
  ProductListResponse,
  ProductStatusFilter,
} from '@rodasoft/domain';
import {
  ALL_BRANCHES,
  ButtonComponent,
  CanDirective,
  ChipMediaComponent,
  ChipMediaType,
  EmptyStateIllustratedComponent,
  FlagCountry,
  IconName,
  FilterBarProductsComponent,
  FilterChipComponent,
  IconComponent,
  ModalComponent,
  PageHeaderComponent,
  PaginationComponent,
  ProductTableComponent,
  ProductTableLabels,
  RowMenuItem,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { branchStockSubtotal, flagOf, PRODUCTS_PAGE_SIZE, thumbIconOf, toTableRow } from './product-list.mapper';
import { DuplicateProductDialog } from './duplicate-product.dialog';
import { ProductsApi } from './products-api.service';

type FilterKey = 'countryId' | 'categoryId' | 'subcategoryId' | 'brandId' | 'status';
type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

interface Filters {
  search: string;
  countryId: string | null;
  categoryId: string | null;
  subcategoryId: string | null;
  brandId: string | null;
  status: ProductStatusFilter | null;
  page: number;
}

interface FilterChip {
  key: FilterKey;
  label: string;
  mediaType: ChipMediaType;
  country: FlagCountry | null;
  text: string;
  /** Brand logo for a brand chip; without it the chip shows `text`. */
  logoUrl: string | null;
  icon: IconName;
}

const STATUS_LABELS: Record<ProductStatusFilter, string> = { ACTIVE: 'Activo', INACTIVE: 'Inactivo' };

/** IN-01a…e · Product list: filters, applied-filter chips, paginated table, row menu and empty states. */
@Component({
  selector: 'rs-products-page',
  imports: [
    ButtonComponent,
    CanDirective,
    ChipMediaComponent,
    DuplicateProductDialog,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    FilterChipComponent,
    IconComponent,
    ModalComponent,
    PageHeaderComponent,
    PaginationComponent,
    ProductTableComponent,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './products.page.html',
  styleUrl: './products.page.scss',
})
export class ProductsPage {
  private readonly api = inject(ProductsApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Inventario', link: '/inventory' }, { label: 'Productos' }];
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  protected readonly labels: ProductTableLabels = {
    photo: 'Foto',
    code: 'Código',
    product: 'Producto',
    description: 'Descripción',
    totalStock: 'Stock total',
    branchStock: 'En sucursal',
    price: 'Precio (Bs)',
    status: 'Estado',
    rowActions: 'Acciones de',
    availability: { available: 'Disponible', low: 'Stock bajo', out: 'Agotado', inactive: 'Inactivo' },
  };

  protected readonly statusOptions: SelectOption[] = [
    { value: 'ACTIVE', label: STATUS_LABELS.ACTIVE },
    { value: 'INACTIVE', label: STATUS_LABELS.INACTIVE },
  ];

  protected readonly canView = computed(() => this.ctx.can('inventory.products.view'));

  /** Row menu items by permission (Figma RowMenu). View, edit and adjust arrive with HU-INV-03, 07 and 16. */
  protected readonly menuItems = computed<RowMenuItem[]>(() => {
    const items: RowMenuItem[] = [{ key: 'view', label: 'Ver detalles', icon: 'eye' }];
    if (this.ctx.can('inventory.products.edit')) {
      items.push({ key: 'edit', label: 'Editar', icon: 'edit' }, { key: 'duplicate', label: 'Duplicar', icon: 'copy' });
    }
    if (this.ctx.can('inventory.adjustments.create')) items.push({ key: 'adjust', label: 'Ajustar stock', icon: 'inventory' });
    if (this.ctx.can('inventory.products.delete')) {
      items.push({ key: 'delete', label: 'Eliminar', icon: 'trash', danger: true, separated: true });
    }
    return items;
  });

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly filters = computed<Filters>(() => {
    const q = this.queryParams();
    const status = q.get('status');
    return {
      search: q.get('search') ?? '',
      countryId: q.get('countryId'),
      categoryId: q.get('categoryId'),
      subcategoryId: q.get('subcategoryId'),
      brandId: q.get('brandId'),
      status: status === 'ACTIVE' || status === 'INACTIVE' ? status : null,
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });

  protected readonly duplicateOpen = signal(false);
  protected readonly duplicateTarget = signal<ProductListItem | null>(null);
  protected readonly deleteOpen = signal(false);
  protected readonly deleteTarget = signal<ProductListItem | null>(null);
  protected readonly deleting = signal(false);

  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<ProductListResponse | null>(null);
  protected readonly options = signal<ProductFilterOptions>({ countries: [], brands: [], categories: [] });

  private readonly params = computed<ProductListQuery>(() => {
    const f = this.filters();
    const branch = this.ctx.branchId();
    return {
      search: f.search || undefined,
      countryId: f.countryId ?? undefined,
      categoryId: f.categoryId ?? undefined,
      subcategoryId: f.subcategoryId ?? undefined,
      brandId: f.brandId ?? undefined,
      status: f.status ?? undefined,
      branchId: branch === ALL_BRANCHES ? undefined : branch,
      page: f.page,
      pageSize: PRODUCTS_PAGE_SIZE,
    };
  });

  protected readonly items = computed<readonly ProductListItem[]>(() => this.data()?.items ?? []);
  protected readonly rows = computed(() => this.items().map(toTableRow));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PRODUCTS_PAGE_SIZE)));
  protected readonly subtotal = computed(() => branchStockSubtotal(this.items()));
  protected readonly showCatalogEmpty = computed(() => this.state() === 'ready' && !!this.data()?.catalogEmpty);
  protected readonly showNoResults = computed(
    () => this.state() === 'ready' && !this.data()?.catalogEmpty && this.total() === 0,
  );

  protected readonly hasFilters = computed(() => this.chips().length > 0 || this.searchText().trim() !== '');

  protected readonly rangeLabel = computed(() => {
    const total = this.total();
    if (!total) return '';
    const from = (this.filters().page - 1) * PRODUCTS_PAGE_SIZE + 1;
    const to = Math.min(total, from + this.items().length - 1);
    const fmt = (n: number) => n.toLocaleString('es-BO');
    return `${fmt(from)}–${fmt(to)} de ${fmt(total)} registros`;
  });

  /** Figma IN-01a vs IN-01d: a single page shows the "Total" of the list, several pages a per-page "Subtotal". */
  protected readonly footerLabel = computed(() => {
    if (!this.rows().length) return '';
    return this.pageCount() > 1 ? 'Subtotal' : 'Total';
  });

  protected readonly footerNote = computed(() => {
    if (this.pageCount() > 1) return `Página ${this.filters().page} de ${this.pageCount()}`;
    const total = this.total();
    return `${total.toLocaleString('es-BO')} ${total === 1 ? 'producto' : 'productos'}`;
  });

  protected readonly countryOptions = computed<SelectOption[]>(() =>
    this.options().countries.map((c) => ({ value: c.id, label: c.name })),
  );
  protected readonly categoryOptions = computed<SelectOption[]>(() =>
    this.options().categories.map((c) => ({ value: c.id, label: c.name })),
  );
  protected readonly subcategoryOptions = computed<SelectOption[]>(() => {
    const categoryId = this.filters().categoryId;
    const categories = this.options().categories;
    const pool = categoryId ? categories.filter((c) => c.id === categoryId) : categories;
    return pool.flatMap((c) => c.subcategories).map((s) => ({ value: s.id, label: s.name }));
  });
  protected readonly brandOptions = computed<SelectOption[]>(() =>
    this.options().brands.map((b) => ({ value: b.id, label: b.name })),
  );

  /** Applied filters as removable chips (Figma IN-01e). */
  protected readonly chips = computed<FilterChip[]>(() => {
    const f = this.filters();
    const o = this.options();
    const chips: FilterChip[] = [];
    const base = { country: null, text: '', logoUrl: null, icon: 'check' } as const;
    const country = o.countries.find((c) => c.id === f.countryId);
    if (country) {
      const flag = flagOf(country.code);
      // a country without a flag falls back to its code
      chips.push({ ...base, key: 'countryId', label: country.name, mediaType: flag ? 'flag' : 'brand', country: flag, text: country.code });
    }
    const brand = o.brands.find((b) => b.id === f.brandId);
    if (brand) chips.push({ ...base, key: 'brandId', label: brand.name, mediaType: 'brand', text: brand.name.slice(0, 3).toUpperCase(), logoUrl: brand.logoUrl });
    const category = o.categories.find((c) => c.id === f.categoryId);
    if (category) chips.push({ ...base, key: 'categoryId', label: category.name, mediaType: 'icon', icon: thumbIconOf(category.icon) });
    const sub = o.categories.flatMap((c) => c.subcategories).find((s) => s.id === f.subcategoryId);
    if (sub) chips.push({ ...base, key: 'subcategoryId', label: sub.name, mediaType: 'icon', icon: 'subcategory' });
    if (f.status) chips.push({ ...base, key: 'status', label: STATUS_LABELS[f.status], mediaType: 'icon', icon: 'check' });
    return chips;
  });

  constructor() {
    // keep the search box in sync with the URL (back/forward, "clear")
    effect(() => this.searchText.set(this.filters().search));
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));

    toObservable(this.params)
      .pipe(
        tap(() => {
          if (this.canView()) this.state.set('loading');
          else this.state.set('forbidden');
        }),
        switchMap((params) => {
          if (!this.canView()) return of(null);
          return this.api.list(params).pipe(
            map((data) => ({ data })),
            catchError((err) => of({ error: problemOf(err) })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (!result) return;
        if ('error' in result) {
          this.errorMessage.set(result.error.message);
          this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
          return;
        }
        this.data.set(result.data);
        this.state.set('ready');
      });

    if (this.canView()) {
      this.api
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

  protected setFilter(key: FilterKey, value: unknown) {
    const next: Record<string, string | null> = { [key]: value ? String(value) : null, page: null };
    // a subcategory belongs to one category: changing the category resets it
    if (key === 'categoryId') next['subcategoryId'] = null;
    this.navigate(next);
  }

  protected removeChip(key: FilterKey) {
    this.setFilter(key, null);
  }

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ search: text.trim() || null, page: null }), 300);
  }

  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.navigate({ search: null, countryId: null, categoryId: null, subcategoryId: null, brandId: null, status: null, page: null });
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
      .subscribe((result) => {
        if ('error' in result) {
          this.errorMessage.set(result.error.message);
          this.state.set('error');
          return;
        }
        this.data.set(result.data);
        this.state.set('ready');
      });
  }

  /** IN-01c · Row menu: duplicate and delete are built here; the other actions arrive with their own stories. */
  protected onRowAction(event: { id: string; key: string }) {
    const product = this.items().find((p) => p.id === event.id);
    if (!product) return;
    switch (event.key) {
      case 'duplicate':
        this.duplicateTarget.set(product);
        this.duplicateOpen.set(true);
        return;
      case 'delete':
        this.deleteTarget.set(product);
        this.deleteOpen.set(true);
        return;
      default:
        this.comingSoon();
    }
  }

  protected onDuplicated(result: DuplicateProductResponse) {
    this.toast.success(`Copia creada: ${result.sku}`);
    this.retry();
  }

  protected cancelDelete() {
    if (!this.deleting()) this.deleteOpen.set(false);
  }

  protected confirmDelete() {
    const product = this.deleteTarget();
    if (!product || this.deleting()) return;
    this.deleting.set(true);
    this.api.remove(product.id).subscribe({
      next: () => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.toast.success(`Producto eliminado: ${product.manufacturerCode}`);
        this.retry();
      },
      error: (err: unknown) => {
        this.deleting.set(false);
        this.deleteOpen.set(false);
        this.toast.danger(problemOf(err).message);
      },
    });
  }

  /** Actions of the header and the row menu arrive with their own stories. */
  protected comingSoon() {
    this.toast.info('Esta acción estará disponible próximamente.');
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
