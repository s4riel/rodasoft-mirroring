import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { Decimal, type SaleDetail } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableCell,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  EmptyStateIllustratedComponent,
  FieldComponent,
  IconComponent,
  InputDirective,
  ModalComponent,
  NoteComponent,
  PageHeaderComponent,
  RS_PERMISSIONS,
  SkeletonComponent,
  StatusPillComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs, formatDateTime } from '../cash/cash-format';
import { documentText } from '../customers/customer-format';
import { PosApi } from '../pos/pos-api.service';
import { SaleCancellationDialog } from './sale-cancellation.dialog';
import { cancellationReasonLabel, historyLabel, invoiceLabel, PAYMENT_METHOD_LABELS, SALE_STATUS_PILLS } from './sale-format';
import { SalesHistoryApi } from './sales-history-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const LINE_COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code', width: '10rem' },
  { key: 'name', label: 'Producto', type: 'text' },
  { key: 'quantity', label: 'Cant.', type: 'number', width: '6rem' },
  { key: 'unitPrice', label: 'Precio', type: 'number', width: '9rem' },
  { key: 'lineTotal', label: 'Total', type: 'number', width: '9rem' },
];

/**
 * VP-02 · Detail of a sale: products, payment, linked invoice and history, with reprint and e-mail. It also asks for the
 * cancellation of the sale (VP-15a, HU-VEN-14) and shows it while it waits for Management (VP-15).
 */
