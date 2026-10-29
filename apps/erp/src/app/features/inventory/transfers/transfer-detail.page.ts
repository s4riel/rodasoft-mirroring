import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { TransferDetail } from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  EmptyStateIllustratedComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { formatMoney } from '../products/sheet/product-sheet.mapper';
import { TransfersApi } from './transfers-api.service';
import { formatDay, TRANSFER_STATUS_PILLS, transferErrorMessage } from './transfers.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code' },
  { key: 'product', label: 'Producto', type: 'text' },
  { key: 'quantity', label: 'Enviadas', type: 'number' },
  { key: 'received', label: 'Recibidas', type: 'number' },
];

/**
 * Read-only view of a transfer that is no longer a draft: its status, the lines and the totals frozen when it was sent.
 * Receiving (HU-INV-21) and approving (HU-INV-20) will extend it.
 */
@Component({
  selector: 'rs-transfer-detail-page',
  imports: [
    ButtonComponent,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    PageHeaderComponent,
    SkeletonComponent,
    StatusPillComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfer-detail.page.html',
  styleUrl: './transfer-detail.page.scss',
})
export class TransferDetailPage {
  private readonly api = inject(TransfersApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id') as string;

  protected readonly columns = COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly detail = signal<TransferDetail | null>(null);

  protected readonly canView = computed(() => this.ctx.can('inventory.transfers.create') || this.ctx.can('inventory.transfers.receive'));
  protected readonly pill = computed(() => {
    const d = this.detail();
    return d ? TRANSFER_STATUS_PILLS[d.status] : null;
  });
  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Transferencias', link: '/inventory/transfers' },
    { label: this.detail()?.number ?? 'Transferencia' },
  ]);
  protected readonly rows = computed<DocTableRow[]>(() =>
    (this.detail()?.lines ?? []).map((l) => ({
      id: l.productId,
      label: l.manufacturerCode,
      cells: { code: l.manufacturerCode, product: `${l.name} · ${l.brand}`, quantity: l.quantity, received: l.receivedQuantity },
    })),
  );
  protected readonly sentOn = computed(() => formatDay(this.detail()?.sentAt ?? null));
  protected readonly value = computed(() => formatMoney(this.detail()?.summary.value));

  constructor() {
    if (!this.canView()) {
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
          // a draft is edited, not read
          if (detail.status === 'DRAFT') {
            void this.router.navigate(['/inventory/transfers', this.id, 'edit'], { replaceUrl: true });
            return;
          }
          this.detail.set(detail);
          this.state.set('ready');
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.errorMessage.set(transferErrorMessage(problem));
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  protected back() {
    void this.router.navigate(['/inventory/transfers']);
  }
}
