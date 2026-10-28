import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { ProductWarehouseStockResponse } from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  EmptyStateIllustratedComponent,
  SkeletonComponent,
  StockFlagComponent,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../../../core/api-error';
import { ProductsApi } from '../../products-api.service';
import { formatQuantity } from '../product-sheet.mapper';
import { ProductSheetStore } from '../product-sheet.store';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const COLUMNS: DocTableColumn[] = [
  { key: 'branch', label: 'Sucursal', type: 'text' },
  { key: 'warehouse', label: 'Almacén', type: 'text' },
  { key: 'location', label: 'Ubicación', type: 'code' },
  { key: 'stock', label: 'Stock', type: 'custom', align: 'end' },
  { key: 'min', label: 'Mín.', type: 'number' },
  { key: 'max', label: 'Máx.', type: 'number' },
];

/** IN-23 · "Stock por almacén" tab: the stock of the product in each warehouse, with its thresholds. */
@Component({
  selector: 'rs-product-stock-tab',
  imports: [
    ButtonComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    SkeletonComponent,
    StockFlagComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-stock.tab.html',
  styleUrl: './product-stock.tab.scss',
})
export class ProductStockTab {
  private readonly api = inject(ProductsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly sheet = inject(ProductSheetStore);

  private readonly id = toSignal((this.route.parent ?? this.route).paramMap.pipe(map((p) => p.get('id') ?? '')), {
    requireSync: true,
  });
  private readonly reload = signal(0);

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<ProductWarehouseStockResponse | null>(null);

  protected readonly columns = COLUMNS;
  /** Warehouse id → item, so each custom cell reads its flag and quantity in constant time. */
  private readonly itemById = computed(() => new Map((this.data()?.items ?? []).map((i) => [i.warehouse.id, i])));

  protected readonly rows = computed<DocTableRow[]>(() =>
    (this.data()?.items ?? []).map((i) => ({
      id: i.warehouse.id,
      cells: {
        branch: i.branch.name,
        warehouse: i.warehouse.name,
        location: i.location ?? '–',
        stock: i.quantity,
        min: i.minStock,
        max: i.maxStock,
      },
    })),
  );
  protected readonly isEmpty = computed(() => this.data()?.items.length === 0);

  constructor() {
    toObservable(computed(() => ({ id: this.id(), reload: this.reload() })))
      .pipe(
        tap(() => this.state.set('loading')),
        switchMap(({ id }) =>
          this.api.stockByWarehouse(id).pipe(
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

  /** The flag of a row: "Agotado" at zero, "Stock bajo" at or under the minimum. */
  protected flagOf(id: string): { level: 'out' | 'low'; label: string } | null {
    const item = this.itemById().get(id);
    if (!item || item.availability === 'available') return null;
    return item.availability === 'out' ? { level: 'out', label: 'Agotado' } : { level: 'low', label: 'Stock bajo' };
  }

  protected quantityOf(id: string): number {
    return this.itemById().get(id)?.quantity ?? 0;
  }

  protected totalLabel(total: number): string {
    return `Total ${formatQuantity(total, this.sheet.product()?.unit)} · el stock se mueve entre sucursales solo con transferencias.`;
  }

  protected retry() {
    this.reload.update((n) => n + 1);
  }
}