@Component({
  selector: 'rs-sale-detail-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    IconComponent,
    InputDirective,
    ModalComponent,
    NoteComponent,
    PageHeaderComponent,
    SaleCancellationDialog,
    SkeletonComponent,
    StatusPillComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sale-detail.page.html',
  styleUrl: './sale-detail.page.scss',
})
export class SaleDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(SalesHistoryApi);
  private readonly posApi = inject(PosApi);
  private readonly toast = inject(ToastService);
  private readonly permissions = inject(RS_PERMISSIONS);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly lineColumns = LINE_COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 4 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly detail = signal<SaleDetail | null>(null);

  protected readonly emailOpen = signal(false);
  protected readonly email = signal('');
  protected readonly emailSending = signal(false);
  protected readonly canSend = computed(() => this.email().trim() !== '' && !this.emailSending());

  protected readonly cancelOpen = signal(false);
  protected readonly withdrawOpen = signal(false);
  protected readonly withdrawing = signal(false);
  /** The sale can be asked to be cancelled (the button also needs the permission). */
  protected readonly canRequestCancellation = computed(() => this.detail()?.cancellation.canRequest ?? false);
  /** The request waiting for Management, as the banner of VP-15 says it. */
  protected readonly pending = computed(() => {
    const p = this.detail()?.cancellation.pending;
    if (!p) return null;
    return {
      canWithdraw: p.canWithdraw,
      text: `Solicitada por ${p.requestedBy} el ${formatDateTime(p.requestedAt)} · motivo: ${cancellationReasonLabel(p.reason).toLowerCase()}. La factura sigue válida.`,
      comment: p.comment,
    };
  });

  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Ventas realizadas', link: '/sales/history' },
    { label: this.detail()?.number ?? 'Venta' },
  ]);

  protected readonly pill = computed(() => {
    const d = this.detail();
    return d ? SALE_STATUS_PILLS[d.status] : null;
  });
  protected readonly createdText = computed(() => formatDateTime(this.detail()?.createdAt ?? ''));
  protected readonly customerDocument = computed(() => {
    const c = this.detail()?.customer;
    return c ? documentText({ documentType: c.documentType, documentNumber: c.documentNumber, complement: null }) : '';
  });
  protected readonly invoiceText = computed(() => {
    const i = this.detail()?.invoice;
    return i ? invoiceLabel(i.status, i.number) : '';
  });
  protected readonly invoicePending = computed(() => this.detail()?.invoice.status === 'PENDING');

  protected readonly lineRows = computed<DocTableRow[]>(() =>
    (this.detail()?.lines ?? []).map((l, index) => ({
      id: String(index),
      label: l.code,
      cells: { code: l.code, name: l.name, quantity: l.quantity, unitPrice: formatBs(l.unitPrice), lineTotal: formatBs(l.lineTotal) },
    })),
  );
  protected readonly lineTotals = computed<Record<string, DocTableCell> | null>(() => {
    const d = this.detail();
    if (!d) return null;
    return { code: 'Total', name: '', quantity: d.lines.reduce((sum, l) => sum + l.quantity, 0), unitPrice: '', lineTotal: formatBs(d.total) };
  });

  /** The amounts between the lines and the total: only the ones that apply. */
  protected readonly adjustments = computed(() => {
    const d = this.detail();
    if (!d) return [];
    const rows = [{ label: 'Subtotal', value: formatBs(d.subtotal) }];
    if (!Decimal.of(d.discountAmount).isZero()) rows.push({ label: 'Descuento', value: `−${formatBs(d.discountAmount)}` });
    if (!Decimal.of(d.roundingAmount).isZero()) rows.push({ label: 'Redondeo', value: formatBs(d.roundingAmount) });
    return rows;
  });

  protected readonly payments = computed(() =>
    (this.detail()?.payments ?? []).map((p) => ({
      method: PAYMENT_METHOD_LABELS[p.method],
      amount: formatBs(p.amount),
      change: Decimal.of(p.change).isZero() ? null : formatBs(p.change),
      reference: p.reference,
    })),
  );

  protected readonly history = computed(() =>
    (this.detail()?.history ?? []).map((h) => ({ label: historyLabel(h), at: formatDateTime(h.at), by: h.userName })),
  );

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    const id = this.route.snapshot.paramMap.get('id') ?? '';
    this.api
      .detail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.email.set(detail.customer.email ?? '');
          this.state.set('ready');
          // the row menu of the list sends here to ask for the cancellation
          const asked = this.route.snapshot.queryParamMap.get('cancel') === '1';
          if (asked && detail.cancellation.canRequest && this.permissions().has('sales.cancellations.request')) this.cancelOpen.set(true);
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  /** Opens the ticket in its own tab; the print page records the reprint. */
  protected reprint() {
    const d = this.detail();
    if (!d) return;
    const url = this.router.serializeUrl(this.router.createUrlTree(['/sales/receipts', d.id, 'print'], { queryParams: { reprint: 1 } }));
    window.open(url, '_blank', 'noopener');
  }

  /** Reloads the sale without the skeleton, so the page does not flash after an action. */
  private refreshHistory() {
    const id = this.detail()?.id;
    if (!id) return;
    this.api
      .detail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (detail) => this.detail.set(detail), error: () => undefined });
  }

  protected toggleEmail() {
    this.emailOpen.update((open) => !open);
  }

  protected submitEmail() {
    const d = this.detail();
    if (!d || !this.canSend()) return;
    this.emailSending.set(true);
    this.posApi.sendReceiptEmail(d.id, this.email().trim()).subscribe({
      next: () => {
        this.emailSending.set(false);
        this.emailOpen.set(false);
        this.toast.success('Comprobante en camino a ' + this.email().trim());
        this.refreshHistory();
      },
      error: (err: unknown) => {
        this.emailSending.set(false);
        this.toast.danger(problemOf(err).message);
      },
    });
  }

  /** The request was saved: the sale now waits for Management. */
  protected onRequested() {
    this.toast.success('Solicitud de anulación enviada a Gerencia');
    this.refreshHistory();
  }

  protected withdraw() {
    const d = this.detail();
    if (!d || this.withdrawing()) return;
    this.withdrawing.set(true);
    this.api
      .withdrawCancellation(d.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.withdrawing.set(false);
          this.withdrawOpen.set(false);
          this.toast.success('Solicitud de anulación retirada');
          this.refreshHistory();
        },
        error: (err: unknown) => {
          this.withdrawing.set(false);
          this.withdrawOpen.set(false);
          this.toast.danger(problemOf(err).message);
          // another user may have decided in between: show what the sale is now
          this.refreshHistory();
        },
      });
  }

  protected back() {
    void this.router.navigate(['/sales/history']);
  }
}
