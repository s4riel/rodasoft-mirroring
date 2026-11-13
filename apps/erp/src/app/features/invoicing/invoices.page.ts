import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Decimal, type InvoiceListItem, type InvoiceListResponse } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DateRangePickerComponent,
  type DateRangeValue,
  DocTableCellDirective,
  type DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  PaginationComponent,
  RowActionComponent,
  SelectComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { catchError, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { invoiceFileName, saveBlob } from './file-download';
import { InvoiceCancellationDialog } from './invoice-cancellation.dialog';
import { InvoicePreviewDialog } from './invoice-preview.dialog';
import { InvoiceSendDialog } from './invoice-send.dialog';
import { problemOf } from '../../core/api-error';
import { ContextStore } from '../../core/context.store';
import { formatBs } from '../sales/cash/cash-format';
import {
  INVOICE_PAGE_SIZE,
  INVOICE_STATUS_OPTIONS,
  type InvoiceUrlFilters,
  invoiceMenuFor,
  invoiceRangeLabel,
  parseInvoiceStatus,
  toInvoiceQuery,
  toInvoiceRow,
} from './invoice-format';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/** The columns of the Figma table of FS-01, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'N.º factura', type: 'custom', width: '8rem' },
  { key: 'customer', label: 'Cliente', type: 'text' },
  { key: 'sale', label: 'Venta', type: 'text', width: '9rem' },
  { key: 'date', label: 'Fecha', type: 'number', width: '10rem' },
  { key: 'total', label: 'Total', type: 'number', width: '9rem' },
  { key: 'status', label: 'Estado SIAT', type: 'status', width: '14rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

/** FS-01/02/13 · SIAT invoices: the day indicators, the filters, the list with its row menu, and the empty, loading, error and no-permission states. */
@Component({
  selector: 'rs-invoices-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DateRangePickerComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    InvoiceCancellationDialog,
    InvoicePreviewDialog,
    InvoiceSendDialog,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    PaginationComponent,
    RouterLink,
    RowActionComponent,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoices.page.html',
  styleUrl: './invoices.page.scss',
})
export class InvoicesPage {
  private readonly api = inject(InvoicingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly context = inject(ContextStore);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Facturación SIAT' }, { label: 'Facturas' }];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = INVOICE_STATUS_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly filters = computed<InvoiceUrlFilters>(() => {
    const q = this.queryParams();
    return {
      q: q.get('q') ?? '',
      status: parseInvoiceStatus(q.get('status')),
      from: q.get('from'),
      to: q.get('to'),
      branchId: q.get('branch'),
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });
  protected readonly range = computed<DateRangeValue>(() => ({ from: this.filters().from, to: this.filters().to }));

  /** The branch filter of FS-01, offered only to who works in more than one branch. */
  protected readonly branchOptions = computed(() => this.context.branches().map((b) => ({ value: b.id, label: b.name })));

  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<InvoiceListResponse | null>(null);
  /** The invoice being issued right now, so its menu cannot fire twice. */
  protected readonly issuing = signal(false);
  /** Ids ticked in the table (FS-14); the bulk bar acts on them. */
  protected readonly selected = signal<readonly string[]>([]);
  protected readonly bulkBusy = signal(false);
  protected readonly maxSelected = 50;
  /** The invoice whose preview or send dialog is open. */
  protected readonly target = signal<InvoiceListItem | null>(null);
  protected readonly previewOpen = signal(false);
  protected readonly sendOpen = signal(false);
  protected readonly cancelOpen = signal(false);

  protected readonly items = computed<readonly InvoiceListItem[]>(() => this.data()?.items ?? []);
  protected readonly rows = computed(() => this.items().map(toInvoiceRow));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly kpis = computed(() => this.data()?.kpis ?? null);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / INVOICE_PAGE_SIZE)));
  protected readonly rangeText = computed(() => invoiceRangeLabel(this.filters().page, this.items().length, this.total()));
  protected readonly totals = computed(() => ({
    number: 'Total',
    customer: `${this.total()} ${this.total() === 1 ? 'factura' : 'facturas'}`,
    sale: '',
    date: '',
    total: formatBs(this.data()?.totalAmount ?? '0.00'),
    status: '',
  }));
  /** Invoices of this page that wait for a person to issue them. */
  protected readonly issuableIds = computed(() => this.items().filter((i) => i.actions.includes('ISSUE')).map((i) => i.id));
  protected readonly issuedTodayTotal = computed(() => formatBs(this.kpis()?.issuedToday.total ?? '0.00'));
  /** What the ticked invoices add up to, shown in the bulk bar. */
  protected readonly selectedTotal = computed(() => {
    const ids = new Set(this.selected());
    return formatBs(this.items().filter((i) => ids.has(i.id)).reduce((sum, i) => sum.add(Decimal.of(i.total)), Decimal.zero()).toString());
  });
  protected readonly notIssuedCount = computed(() => this.kpis()?.notIssued ?? 0);

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.status || f.from || f.to || f.q || f.branchId) || this.searchText().trim() !== '';
  });
  /** The company has no invoices at all: the first-use empty state (FS-02). */
  protected readonly showEmpty = computed(() => this.state() === 'ready' && this.total() === 0 && !this.hasFilters());
  protected readonly showNoResults = computed(() => this.state() === 'ready' && this.total() === 0 && this.hasFilters());

  private readonly params = computed(() => toInvoiceQuery(this.filters()));

  constructor() {
    effect(() => this.searchText.set(this.filters().q));
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));

    toObservable(this.params)
      .pipe(
        tap(() => this.state.set('loading')),
        switchMap((params) =>
          this.api.list(params).pipe(
            map((data) => ({ data })),
            catchError((err) => of({ error: problemOf(err) })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.show(result));
  }

  private show(result: { data: InvoiceListResponse } | { error: ReturnType<typeof problemOf> }) {
    if ('error' in result) {
      this.errorMessage.set(result.error.message);
      this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    this.data.set(result.data);
    this.state.set('ready');
  }

  protected setStatus(value: unknown) {
    this.navigate({ status: value ? String(value) : null, page: null });
  }

  protected setBranch(value: unknown) {
    this.navigate({ branch: value ? String(value) : null, page: null });
  }

  protected setRange(range: DateRangeValue) {
    this.navigate({ from: range.from, to: range.to, page: null });
  }

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null, page: null }), 300);
  }

  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.navigate({ q: null, status: null, from: null, to: null, branch: null, page: null });
  }

  protected goToPage(page: number) {
    if (page !== this.filters().page) this.navigate({ page: page > 1 ? String(page) : null });
  }

  protected retry() {
    this.state.set('loading');
    this.api
      .list(this.params())
      .pipe(
        map((data) => ({ data })),
        catchError((err) => of({ error: problemOf(err) })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.show(result));
  }

  protected itemOf(rowId: string): InvoiceListItem | null {
    return this.items().find((i) => i.id === rowId) ?? null;
  }

  protected menuFor(item: InvoiceListItem) {
    return invoiceMenuFor(item);
  }

  protected menuLabel(item: InvoiceListItem): string {
    return `Acciones de la factura ${item.number ?? item.saleNumber}`;
  }

  /** The chosen action of a row's ⋯ menu. */
  protected async onAction(item: InvoiceListItem, key: string) {
    if (key === 'view') void this.router.navigate(['/invoicing/invoices', item.id]);
    // the credit note itself is HU-FAC-12: for now it opens the return form of the sale (HU-VEN-21)
    if (key === 'credit-note') void this.router.navigate(['/sales/history', item.saleId]);
    if (key === 'cancel') {
      this.target.set(item);
      this.cancelOpen.set(true);
    }
    if (key === 'issue') await this.issue([item.id]);
    if (key === 'pdf') this.openPreview(item);
    if (key === 'send') this.openSend(item);
    if (key === 'xml') await this.downloadXml(item);
  }

  protected openPreview(item: InvoiceListItem) {
    this.target.set(item);
    this.previewOpen.set(true);
  }

  protected openSend(item: InvoiceListItem) {
    this.target.set(item);
    this.sendOpen.set(true);
  }

  private async downloadXml(item: InvoiceListItem) {
    try {
      saveBlob(await firstValueFrom(this.api.xml(item.id)), invoiceFileName(item.number, 'xml'));
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    }
  }

  protected clearSelection() {
    this.selected.set([]);
  }

  /** A ZIP of the selected invoices; the ones the SIAT has not issued are left out and the toast says how many. */
  protected async downloadSelected(format: 'PDF' | 'XML') {
    if (this.bulkBusy()) return;
    this.bulkBusy.set(true);
    try {
      const response = await firstValueFrom(this.api.download(this.selected(), format));
      const skipped = (response.headers.get('X-Invoices-Skipped') ?? '').split(',').filter(Boolean).length;
      if (response.body) saveBlob(response.body, `facturas-${format.toLowerCase()}.zip`);
      if (skipped > 0) this.toast.warning(`${skipped} ${skipped === 1 ? 'factura no se incluyó' : 'facturas no se incluyeron'} porque el SIAT todavía no las emitió.`);
      else this.toast.success('Descarga lista');
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    } finally {
      this.bulkBusy.set(false);
    }
  }

  /** E-mails the selected invoices to their customers and reports the ones that could not be sent. */
  protected async emailSelected() {
    if (this.bulkBusy()) return;
    this.bulkBusy.set(true);
    try {
      const { results } = await firstValueFrom(this.api.deliverMany(this.selected()));
      const sent = results.filter((r) => r.ok).length;
      const noEmail = results.filter((r) => r.code === 'CUSTOMER_WITHOUT_EMAIL').length;
      const other = results.length - sent - noEmail;
      const parts = [`${sent} ${sent === 1 ? 'factura enviada' : 'facturas enviadas'}`];
      if (noEmail > 0) parts.push(`${noEmail} sin correo del cliente`);
      if (other > 0) parts.push(`${other} no se pudieron enviar`);
      if (sent === results.length) this.toast.success(parts.join(' · '));
      else this.toast.warning(parts.join(' · '));
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    } finally {
      this.bulkBusy.set(false);
    }
  }

  /** "Emitir seleccionadas": issues the ticked invoices that wait for a person. */
  protected issueSelected() {
    const issuable = new Set(this.issuableIds());
    return this.issue(this.selected().filter((id) => issuable.has(id)));
  }

  /** "Emitir pendientes": issues every invoice of the page that waits for a person. */
  protected issuePending() {
    return this.issue(this.issuableIds());
  }

  private async issue(ids: readonly string[]) {
    if (this.issuing() || ids.length === 0) return;
    this.issuing.set(true);
    try {
      const { results } = await firstValueFrom(this.api.issueMany(ids));
      const failed = results.filter((r) => !r.ok);
      if (failed.length === 0) this.toast.success(ids.length === 1 ? 'Factura enviada al SIAT' : `${ids.length} facturas enviadas al SIAT`);
      else this.toast.warning(`${results.length - failed.length} de ${results.length} facturas enviadas. Revisa las demás.`);
      this.selected.set([]);
      this.retry();
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    } finally {
      this.issuing.set(false);
    }
  }

  private navigate(queryParams: Record<string, string | null>) {
    // the bulk bar only acts on what the page on screen shows
    this.selected.set([]);
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
