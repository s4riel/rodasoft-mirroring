import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { dispatchableQuantity, ORDER_CANCEL_REASON_MAX, type SalesOrderDetail } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FieldComponent,
  KpiCardComponent,
  ModalComponent,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
  StatusTimelineComponent,
  TextareaDirective,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs, formatDateTime } from '../cash/cash-format';
import { isZero, ORDER_STATUS_PILLS } from '../quotes/quote-format';
import { DispatchOrderDialog } from './dispatch-order.dialog';
import { lineStatus, piecesLabel, toOrderTimelineSteps } from './order-format';
import { OrdersApi } from './orders-api.service';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'text', width: '10rem' },
  { key: 'name', label: 'Producto', type: 'text' },
  { key: 'quantity', label: 'Pedido', type: 'number', width: '6rem' },
  { key: 'reserved', label: 'Reservado', type: 'number', width: '6rem' },
  { key: 'dispatched', label: 'Despachado', type: 'number', width: '6rem' },
  { key: 'invoiced', label: 'Facturado', type: 'number', width: '6rem' },
  { key: 'state', label: 'Estado', type: 'status', width: '9rem' },
  { key: 'total', label: 'Importe', type: 'number', width: '8rem' },
];

const DISPATCH_COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'Despacho', type: 'text', width: '9rem' },
  { key: 'date', label: 'Fecha', type: 'text', width: '10rem' },
  { key: 'by', label: 'Por', type: 'text' },
  { key: 'pieces', label: 'Piezas', type: 'number', width: '6rem' },
  { key: 'sale', label: 'Venta facturada', type: 'text', width: '10rem' },
  { key: 'total', label: 'Importe', type: 'number', width: '8rem' },
];

/**
 * An order: its reserved lines, the quote it came from, its dispatches (HU-VEN-20, VP-19: dispatch and invoice in parts,
 * print the dispatch order) and cancelling it to release the stock.
 */
@Component({
  selector: 'rs-order-detail-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    DispatchOrderDialog,
    FieldComponent,
    KpiCardComponent,
    ModalComponent,
    NoteComponent,
    PageHeaderComponent,
    RouterLink,
    SkeletonComponent,
    StatusPillComponent,
    StatusTimelineComponent,
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
  protected readonly dispatchColumns = DISPATCH_COLUMNS;
  protected readonly reasonMax = ORDER_CANCEL_REASON_MAX;
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly detail = signal<SalesOrderDetail | null>(null);

  protected readonly cancelOpen = signal(false);
  protected readonly reason = signal('');
  protected readonly cancelling = signal(false);
  protected readonly reasonMissing = signal(false);
  protected readonly dispatchOpen = signal(false);

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
        invoiced: line.invoicedQuantity,
        state: lineStatus(line),
        total: formatBs(line.lineTotal),
      },
    })),
  );
  protected readonly dispatchRows = computed(() =>
    (this.detail()?.dispatches ?? []).map((dispatch) => ({
      id: dispatch.id,
      label: dispatch.number,
      cells: {
        number: dispatch.number,
        date: formatDateTime(dispatch.createdAt),
        by: dispatch.createdByName ?? '—',
        pieces: dispatch.pieces,
        sale: dispatch.saleNumber ?? '—',
        total: formatBs(dispatch.total),
      },
    })),
  );
  /** "Minera Demo Ltda. · desde COT-0045 · Huayna Kapac": who it is for, the quote it came from and where the stock is held. */
  protected readonly subtitle = computed(() => {
    const d = this.detail();
    if (!d) return '';
    return [d.customer.name, d.quote ? `desde ${d.quote.number}` : null, d.warehouseName].filter(Boolean).join(' · ');
  });
  protected readonly timeline = computed(() => toOrderTimelineSteps(this.detail()?.timeline ?? []));
  /** Pieces held for the order now, out of what was ordered ("19 de 22 piezas"). */
  protected readonly heldText = computed(() => {
    const lines = this.detail()?.lines ?? [];
    const held = lines.reduce((sum, line) => sum + dispatchableQuantity(line), 0);
    const ordered = lines.reduce((sum, line) => sum + line.quantity, 0);
    return `${held} de ${ordered} piezas`;
  });
  protected readonly dispatchedText = computed(() =>
    piecesLabel((this.detail()?.lines ?? []).reduce((sum, line) => sum + line.dispatchedQuantity, 0)),
  );
  protected readonly printPath = computed(() => `/sales/orders/${this.detail()?.id ?? ''}/print`);
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
        const problem = problemOf(err);
        this.errorMessage.set(problem.message);
        this.state.set(problem.status === 403 ? 'forbidden' : 'error');
      },
    });
  }

  protected onDispatched(updated: SalesOrderDetail) {
    this.detail.set(updated);
    this.toast.success(
      updated.status === 'DISPATCHED'
        ? `Pedido ${updated.number} despachado y facturado por completo.`
        : `Despacho registrado. Lo pendiente queda en el pedido ${updated.number}.`,
    );
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
