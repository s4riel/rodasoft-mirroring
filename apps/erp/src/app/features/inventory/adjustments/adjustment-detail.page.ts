import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { AdjustmentDetail } from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  EmptyStateIllustratedComponent,
  IconComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { formatMoney } from '../products/sheet/product-sheet.mapper';
import { formatDayTime } from '../transfers/transfers.mapper';
import { AdjustmentsApi } from './adjustments-api.service';
import { ADJUSTMENT_STATUS_PILLS, adjustmentErrorMessage, KIND_LABELS } from './adjustments.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'missing';

const BASE_COLUMNS: DocTableColumn[] = [
  { key: 'product', label: 'Producto', type: 'custom' },
  { key: 'kind', label: 'Tipo', type: 'text', width: '9rem' },
  { key: 'entered', label: 'Cantidad', type: 'number', width: '8rem' },
  { key: 'delta', label: 'Cambio en stock', type: 'number', width: '9rem' },
];
const VALUE_COLUMN: DocTableColumn = { key: 'value', label: 'Valor', type: 'number', width: '8rem' };

/** Read-only detail of an adjustment, opened from a row of IN-27. */
@Component({
  selector: 'rs-adjustment-detail-page',
  imports: [
    ButtonComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    IconComponent,
    PageHeaderComponent,
    SkeletonComponent,
    StatusPillComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './adjustment-detail.page.html',
  styleUrl: './adjustment-detail.page.scss',
})
export class AdjustmentDetailPage {
  private readonly api = inject(AdjustmentsApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly detail = signal<AdjustmentDetail | null>(null);
  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);

  protected readonly title = computed(() => this.detail()?.number ?? 'Ajuste');
  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Ajustes', link: '/inventory/adjustments' },
    { label: this.title() },
  ]);
  protected readonly pill = computed(() => {
    const d = this.detail();
    return d ? ADJUSTMENT_STATUS_PILLS[d.status] : null;
  });
  protected readonly createdAtLabel = computed(() => formatDayTime(this.detail()?.createdAt ?? null));
  protected readonly approvedLabel = computed(() => {
    const d = this.detail();
    if (!d?.approvedAt) return null;
    // a manual adjustment applies itself, so it has a date but nobody who approved it
    return `${formatDayTime(d.approvedAt)}${d.approvedBy ? ` · ${d.approvedBy}` : ' · Aplicado automáticamente'}`;
  });
  protected readonly valueLabel = computed(() => formatMoney(this.detail()?.value));
  protected readonly showValue = computed(() => this.detail()?.value != null);

  protected readonly columns = computed<DocTableColumn[]>(() => [...BASE_COLUMNS, ...(this.showValue() ? [VALUE_COLUMN] : [])]);
  protected readonly rows = computed<DocTableRow[]>(() =>
    (this.detail()?.items ?? []).map((i) => ({
      id: i.productId,
      label: i.manufacturerCode,
      cells: {
        product: i.manufacturerCode,
        kind: KIND_LABELS[i.kind],
        entered: i.enteredQuantity ?? '–',
        delta: i.delta > 0 ? `+${i.delta}` : String(i.delta),
        value: i.value === null ? '–' : formatMoney(i.value),
      },
    })),
  );

  constructor() {
    if (!this.ctx.can('inventory.adjustments.create') && !this.ctx.can('inventory.adjustments.approve')) {
      this.state.set('forbidden');
      return;
    }
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .get(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.state.set('ready');
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.errorMessage.set(adjustmentErrorMessage(problem));
          this.state.set(problem.status === 403 ? 'forbidden' : problem.status === 404 ? 'missing' : 'error');
        },
      });
  }

  protected nameOf(id: string): string {
    const item = this.detail()?.items.find((i) => i.productId === id);
    return item ? `${item.name} · ${item.brand}` : '';
  }

  protected back() {
    void this.router.navigate(['/inventory/adjustments']);
  }
}
