import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { QuoteDetail, QuoteEditorContext, ReservationShortfall } from '@rodasoft/domain';
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
  SelectComponent,
  SkeletonComponent,
  StatusPillComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs, formatDateTime } from '../cash/cash-format';
import { formatDay, isZero, QUOTE_STATUS_PILLS } from './quote-format';
import { QuotesApi } from './quotes-api.service';

type LoadState = 'loading' | 'ready' | 'error';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'text', width: '10rem' },
  { key: 'name', label: 'Producto', type: 'text' },
  { key: 'quantity', label: 'Cantidad', type: 'number', width: '7rem' },
  { key: 'price', label: 'Precio', type: 'number', width: '8rem' },
  { key: 'total', label: 'Importe', type: 'number', width: '8rem' },
];

/** The quote read-only, and VP-18 · converting it into an order that reserves the stock of a warehouse. */
@Component({
  selector: 'rs-quote-detail-page',
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
    SelectComponent,
    SkeletonComponent,
    StatusPillComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-detail.page.html',
  styleUrl: './quote-detail.page.scss',
})
export class QuoteDetailPage {
  private readonly api = inject(QuotesApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly columns = COLUMNS;
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly detail = signal<QuoteDetail | null>(null);

  protected readonly convertOpen = signal(false);
  protected readonly context = signal<QuoteEditorContext | null>(null);
  protected readonly warehouseId = signal<string | null>(null);
  protected readonly converting = signal(false);
  protected readonly shortfalls = signal<ReservationShortfall[]>([]);
  protected readonly convertError = signal('');

  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Cotizaciones', link: '/sales/quotes' },
    { label: this.detail()?.number ?? 'Cotización' },
  ]);
  protected readonly pill = computed(() => (this.detail() ? QUOTE_STATUS_PILLS[this.detail()!.status] : null));
  protected readonly warehouseOptions = computed(() => (this.context()?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })));
  protected readonly rows = computed(() =>
    (this.detail()?.lines ?? []).map((line) => ({
      id: line.id,
      label: line.code,
      cells: { code: line.code, name: line.name, quantity: line.quantity, price: formatBs(line.unitPrice), total: formatBs(line.lineTotal) },
    })),
  );
  protected readonly hasDiscount = computed(() => !!this.detail() && !isZero(this.detail()!.discountAmount));
  protected readonly hasRounding = computed(() => !!this.detail() && !isZero(this.detail()!.roundingAmount));
  protected readonly formatBs = formatBs;
  protected readonly formatDay = formatDay;
  protected readonly formatDateTime = formatDateTime;

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.api.detail(id).subscribe({
      next: (detail) => {
        this.detail.set(detail);
        this.state.set('ready');
        if (this.route.snapshot.queryParamMap.has('convert') && detail.convertible) this.openConvert();
      },
      error: (err) => {
        this.errorMessage.set(problemOf(err).message);
        this.state.set('error');
      },
    });
  }

  protected openConvert() {
    this.convertError.set('');
    this.shortfalls.set([]);
    this.convertOpen.set(true);
    if (this.context()) return;
    this.api.context().subscribe({
      next: (context) => {
        this.context.set(context);
        this.warehouseId.set(context.warehouses[0]?.id ?? null);
      },
      error: (err) => this.convertError.set(problemOf(err).message),
    });
  }

  protected closeConvert() {
    this.convertOpen.set(false);
  }

  protected nameOf(productId: string): string {
    const line = this.detail()?.lines.find((l) => l.productId === productId);
    return line ? `${line.code} · ${line.name}` : productId;
  }

  protected convert() {
    const detail = this.detail();
    const warehouseId = this.warehouseId();
    if (!detail || !warehouseId || this.converting()) return;
    this.converting.set(true);
    this.convertError.set('');
    this.shortfalls.set([]);
    this.api.convert(detail.id, { warehouseId }).subscribe({
      next: (order) => {
        this.toast.success(`Pedido ${order.number} creado con el stock reservado`);
        void this.router.navigate(['/sales/orders', order.id]);
      },
      error: (err) => {
        this.converting.set(false);
        const problem = problemOf(err);
        if (problem.code === 'INSUFFICIENT_STOCK') {
          this.shortfalls.set((problem.details as { items?: ReservationShortfall[] } | undefined)?.items ?? []);
          this.convertError.set('No hay stock disponible suficiente en este almacén para reservar todo el pedido.');
        } else {
          this.convertError.set(problem.message);
        }
      },
    });
  }
}
