import { Clipboard } from '@angular/cdk/clipboard';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Decimal, fiscalDebit, IdentityDocumentType, type InvoiceDetail } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DataFieldComponent,
  DocTableComponent,
  type DocTableColumn,
  EmptyStateIllustratedComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  QrCodeComponent,
  SkeletonComponent,
  StatusPillComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { firstValueFrom } from 'rxjs';
import { problemOf } from '../../core/api-error';
import { formatBs, formatDateTime } from '../sales/cash/cash-format';
import { invoiceFileName, saveBlob } from './file-download';
import { InvoiceCustomerFixComponent } from './invoice-customer-fix.component';
import { InvoiceCancellationDialog } from './invoice-cancellation.dialog';
import { InvoicePreviewDialog } from './invoice-preview.dialog';
import { InvoiceSendDialog } from './invoice-send.dialog';
import { historyLabel, INVOICE_STATUS_PILLS, invoiceNumberLabel, PAYMENT_LABELS } from './invoice-format';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'not-found';

const LINE_COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code', width: '9rem' },
  { key: 'description', label: 'Producto', type: 'text' },
  { key: 'quantity', label: 'Cant.', type: 'number', width: '6rem' },
  { key: 'unitPrice', label: 'Precio', type: 'number', width: '9rem' },
  { key: 'total', label: 'Subtotal', type: 'number', width: '9rem' },
];

