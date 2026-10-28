import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EQUIVALENCE_COMPARE_MAX, EQUIVALENCE_COMPARE_MIN, type ProductEquivalentItem, type ProductEquivalentsResponse } from '@rodasoft/domain';
import {
  ButtonComponent,
  IconButtonComponent,
  CanDirective,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  EmptyStateIllustratedComponent,
  FlagComponent,
  IconComponent,
  PaginationComponent,
  SkeletonComponent,
  StatusPillComponent,
  StockFlagComponent,
  ToastService,
  TooltipDirective,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../../../core/api-error';
import { EquivalencesApi } from '../../../equivalences/equivalences-api.service';
import { EquivalenceUnlinkDialog, type UnlinkTarget } from '../../../equivalences/link/equivalence-unlink.dialog';
import { flagOf } from '../../product-list.mapper';
import { ProductsApi } from '../../products-api.service';
import { formatMoney, plural } from '../product-sheet.mapper';
import { ProductKpisComponent } from '../product-kpis.component';
import { ProductSheetStore } from '../product-sheet.store';
import { equivalencePill, ORIGINAL_PILL } from './equivalence-pill';

type LoadState = 'loading' | 'ready' | 'error';

const PAGE_SIZE = 10;

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code' },
  { key: 'brand', label: 'Marca', type: 'text' },
  { key: 'industry', label: 'Industria', type: 'custom' },
  { key: 'stock', label: 'Stock', type: 'custom', align: 'end' },
  { key: 'price', label: 'Precio (Bs)', type: 'number' },
  { key: 'difference', label: 'Diferencia', type: 'status' },
  { key: 'actions', label: 'Acciones', type: 'custom', align: 'end' },
];

