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
  InputDirective,
  KpiCardComponent,
  PageHeaderComponent,
  SelectComponent,
  SkeletonComponent,
  StatusPillComponent,
  StatusTimelineComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs, formatDateTime } from '../cash/cash-format';
import { formatDay, isZero, QUOTE_STATUS_PILLS } from './quote-format';
import { QUOTE_CHANNEL_LABELS, isOutOfStock, quoteUnits, toTimelineSteps } from './quote-tracking-format';
import { QuoteSendDialog } from './quote-send.dialog';
import { QuotesApi } from './quotes-api.service';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'text', width: '10rem' },
  { key: 'name', label: 'Producto', type: 'text' },
  { key: 'quantity', label: 'Cantidad', type: 'number', width: '7rem' },
  { key: 'price', label: 'Precio', type: 'number', width: '8rem' },
  { key: 'total', label: 'Importe', type: 'number', width: '8rem' },
  { key: 'stock', label: 'Stock', type: 'status', width: '10rem' },
];

/** The quote with its status timeline (VP-17, VP-17b), sending (VP-08b), renewal and rejection, and VP-18 · converting it into an order that reserves the stock of a warehouse. */
@Component({
  selector: 'rs-quote-detail-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    InputDirective,
    KpiCardComponent,
    ModalComponent,
    NoteComponent,
    PageHeaderComponent,
    RouterLink,
    SelectComponent,
    QuoteSendDialog,
    SkeletonComponent,
    StatusPillComponent,
    StatusTimelineComponent,
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

  protected readonly sendOpen = signal(false);
  protected readonly renewOpen = signal(false);
  protected readonly renewDate = signal('');
  protected readonly renewing = signal(false);
  protected readonly renewError = signal('');
  protected readonly rejectOpen = signal(false);
  protected readonly rejecting = signal(false);
  protected readonly channelLabels = QUOTE_CHANNEL_LABELS;

  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Cotizaciones', link: '/sales/quotes' },
    { label: this.detail()?.number ?? 'Cotización' },
  ]);
  protected readonly pill = computed(() => (this.detail() ? QUOTE_STATUS_PILLS[this.detail()!.status] : null));
  protected readonly warehouseOptions = computed(() => (this.context()?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })));
  /** The four summary cards of VP-17: total, units, validity (or when it expired) and the stock of the lines. */
  protected readonly summary = computed(() => {
    const d = this.detail();
    if (!d) return null;
    const short = d.lines.filter((l) => isOutOfStock(l.available, l.quantity)).length;
    return {
      units: quoteUnits(d),
      products: d.lines.length,
      expired: d.status === 'EXPIRED',
      short,
    };
  });
  protected readonly timeline = computed(() => toTimelineSteps(this.detail()?.timeline ?? []));
  protected readonly rows = computed(() =>
    (this.detail()?.lines ?? []).map((line) => ({
      id: line.id,
      label: line.code,
      cells: {
        code: line.code,
        name: line.name,
        quantity: line.quantity,
        price: formatBs(line.unitPrice),
        total: formatBs(line.lineTotal),
        stock: isOutOfStock(line.available, line.quantity) ? { label: 'Sin existencia', status: 'danger' as const } : '',
      },
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
        const problem = problemOf(err);
        this.errorMessage.set(problem.message);
        this.state.set(problem.status === 403 ? 'forbidden' : 'error');
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

  protected openSend() {
    this.sendOpen.set(true);
  }

  protected onSent(detail: QuoteDetail) {
    this.detail.set(detail);
    this.toast.success(`Envío registrado en la cotización ${detail.number}`);
  }

  protected openRenew() {
    this.renewError.set('');
    this.renewDate.set(this.context()?.defaultValidUntil ?? '');
    this.renewOpen.set(true);
    if (this.context()) return;
    this.api.context().subscribe({
      next: (context) => {
        this.context.set(context);
        if (!this.renewDate()) this.renewDate.set(context.defaultValidUntil);
      },
      error: (err) => this.renewError.set(problemOf(err).message),
    });
  }

  protected renew() {
    const detail = this.detail();
    if (!detail || this.renewing()) return;
    this.renewing.set(true);
    this.renewError.set('');
    this.api.renew(detail.id, { validUntil: this.renewDate() || undefined }).subscribe({
      next: (renewed) => {
        this.renewing.set(false);
        this.renewOpen.set(false);
        this.detail.set(renewed);
        this.toast.success(`Cotización renovada hasta el ${formatDay(renewed.validUntil)} con los precios de hoy`);
      },
      error: (err) => {
        this.renewing.set(false);
        this.renewError.set(problemOf(err).message);
      },
    });
  }

  protected reject() {
    const detail = this.detail();
    if (!detail || this.rejecting()) return;
    this.rejecting.set(true);
    this.api.reject(detail.id).subscribe({
      next: (rejected) => {
        this.rejecting.set(false);
        this.rejectOpen.set(false);
        this.detail.set(rejected);
        this.toast.success(`Cotización ${rejected.number} marcada como rechazada`);
      },
      error: (err) => {
        this.rejecting.set(false);
        this.rejectOpen.set(false);
        this.toast.danger(problemOf(err).message);
      },
    });
  }
}
