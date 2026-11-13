import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { Decimal, type InvoiceCancellationItem } from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableCellDirective,
  type DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  PageHeaderComponent,
  SkeletonComponent,
} from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { formatBs, formatDateTime } from '../sales/cash/cash-format';
import { cancellationReasonLabel } from '../sales/history/sale-format';
import { invoiceNumberLabel } from './invoice-format';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const COLUMNS: DocTableColumn[] = [
  { key: 'invoice', label: 'N.º factura', type: 'custom', width: '9rem' },
  { key: 'customer', label: 'Cliente', type: 'text' },
  { key: 'date', label: 'Solicitada', type: 'number', width: '10rem' },
  { key: 'reason', label: 'Motivo', type: 'text' },
  { key: 'requestedBy', label: 'Solicitó', type: 'text', width: '12rem' },
  { key: 'total', label: 'Total', type: 'number', width: '9rem' },
  { key: 'status', label: 'Estado SIAT', type: 'status', width: '11rem' },
  { key: 'review', label: '', type: 'custom', align: 'end', width: '7rem' },
];

/** FS-18 · The cancellations waiting for Management. Each one opens the review page (FS-19), where it is approved or rejected. */
@Component({
  selector: 'rs-invoice-cancellations-page',
  imports: [ButtonComponent, DocTableCellDirective, DocTableComponent, EmptyStateIllustratedComponent, PageHeaderComponent, RouterLink, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-cancellations.page.html',
  styleUrl: './invoice-cancellations.page.scss',
})
export class InvoiceCancellationsPage {
  private readonly api = inject(InvoicingApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Facturación SIAT', link: '/invoicing' }, { label: 'Anulaciones por aprobar' }];
  protected readonly columns = COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 4 }, (_, i) => i);
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly items = signal<readonly InvoiceCancellationItem[]>([]);

  protected readonly rows = computed(() =>
    this.items().map((item) => ({
      id: item.saleId,
      label: invoiceNumberLabel(item.invoiceNumber),
      cells: {
        invoice: invoiceNumberLabel(item.invoiceNumber),
        customer: item.customerName,
        reason: cancellationReasonLabel(item.reason),
        requestedBy: item.requestedBy,
        date: formatDateTime(item.requestedAt),
        total: formatBs(item.total),
        status: { label: 'Por aprobar', status: 'warning' as const, icon: 'alert' as const },
      },
    })),
  );

  protected readonly totals = computed(() => ({
    invoice: 'Total',
    customer: `${this.items().length} ${this.items().length === 1 ? 'solicitud' : 'solicitudes'}`,
    date: '',
    reason: '',
    requestedBy: '',
    total: formatBs(this.items().reduce((sum, i) => sum.add(Decimal.of(i.total)), Decimal.zero()).toString()),
    status: '',
  }));

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .cancellations()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.items.set(response.items);
          this.state.set('ready');
        },
        error: (err) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  protected itemOf(saleId: string): InvoiceCancellationItem | null {
    return this.items().find((i) => i.saleId === saleId) ?? null;
  }

  protected back() {
    void this.router.navigate(['/invoicing']);
  }
}
