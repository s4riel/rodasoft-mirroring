import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { TransferDetail } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  EmptyStateIllustratedComponent,
  FieldComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  KpiCardComponent,
  ModalComponent,
  NoteComponent,
  NumericInputDirective,
  PageHeaderComponent,
  PaginationComponent,
  SkeletonComponent,
  StatusPillComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { formatMoney } from '../products/sheet/product-sheet.mapper';
import { TransferDifferencesDialog } from './transfer-differences.dialog';
import { trackerOf, TrackerStep } from './transfer-detail.view';
import {
  errorOf,
  filterLines,
  fromDetail,
  pageCountOf,
  pageOf,
  pendingOf,
  RECEIPT_ERROR_LABELS,
  RECEIPT_PAGE_SIZE,
  type ReceiptLineState,
  receiveAll,
  receiveLine,
  setCounted,
  summarize,
  toSessionLines,
  toSurplusLines,
} from './transfer-receipt';
import { TransfersApi } from './transfers-api.service';
import { formatDay, formatDayTime, TRANSFER_STATUS_PILLS, transferErrorMessage } from './transfers.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type Busy = 'session' | 'close' | 'cancel';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code', width: '10rem' },
  { key: 'product', label: 'Producto', type: 'text' },
  { key: 'quantity', label: 'Enviado', type: 'number' },
  { key: 'received', label: 'Recibido', type: 'number' },
  { key: 'pending', label: 'Pendiente', type: 'number' },
];
/** While receiving, "Recibido" holds the input where the user counts what arrived (IN-24b). */
const RECEIVING_COLUMNS: DocTableColumn[] = COLUMNS.map((c) => (c.key === 'received' ? { ...c, type: 'custom', align: 'end', width: '18rem' } : c));
const SURPLUS_COLUMN: DocTableColumn = { key: 'surplus', label: 'Sobrante', type: 'number' };

/**
 * IN-24a / IN-24b · Transfer detail: its status and the Enviada → En tránsito → Recibida tracker, who sent it and when, the
 * route, the totals frozen when it was sent, and the lines with what was sent, received and is still pending. "Recibir
 * Productos" turns the same table into the receipt: the "Recibido" column takes the pieces counted, and the bottom bar offers
 * "Recibir todo", "Registrar recepción" (a partial session) and "Finalizar recepción" (IN-07, the differences). Once the
 * receipt is closed the banner points at the adjustment its differences left (HU-INV-21).
 */
