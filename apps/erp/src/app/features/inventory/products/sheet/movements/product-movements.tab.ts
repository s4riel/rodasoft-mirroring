import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { ProductMovementsResponse } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  EmptyStateIllustratedComponent,
  KpiCardComponent,
  PaginationComponent,
  SkeletonComponent,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../../../core/api-error';
import { ProductsApi } from '../../products-api.service';
import { formatDate, formatQuantity, plural } from '../product-sheet.mapper';
import { ProductSheetStore } from '../product-sheet.store';
import { directionLabel, documentText, formatSigned } from './movement.mapper';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const PAGE_SIZE = 10;

const COLUMNS: DocTableColumn[] = [
  { key: 'date', label: 'Fecha', type: 'text' },
  { key: 'document', label: 'Documento', type: 'text' },
  { key: 'type', label: 'Tipo', type: 'text' },
  { key: 'quantity', label: 'Cant.', type: 'number' },
  { key: 'balance', label: 'Saldo', type: 'number' },
  { key: 'branch', label: 'Sucursal', type: 'text' },
];

/** IN-22 · "Movimientos" tab: the inflows and outflows of the product, newest first, with the balance after each one. */
@Component({
  selector: 'rs-product-movements-tab',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    KpiCardComponent,
    PaginationComponent,
    RouterLink,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-movements.tab.html',
  styleUrl: './product-movements.tab.scss',
})
export class ProductMovementsTab {
  private readonly api = inject(ProductsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly store = inject(ProductSheetStore);

  /** A quantity with the unit of the product of the sheet. */
  protected quantity(n: number): string {
    return formatQuantity(n, this.store.product()?.unit);
  }

  private readonly id = toSignal((this.route.parent ?? this.route).paramMap.pipe(map((p) => p.get('id') ?? '')), {
    requireSync: true,
  });
  protected readonly productId = this.id;
  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly reload = signal(0);

  protected readonly page = computed(() => Math.max(1, Number(this.queryParams().get('page')) || 1));
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<ProductMovementsResponse | null>(null);

  protected readonly columns = COLUMNS;
  protected readonly rows = computed<DocTableRow[]>(() =>
    (this.data()?.items ?? []).map((m) => ({
      id: m.id,
      cells: {
        date: formatDate(m.date),
        document: documentText(m),
        type: directionLabel(m),
        quantity: formatSigned(m.quantity),
        balance: m.balanceAfter,
        branch: m.branch.name,
      },
    })),
  );

  protected readonly isEmpty = computed(() => this.data()?.total === 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil((this.data()?.total ?? 0) / PAGE_SIZE)));
  protected readonly rangeLabel = computed(() => {
    const d = this.data();
    if (!d) return '';
    const from = (this.page() - 1) * PAGE_SIZE + 1;
    const to = from + d.items.length - 1;
    return `${from}–${to} de ${d.total} ${plural(d.total, 'movimiento', 'movimientos')}`;
  });

  constructor() {
    toObservable(computed(() => ({ id: this.id(), page: this.page(), reload: this.reload() })))
      .pipe(
        tap(() => this.state.set('loading')),
        switchMap(({ id, page }) =>
          this.api.movements(id, { page, pageSize: PAGE_SIZE }).pipe(
            map((data) => ({ data })),
            catchError((err) => of({ error: problemOf(err) })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if ('error' in result) {
          this.errorMessage.set(result.error.message);
          this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
          return;
        }
        this.data.set(result.data);
        this.state.set('ready');
      });
  }

  protected goToPage(page: number) {
    if (page === this.page()) return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { page: page > 1 ? page : null },
      queryParamsHandling: 'merge',
    });
  }

  protected retry() {
    this.reload.update((n) => n + 1);
  }
}
