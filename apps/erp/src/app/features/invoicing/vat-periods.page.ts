import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import type { VatPeriodRow, VatPeriodsResponse } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableCellDirective,
  type DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  KpiCardComponent,
  PageHeaderComponent,
  PaginationComponent,
  RowActionComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { periodLabel } from './credit-note-format';
import { PERIOD_STATUS_PILLS, periodMenuFor, toPeriodRow } from './fiscal-format';
import { InvoicingApi } from './invoicing-api.service';
import { VatPeriodCloseDialog } from './vat-period-close.dialog';
import { VatPeriodReopenDialog } from './vat-period-reopen.dialog';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const PAGE_SIZE = 12;
const COLUMNS: DocTableColumn[] = [
  { key: 'period', label: 'Período', type: 'text' },
  { key: 'sales', label: 'Facturas de venta', type: 'text', width: '11rem' },
  { key: 'purchases', label: 'Compras', type: 'text', width: '8rem' },
  { key: 'debit', label: 'Débito fiscal (Bs)', type: 'number', width: '11rem' },
  { key: 'credit', label: 'Crédito fiscal (Bs)', type: 'number', width: '11rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '9rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

/**
 * FS-37 · Closing VAT periods (HU-FAC-21): one row per La Paz month with its status and totals, and the actions to close, file and
 * reopen a period (the dialogs FS-40 and reopen). A closed period freezes its books and its cancellations.
 */
@Component({
  selector: 'rs-vat-periods-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    KpiCardComponent,
    PageHeaderComponent,
    PaginationComponent,
    RowActionComponent,
    SkeletonComponent,
    ToastOutletComponent,
    VatPeriodCloseDialog,
    VatPeriodReopenDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vat-periods.page.html',
  styleUrl: './vat-periods.page.scss',
})
export class VatPeriodsPage {
  private readonly api = inject(InvoicingApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly columns = COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);
  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Facturación SIAT' }, { label: 'Libros IVA', link: '/invoicing/books' }, { label: 'Períodos' }];
  protected readonly label = periodLabel;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<VatPeriodsResponse | null>(null);
  protected readonly page = signal(1);
  protected readonly closing = signal<string | null>(null);
  protected readonly closeOpen = signal(false);
  protected readonly reopening = signal<string | null>(null);
  protected readonly reopenOpen = signal(false);

  protected readonly items = computed(() => this.data()?.items ?? []);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.items().length / PAGE_SIZE)));
  protected readonly rows = computed(() => this.items().slice((this.page() - 1) * PAGE_SIZE, this.page() * PAGE_SIZE).map(toPeriodRow));
  protected readonly lastClosedText = computed(() => {
    const last = this.data()?.kpis.lastClosed;
    return last ? periodLabel(last) : 'Ninguno';
  });
  protected readonly filedText = computed(() => {
    const k = this.data()?.kpis;
    return k ? `${k.filed} de ${k.total}` : '';
  });
  protected readonly totals = computed(() => ({ period: 'Total', sales: `${this.items().length} ${this.items().length === 1 ? 'período' : 'períodos'}` }));
  protected readonly rangeText = computed(() => {
    const total = this.items().length;
    if (!total) return '';
    const from = (this.page() - 1) * PAGE_SIZE + 1;
    return `${from}–${Math.min(total, this.page() * PAGE_SIZE)} de ${total} ${total === 1 ? 'período' : 'períodos'}`;
  });
  /** The period the header button closes: the oldest open one whose month is over (the API checks the rest). */
  protected readonly closable = computed(() => {
    const current = this.data()?.kpis.current;
    return [...this.items()].reverse().find((item) => item.status === 'OPEN' && item.actions.includes('CLOSE') && current !== undefined && item.period < current) ?? null;
  });
  protected readonly currentStatusText = computed(() => {
    const k = this.data()?.kpis;
    const status = this.items().find((item) => item.period === k?.current)?.status ?? 'OPEN';
    return PERIOD_STATUS_PILLS[status].label;
  });
  protected readonly currentText = computed(() => {
    const k = this.data()?.kpis;
    return k ? periodLabel(k.current) : '';
  });

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .periods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.data.set(data);
          this.page.set(Math.min(this.page(), Math.max(1, Math.ceil(data.items.length / PAGE_SIZE))));
          this.state.set('ready');
        },
        error: (err) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  protected itemOf(period: string): VatPeriodRow | null {
    return this.items().find((item) => item.period === period) ?? null;
  }

  protected menuFor(item: VatPeriodRow) {
    return periodMenuFor(item);
  }

  protected act(item: VatPeriodRow, key: string) {
    switch (key) {
      case 'books':
        void this.router.navigate(['/invoicing/books'], { queryParams: { period: item.period } });
        break;
      case 'close':
        this.closing.set(item.period);
        this.closeOpen.set(true);
        break;
      case 'reopen':
        this.reopening.set(item.period);
        this.reopenOpen.set(true);
        break;
      case 'file':
        this.api
          .filePeriod(item.period)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.toast.success(`${periodLabel(item.period)} marcado como presentado`);
              this.load();
            },
            error: (err) => this.toast.danger(problemOf(err).message),
          });
        break;
    }
  }

  protected closeOldest() {
    const item = this.closable();
    if (!item) return;
    this.closing.set(item.period);
    this.closeOpen.set(true);
  }

  protected changed() {
    this.load();
  }
}