@Component({
  selector: 'rs-transfer-detail-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    KpiCardComponent,
    ModalComponent,
    NoteComponent,
    NumericInputDirective,
    PageHeaderComponent,
    PaginationComponent,
    SkeletonComponent,
    StatusPillComponent,
    ToastOutletComponent,
    TransferDifferencesDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfer-detail.page.html',
  styleUrl: './transfer-detail.page.scss',
})
export class TransferDetailPage {
  private readonly api = inject(TransfersApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly id = this.route.snapshot.paramMap.get('id') as string;

  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly detail = signal<TransferDetail | null>(null);
  protected readonly search = signal('');
  protected readonly requestedPage = signal(1);

  /** Receiving mode: the table takes the count of each line. */
  protected readonly receiving = signal(false);
  protected readonly lines = signal<ReceiptLineState[]>([]);
  protected readonly busy = signal<Busy | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly differencesOpen = signal(false);
  protected readonly cancelOpen = signal(false);

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

  /** The lines the table shows: the ones being counted while receiving, the sent ones otherwise. */
  private readonly viewLines = computed<ReceiptLineState[]>(() => {
    const d = this.detail();
    if (!d) return [];
    return this.receiving() ? this.lines() : fromDetail(d);
  });
  private readonly detailLines = computed(() => new Map((this.detail()?.lines ?? []).map((l) => [l.productId, l])));

  protected readonly columns = computed(() => {
    if (this.receiving()) return RECEIVING_COLUMNS;
    return (this.detail()?.lines ?? []).some((l) => l.surplusQuantity > 0) ? [...COLUMNS, SURPLUS_COLUMN] : COLUMNS;
  });
  protected readonly filtered = computed(() => filterLines(this.viewLines(), this.search()));
  protected readonly pageCount = computed(() => pageCountOf(this.filtered().length));
  protected readonly page = computed(() => Math.min(this.requestedPage(), this.pageCount()));
  protected readonly rows = computed<DocTableRow[]>(() =>
    pageOf(this.filtered(), this.page()).map((l) => {
      const line = this.detailLines().get(l.productId);
      return {
        id: l.productId,
        label: l.code,
        cells: {
          code: l.code,
          product: `${l.name} · ${l.brand}`,
          quantity: l.sent,
          received: l.received > 0 ? l.received : '—',
          pending: this.receiving() ? pendingOf(l) : (line?.pendingQuantity ?? 0),
          surplus: line?.surplusQuantity ?? 0,
        },
      };
    }),
  );
  protected readonly range = computed(() => {
    const total = this.filtered().length;
    if (!total) return '';
    const from = (this.page() - 1) * RECEIPT_PAGE_SIZE + 1;
    return `${from}–${Math.min(total, from + this.rows().length - 1)} de ${total} ${total === 1 ? 'producto' : 'productos'}`;
  });
  protected readonly noMatches = computed(() => this.viewLines().length > 0 && this.filtered().length === 0);

  protected readonly sentOn = computed(() => formatDayTime(this.detail()?.sentAt ?? null));
  protected readonly tracker = computed<TrackerStep[]>(() => {
    const d = this.detail();
    return d ? trackerOf(d, formatDayTime) : [];
  });
  protected readonly productCount = computed(() => this.detail()?.lines.length ?? 0);
  protected readonly value = computed(() => formatMoney(this.detail()?.summary.value));
  /** The receipt can be started or continued while pieces are on the way. */
  protected readonly onTheWay = computed(() => {
    const status = this.detail()?.status;
    return status === 'IN_TRANSIT' || status === 'PARTIALLY_RECEIVED';
  });

  /** A sent transfer can be cancelled while nothing has reached the destination; the pieces go back to the origin. */
  protected readonly canCancel = computed(() => this.detail()?.status === 'IN_TRANSIT');

  protected readonly summary = computed(() => summarize(this.lines()));
  protected readonly nothingPending = computed(() => this.lines().length > 0 && this.lines().every((l) => pendingOf(l) === 0));
  protected readonly canRegister = computed(() => this.summary().receivingNow > 0 && this.summary().errors === 0 && this.busy() === null);
  protected readonly canFinish = computed(() => this.summary().errors === 0 && this.busy() === null);

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
          // "Por recibir" opens the detail already in receiving mode
          if (this.route.snapshot.queryParamMap.get('receive') === '1') this.startReceiving();
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.errorMessage.set(transferErrorMessage(problem));
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  // ── Receiving ──────────────────────────────────────────────────────────────

  /** "Recibir Productos": the same table now takes the pieces counted. Nothing leaves the page. */
  protected startReceiving() {
    const d = this.detail();
    if (!d || !this.ctx.can('inventory.transfers.receive') || (d.status !== 'IN_TRANSIT' && d.status !== 'PARTIALLY_RECEIVED')) return;
    this.lines.set(fromDetail(d));
    this.submitError.set(null);
    this.search.set('');
    this.requestedPage.set(1);
    this.receiving.set(true);
  }

  protected stopReceiving() {
    this.receiving.set(false);
    this.submitError.set(null);
    this.differencesOpen.set(false);
  }

  protected countOf(productId: string): number | string {
    const line = this.lines().find((l) => l.productId === productId);
    return line && line.counted > 0 ? line.counted : '';
  }

  protected errorOf(productId: string): string | null {
    const line = this.lines().find((l) => l.productId === productId);
    const error = line ? errorOf(line) : null;
    return error ? RECEIPT_ERROR_LABELS[error] : null;
  }

  protected canReceiveLine(productId: string): boolean {
    const line = this.lines().find((l) => l.productId === productId);
    return !!line && pendingOf(line) > 0;
  }

  protected receivedOf(productId: string): number | string {
    const line = this.lines().find((l) => l.productId === productId);
    return line && line.received > 0 ? line.received : '—';
  }

  protected onCount(productId: string, event: Event) {
    const raw = (event.target as HTMLInputElement).value.trim();
    this.lines.update((lines) => setCounted(lines, productId, raw === '' ? 0 : Number(raw)));
  }

  protected receiveLine(productId: string) {
    this.lines.update((lines) => receiveLine(lines, productId));
  }

  protected receiveAll() {
    this.lines.update((lines) => receiveAll(lines));
  }

  /** "Registrar recepción": a partial session. The transfer stays open unless this completes every line. */
  protected register() {
    const detail = this.detail();
    if (!detail || !this.canRegister()) return;
    this.busy.set('session');
    this.submitError.set(null);
    this.api
      .receive(this.id, { lines: toSessionLines(this.lines()), expectedUpdatedAt: detail.updatedAt })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          this.busy.set(null);
          this.detail.set(updated);
          this.stopReceiving();
          this.toast.success(updated.status === 'RECEIVED' ? 'Recepción completa' : 'Recepción registrada');
        },
        error: (err: unknown) => this.fail(err),
      });
  }

  /** "Finalizar recepción": opens IN-07 with the differences the final count leaves. */
  protected finish() {
    if (!this.canFinish()) return;
    this.submitError.set(null);
    this.differencesOpen.set(true);
  }

  protected confirmClose(surplus: Record<string, number>) {
    const detail = this.detail();
    if (!detail) return;
    this.busy.set('close');
    this.submitError.set(null);
    this.api
      .close(this.id, { lines: toSessionLines(this.lines()), surplus: toSurplusLines(this.lines(), surplus), expectedUpdatedAt: detail.updatedAt })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (closed) => {
          this.busy.set(null);
          this.detail.set(closed);
          this.stopReceiving();
          this.toast.success(closed.adjustment ? `Recepción finalizada. Ajuste pendiente ${closed.adjustment.number}` : 'Recepción finalizada');
        },
        error: (err: unknown) => this.fail(err),
      });
  }

  private fail(err: unknown) {
    this.busy.set(null);
    this.submitError.set(transferErrorMessage(problemOf(err)));
  }

  // ── Cancelling ─────────────────────────────────────────────────────────────

  protected askCancel() {
    this.submitError.set(null);
    this.cancelOpen.set(true);
  }

  protected confirmCancel() {
    const detail = this.detail();
    if (!detail || this.busy() !== null) return;
    this.busy.set('cancel');
    this.api
      .cancel(this.id, { expectedUpdatedAt: detail.updatedAt })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (cancelled) => {
          this.busy.set(null);
          this.cancelOpen.set(false);
          this.detail.set(cancelled);
          this.toast.success(`Transferencia cancelada. Las piezas volvieron a ${cancelled.origin.branch.name}.`);
        },
        error: (err: unknown) => {
          this.busy.set(null);
          this.submitError.set(transferErrorMessage(problemOf(err)));
        },
      });
  }

  // ── Table ──────────────────────────────────────────────────────────────────

  protected onSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
    this.requestedPage.set(1);
  }

  protected goToPage(page: number) {
    this.requestedPage.set(page);
  }

  protected formatReceiptDay(iso: string): string {
    return formatDay(iso);
  }

  protected back() {
    void this.router.navigate(['/inventory/transfers']);
  }
}
