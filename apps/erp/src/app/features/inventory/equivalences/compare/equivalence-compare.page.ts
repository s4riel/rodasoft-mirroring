import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  EQUIVALENCE_COMPARE_MAX,
  EQUIVALENCE_COMPARE_MIN,
  type EquivalenceComparisonColumn,
  type EquivalenceComparisonGroup,
  type EquivalenceComparisonResponse,
  type EquivalenceComparisonRow,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  EmptyStateIllustratedComponent,
  FlagComponent,
  IconButtonComponent,
  IconComponent,
  NoteComponent,
  PageHeaderComponent,
  ProductThumbComponent,
  SkeletonComponent,
  StatusPillComponent,
  StockFlagComponent,
  SwitchComponent,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../../core/api-error';
import { ContextStore } from '../../../../core/context.store';
import { flagOf, thumbIconOf } from '../../products/product-list.mapper';
import { formatMoney } from '../../products/sheet/product-sheet.mapper';
import { EquivalencesApi } from '../equivalences-api.service';
import { cellText, columnPill, GROUP_TITLES, parseIds, rowTitle } from './equivalence-compare.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'invalid' | 'forbidden';

interface RowGroup {
  group: EquivalenceComparisonGroup;
  title: string;
  rows: EquivalenceComparisonRow[];
}

/** IN-13 · Equivalents side by side: one column per product, one row per attribute, what differs highlighted. */
@Component({
  selector: 'rs-equivalence-compare-page',
  imports: [
    ButtonComponent,
    EmptyStateIllustratedComponent,
    FlagComponent,
    IconButtonComponent,
    IconComponent,
    NoteComponent,
    PageHeaderComponent,
    ProductThumbComponent,
    SkeletonComponent,
    StatusPillComponent,
    StockFlagComponent,
    SwitchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './equivalence-compare.page.html',
  styleUrl: './equivalence-compare.page.scss',
})
export class EquivalenceComparePage {
  private readonly api = inject(EquivalencesApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly minProducts = EQUIVALENCE_COMPARE_MIN;
  protected readonly maxProducts = EQUIVALENCE_COMPARE_MAX;
  protected readonly skeletonRows = [0, 1, 2, 3];
  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Equivalencias', link: '/inventory/equivalences' },
    { label: 'Comparar' },
  ];

  protected readonly canView = computed(() => this.ctx.can('inventory.products.view'));

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly ids = computed(() => parseIds(this.queryParams().get('ids')));
  /** Product sheet the user came from, when there is one. */
  private readonly from = computed(() => this.queryParams().get('from'));
  protected readonly backLink = computed(() => {
    const from = this.from();
    return from ? ['/inventory/products', from, 'equivalents'] : ['/inventory/equivalences'];
  });

  private readonly reload = signal(0);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<EquivalenceComparisonResponse | null>(null);
  protected readonly onlyDifferences = signal(false);

  protected readonly columns = computed(() => this.data()?.columns ?? []);
  protected readonly pills = computed(() => this.columns().map((c, i) => columnPill(c, i)));
  /** At least two columns must remain, so the last pair cannot be reduced. */
  protected readonly canRemove = computed(() => this.columns().length > EQUIVALENCE_COMPARE_MIN);

  protected readonly groups = computed<RowGroup[]>(() => {
    const rows = (this.data()?.rows ?? []).filter((r) => !this.onlyDifferences() || r.differs);
    return (['MEASURES', 'SPECS'] as const)
      .map((group) => ({ group, title: GROUP_TITLES[group], rows: rows.filter((r) => r.group === group) }))
      .filter((g) => g.rows.length > 0);
  });
  protected readonly differenceCount = computed(() => (this.data()?.rows ?? []).filter((r) => r.differs).length);

  constructor() {
    toObservable(computed(() => ({ ids: this.ids(), reload: this.reload() })))
      .pipe(
        tap(({ ids }) => this.state.set(!this.canView() ? 'forbidden' : this.validCount(ids) ? 'loading' : 'invalid')),
        switchMap(({ ids }) =>
          this.canView() && this.validCount(ids)
            ? this.api.compare(ids).pipe(
                map((data) => ({ data })),
                catchError((err) => of({ error: problemOf(err) })),
              )
            : of(null),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (!result) return;
        if ('error' in result) {
          this.errorMessage.set(result.error.message);
          this.state.set(result.error.status === 403 ? 'forbidden' : result.error.code === 'COMPARE_INVALID_SELECTION' ? 'invalid' : 'error');
          return;
        }
        this.data.set(result.data);
        this.state.set('ready');
      });
  }

  private validCount(ids: readonly string[]): boolean {
    return ids.length >= EQUIVALENCE_COMPARE_MIN && ids.length <= EQUIVALENCE_COMPARE_MAX;
  }

  protected title(row: EquivalenceComparisonRow): string {
    return rowTitle(row);
  }

  protected text(row: EquivalenceComparisonRow, value: string | null): string {
    return cellText(row, value);
  }

  protected flagOf(column: EquivalenceComparisonColumn) {
    return flagOf(column.country?.code);
  }

  protected thumbIcon(column: EquivalenceComparisonColumn) {
    return thumbIconOf(column.categoryIcon);
  }

  protected price(column: EquivalenceComparisonColumn): string {
    return formatMoney(column.salePrice);
  }

  protected openProduct(column: EquivalenceComparisonColumn) {
    void this.router.navigate(['/inventory/products', column.productId]);
  }

  /** Drops a column from the comparison by editing the URL, which reloads it. */
  protected remove(column: EquivalenceComparisonColumn) {
    if (!this.canRemove()) return;
    const ids = this.ids().filter((id) => id !== column.productId);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { ids: ids.join(',') }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected goBack() {
    void this.router.navigate(this.backLink());
  }

  protected retry() {
    this.reload.update((n) => n + 1);
  }
}