/** IN-02b · "Equivalentes" tab: the equivalents of other brands and how each one differs from the original. */
@Component({
  selector: 'rs-product-equivalents-tab',
  imports: [
    ButtonComponent,
    IconButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    EquivalenceUnlinkDialog,
    FlagComponent,
    IconComponent,
    PaginationComponent,
    ProductKpisComponent,
    SkeletonComponent,
    StatusPillComponent,
    StockFlagComponent,
    TooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-equivalents.tab.html',
  styleUrl: './product-equivalents.tab.scss',
})
export class ProductEquivalentsTab {
  private readonly api = inject(ProductsApi);
  private readonly equivalences = inject(EquivalencesApi);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly store = inject(ProductSheetStore);

  private readonly id = toSignal((this.route.parent ?? this.route).paramMap.pipe(map((p) => p.get('id') ?? '')), {
    requireSync: true,
  });
  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly reload = signal(0);

  protected readonly page = computed(() => Math.max(1, Number(this.queryParams().get('page')) || 1));
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<ProductEquivalentsResponse | null>(null);

  protected readonly columns = COLUMNS;
  protected readonly compareMax = EQUIVALENCE_COMPARE_MAX;
  protected readonly maxLabel = `Máximo ${EQUIVALENCE_COMPARE_MAX} productos`;
  protected readonly compareHint = `Elige entre ${EQUIVALENCE_COMPARE_MIN} y ${EQUIVALENCE_COMPARE_MAX} productos`;

  protected readonly unlinkOpen = signal(false);
  protected readonly unlinkTarget = signal<UnlinkTarget | null>(null);
  protected readonly approvingId = signal<string | null>(null);

  /** Products checked for the comparator (IN-13), in the order they were checked; they survive a page change. */
  protected readonly selectedIds = signal<readonly string[]>([]);
  protected readonly canCompare = computed(() => {
    const n = this.selectedIds().length;
    return n >= EQUIVALENCE_COMPARE_MIN && n <= EQUIVALENCE_COMPARE_MAX;
  });

  /** The original first (page 1 only), then the equivalents of the page. */
  private readonly items = computed<ProductEquivalentItem[]>(() => {
    const d = this.data();
    if (!d) return [];
    return this.page() === 1 ? [d.source, ...d.items] : d.items;
  });
  private readonly itemById = computed(() => new Map(this.items().map((i) => [i.productId, i])));

  protected readonly rows = computed<DocTableRow[]>(() => {
    const sourceId = this.data()?.source.productId;
    return this.items().map((i) => ({
      id: i.productId,
      label: i.manufacturerCode,
      cells: {
        code: i.manufacturerCode,
        brand: i.brand.name,
        price: formatMoney(i.salePrice).replace('Bs ', ''),
        difference: i.productId === sourceId ? ORIGINAL_PILL : equivalencePill(i),
      },
    }));
  });
  protected readonly totals = computed(() => {
    const t = this.data()?.totals;
    return t
      ? { code: 'Total', brand: `${t.codes} ${plural(t.codes, 'código', 'códigos')}`, industry: '', stock: t.stock, price: '–', difference: '–' }
      : null;
  });

  protected readonly isEmpty = computed(() => this.data()?.total === 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil((this.data()?.total ?? 0) / PAGE_SIZE)));
  /** Records of the table count the original, which is the first one on page 1. */
  protected readonly rangeLabel = computed(() => {
    const d = this.data();
    if (!d) return '';
    const total = d.total + 1;
    const from = this.page() === 1 ? 1 : (this.page() - 1) * PAGE_SIZE + 2;
    const to = from + this.items().length - 1;
    return `${from}–${to} de ${total} ${plural(total, 'registro', 'registros')}`;
  });

  constructor() {
    toObservable(computed(() => ({ id: this.id(), page: this.page(), reload: this.reload() })))
      .pipe(
        tap(() => this.state.set('loading')),
        switchMap(({ id, page }) =>
          this.api.equivalents(id, { page, pageSize: PAGE_SIZE }).pipe(
            map((data) => ({ data })),
            catchError((err) => of({ error: problemOf(err) })),
          ),
        ),
        takeUntilDestroyed(),
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

  /** Industry (country of origin) of a row: its name and, when there is one, its flag. */
  protected industryOf(id: string) {
    const country = this.itemById().get(id)?.country;
    return country ? { name: country.name, flag: flagOf(country.code) } : null;
  }

  protected stockOf(id: string): { quantity: number; out: boolean } | null {
    const item = this.itemById().get(id);
    return item ? { quantity: item.totalStock, out: item.totalStock <= 0 } : null;
  }

  /** IN-15c · Opens the link form with the product of the sheet as the origin. */
  protected link() {
    void this.router.navigate(['/inventory/equivalences/new'], { queryParams: { productId: this.id() } });
  }

  /** The row's link, or null for the original (it has none). */
  protected linkOf(productId: string): ProductEquivalentItem | null {
    const item = this.itemById().get(productId);
    return item?.equivalenceId ? item : null;
  }

  protected askUnlink(item: ProductEquivalentItem) {
    const source = this.data()?.source;
    if (!item.equivalenceId || !source) return;
    this.unlinkTarget.set({
      id: item.equivalenceId,
      pairLabel: `${source.manufacturerCode} · ${source.brand.name} y ${item.manufacturerCode} · ${item.brand.name}`,
    });
    this.unlinkOpen.set(true);
  }

  /** Decision #34 · Approves a pending link. */
  protected approve(item: ProductEquivalentItem) {
    if (!item.equivalenceId || this.approvingId()) return;
    this.approvingId.set(item.equivalenceId);
    this.equivalences.approve(item.equivalenceId).subscribe({
      next: () => {
        this.approvingId.set(null);
        this.toast.success('Equivalencia aprobada');
        this.refresh();
      },
      error: (err: unknown) => {
        this.approvingId.set(null);
        this.toast.danger(problemOf(err).message);
        this.refresh();
      },
    });
  }

  /** The sheet reloads as a whole: its card and KPIs count the equivalents too. */
  protected refresh() {
    this.store.retry();
  }

  protected goToPage(page: number) {
    if (page === this.page()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page > 1 ? page : null },
      queryParamsHandling: 'merge',
    });
  }

  /** Opens the comparator with the checked products; the original, when checked, is the reference (first). */
  protected compare() {
    if (!this.canCompare()) return;
    const sourceId = this.data()?.source.productId;
    const ids = [...this.selectedIds()].sort((a, b) => Number(b === sourceId) - Number(a === sourceId));
    void this.router.navigate(['/inventory/equivalences/compare'], { queryParams: { ids: ids.join(','), from: this.id() } });
  }

  protected retry() {
    this.reload.update((n) => n + 1);
  }
}