/** FS-03 · One invoice: customer, products, payment, the SIAT data (CUF to copy, modality, point of sale), the QR and the history. */
@Component({
  selector: 'rs-invoice-detail-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DataFieldComponent,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    InvoiceCancellationDialog,
    InvoiceCustomerFixComponent,
    InvoicePreviewDialog,
    InvoiceSendDialog,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    QrCodeComponent,
    RouterLink,
    SkeletonComponent,
    StatusPillComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-detail.page.html',
  styleUrl: './invoice-detail.page.scss',
})
export class InvoiceDetailPage {
  private readonly api = inject(InvoicingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly clipboard = inject(Clipboard);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly lineColumns = LINE_COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly detail = signal<InvoiceDetail | null>(null);
  protected readonly issuing = signal(false);
  protected readonly previewOpen = signal(false);
  protected readonly sendOpen = signal(false);
  protected readonly cancelOpen = signal(false);
  protected readonly withdrawing = signal(false);

  protected readonly pill = computed(() => {
    const d = this.detail();
    return d ? INVOICE_STATUS_PILLS[d.status] : null;
  });
  protected readonly title = computed(() => {
    const d = this.detail();
    return d ? (d.number === null ? `Factura de la venta ${d.saleNumber}` : `Factura ${invoiceNumberLabel(d.number)}`) : 'Detalle de factura';
  });
  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Facturación', link: '/invoicing' },
    { label: this.title() },
  ]);
  protected readonly lineRows = computed(() =>
    (this.detail()?.lines ?? []).map((line, index) => ({
      id: String(index),
      label: line.description,
      cells: { code: line.code, description: line.description, quantity: line.quantity, unitPrice: formatBs(line.unitPrice), total: formatBs(line.total) },
    })),
  );
  protected readonly lineTotals = computed(() => ({ code: '', description: 'Total', quantity: '', unitPrice: '', total: formatBs(this.detail()?.total ?? '0.00') }));
  protected readonly payments = computed(() => (this.detail()?.payments ?? []).map((p) => ({ label: PAYMENT_LABELS[p.method] ?? p.method, amount: formatBs(p.amount) })));
  protected readonly history = computed(() =>
    (this.detail()?.history ?? []).map((entry) => ({ at: formatDateTime(entry.at), label: historyLabel(entry.action), actor: entry.actor, detail: entry.detail })),
  );
  /** The invoice has documents once the SIAT issued it (also after it was cancelled). */
  protected readonly hasDocuments = computed(() => this.detail()?.actions.includes('DOWNLOAD_PDF') ?? false);
  protected readonly canRequestCancellation = computed(() => this.detail()?.actions.includes('REQUEST_CANCELLATION') ?? false);
  protected readonly canCreditNote = computed(() => this.detail()?.actions.includes('ISSUE_CREDIT_NOTE') ?? false);
  protected readonly canWithdraw = computed(() => this.detail()?.pendingCancellation != null);
  protected readonly canIssue = computed(() => this.detail()?.actions.includes('ISSUE') ?? false);
  /** The line under the title: customer, issue date, sale and branch (FS-03). */
  protected readonly subtitle = computed(() => {
    const d = this.detail();
    if (!d) return '';
    return [d.customerName, d.issuedAt ? formatDateTime(d.issuedAt) : null, `Venta ${d.saleNumber}`, d.branchName].filter(Boolean).join(' · ');
  });
  protected readonly totalText = computed(() => formatBs(this.detail()?.total ?? '0.00'));
  protected readonly fiscalDebitText = computed(() => `${formatBs(fiscalDebit(Decimal.of(this.detail()?.total ?? '0.00')).toString())} · 13 %`);
  protected readonly originText = computed(() => {
    const d = this.detail();
    return d ? [d.saleNumber, d.pointOfSale?.split(' · ')[1]].filter(Boolean).join(' · ') : '';
  });
  protected readonly numberText = computed(() => invoiceNumberLabel(this.detail()?.number ?? null));
  protected readonly cufShort = computed(() => {
    const cuf = this.detail()?.cuf;
    return cuf ? (cuf.length > 14 ? `${cuf.slice(0, 6)}…${cuf.slice(-4)}` : cuf) : '—';
  });
  protected readonly modalityText = computed(() => {
    const m = this.detail()?.modality;
    return m === 'COMPUTERIZED_ONLINE' ? 'Computarizada en línea' : m === 'ELECTRONIC_ONLINE' ? 'Electrónica en línea' : '—';
  });
  /** "Válida · en línea" and its like, as the SIAT panel says it. */
  protected readonly statusText = computed(() => {
    const d = this.detail();
    if (!d) return '';
    return d.status === 'VALID' ? 'Válida · en línea' : (INVOICE_STATUS_PILLS[d.status]?.label ?? d.status);
  });
  protected readonly issuedText = computed(() => {
    const d = this.detail();
    return d?.issuedAt ? formatDateTime(d.issuedAt) : '—';
  });
  protected readonly customerDocument = computed(() => {
    const d = this.detail();
    if (!d) return '';
    const complement = d.customerComplement ? `-${d.customerComplement}` : '';
    return `${d.customerDocumentType === IdentityDocumentType.NIT ? 'NIT' : 'Documento'} ${d.customerDocumentNumber}${complement}`;
  });

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => this.load());
  }

  protected load() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.state.set('loading');
    this.api
      .detail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.state.set('ready');
        },
        error: (err) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : problem.status === 404 ? 'not-found' : 'error');
        },
      });
  }

  /** Reads the invoice again without the skeleton: the correction form keeps its place. */
  protected refresh() {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) return;
    this.api
      .detail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (detail) => this.detail.set(detail), error: (err) => this.toast.danger(problemOf(err).message) });
  }

  /** "Copiar": writes the CUF to the clipboard. */
  protected copyCuf() {
    const cuf = this.detail()?.cuf;
    if (!cuf) return;
    if (this.clipboard.copy(cuf)) this.toast.success('CUF copiado');
    else this.toast.danger('No pudimos copiar el CUF');
  }

  protected async issue() {
    const d = this.detail();
    if (!d || this.issuing()) return;
    this.issuing.set(true);
    try {
      await firstValueFrom(this.api.issue(d.id));
      this.toast.success('Factura enviada al SIAT');
      this.load();
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    } finally {
      this.issuing.set(false);
    }
  }

  /** The requester takes the open request back: the invoice stays valid and nothing else moved. */
  protected async withdraw() {
    const d = this.detail();
    if (!d || this.withdrawing()) return;
    this.withdrawing.set(true);
    try {
      await firstValueFrom(this.api.withdrawCancellation(d.saleId));
      this.toast.success('Solicitud de anulación cancelada');
      this.refresh();
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    } finally {
      this.withdrawing.set(false);
    }
  }

  protected async downloadFile(kind: 'pdf' | 'xml') {
    const d = this.detail();
    if (!d) return;
    try {
      const blob = await firstValueFrom(kind === 'pdf' ? this.api.pdf(d.id) : this.api.xml(d.id));
      saveBlob(blob, invoiceFileName(d.number, kind));
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    }
  }

  protected back() {
    void this.router.navigate(['/invoicing']);
  }
}
