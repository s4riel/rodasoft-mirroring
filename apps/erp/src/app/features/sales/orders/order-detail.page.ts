import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ORDER_CANCEL_REASON_MAX, type SalesOrderDetail } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FieldComponent,
  ModalComponent,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
  TextareaDirective,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs, formatDateTime } from '../cash/cash-format';
import { isZero, ORDER_STATUS_PILLS } from '../quotes/quote-format';
import { OrdersApi } from './orders-api.service';

type LoadState = 'loading' | 'ready' | 'error';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'text', width: '10rem' },
  { key: 'name', label: 'Producto', type: 'text' },
  { key: 'quantity', label: 'Cantidad', type: 'number', width: '7rem' },
  { key: 'reserved', label: 'Reservado', type: 'number', width: '7rem' },
  { key: 'dispatched', label: 'Despachado', type: 'number', width: '7rem' },
  { key: 'price', label: 'Precio', type: 'number', width: '8rem' },
  { key: 'total', label: 'Importe', type: 'number', width: '8rem' },
];

/** An order: its reserved lines, the quote it came from, and cancelling it to release the stock. */
@Component({
  selector: 'rs-order-detail-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    ModalComponent,
    NoteComponent,
    PageHeaderComponent,
    RouterLink,
    SkeletonComponent,
    StatusPillComponent,
    TextareaDirective,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-detail.page.html',
  styleUrl: './order-detail.page.scss',
})
export class OrderDetailPage {
  private readonly api = inject(OrdersApi);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);

  protected readonly columns = COLUMNS;
  protected readonly reasonMax = ORDER_CANCEL_REASON_MAX;
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly detail = signal<SalesOrderDetail | null>(null);

  protected readonly cancelOpen = signal(false);
  protected readonly reason = signal('');
  protected readonly cancelling = signal(false);
  protected readonly reasonMissing = signal(false);

  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Pedidos', link: '/sales/orders' },
    { label: this.detail()?.number ?? 'Pedido' },
  ]);
  protected readonly pill = computed(() => (this.detail() ? ORDER_STATUS_PILLS[this.detail()!.status] : null));
  protected readonly rows = computed(() =>
    (this.detail()?.lines ?? []).map((line) => ({
      id: line.id,
      label: line.code,
      cells: {
        code: line.code,
        name: line.name,
        quantity: line.quantity,
        reserved: line.reservedQuantity,
        dispatched: line.dispatchedQuantity,
        price: formatBs(line.unitPrice),
        total: formatBs(line.lineTotal),
      },
    })),
  );
  protected readonly hasDiscount = computed(() => !!this.detail() && !isZero(this.detail()!.discountAmount));
  protected readonly hasRounding = computed(() => !!this.detail() && !isZero(this.detail()!.roundingAmount));
  protected readonly formatBs = formatBs;
  protected readonly formatDateTime = formatDateTime;

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api.detail(this.route.snapshot.paramMap.get('id') ?? '').subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.state.set('ready');
      },
      error: (err) => {
        this.errorMessage.set(problemOf(err).message);
        this.state.set('error');
      },
    });
  }

  protected openCancel() {
    this.reason.set('');
    this.reasonMissing.set(false);
    this.cancelOpen.set(true);
  }

  protected cancel() {
    const detail = this.detail();
    const reason = this.reason().trim();
    if (!detail || this.cancelling()) return;
    if (!reason) {
      this.reasonMissing.set(true);
      return;
    }
    this.cancelling.set(true);
    this.api.cancel(detail.id, { reason }).subscribe({
      next: (updated) => {
        this.detail.set(updated);
        this.cancelling.set(false);
        this.cancelOpen.set(false);
        this.toast.success(`Pedido ${updated.number} anulado. El stock volvió a estar disponible.`);
      },
      error: (err) => {
        this.cancelling.set(false);
        this.toast.danger(problemOf(err).message);
      },
    });
  }
}
