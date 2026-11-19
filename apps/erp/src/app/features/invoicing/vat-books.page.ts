import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  currentVatBookPeriod,
  isVatBookPeriod,
  type PurchaseBookRow,
  type PurchasesBookResponse,
  type SalesBookResponse,
  type SalesBookRow,
  type VatBook,
  type VatBookExportFormat,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableCellDirective,
  type DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  RowActionComponent,
  SelectComponent,
  type SelectOption,
  SkeletonComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../core/api-error';
import { ContextStore } from '../../core/context.store';
import { formatBs } from '../sales/cash/cash-format';
import { periodLabel, periodOptions, toPurchaseRow, toSalesBookRow } from './credit-note-format';
import { InvoicingApi } from './invoicing-api.service';
import { VatBookExportDialog } from './vat-book-export.dialog';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type BookData = { book: 'SALES'; data: SalesBookResponse } | { book: 'PURCHASES'; data: PurchasesBookResponse };

const BOOK_OPTIONS: SelectOption[] = [
  { value: 'SALES', label: 'Libro de ventas' },
  { value: 'PURCHASES', label: 'Libro de compras' },
];

const SALES_COLUMNS: DocTableColumn[] = [
  { key: 'date', label: 'Fecha', type: 'text', width: '9rem' },
  { key: 'number', label: 'N.º documento', type: 'code', width: '10rem' },
  { key: 'customer', label: 'Cliente · NIT', type: 'text' },
  { key: 'total', label: 'Importe (Bs)', type: 'number', width: '10rem' },
  { key: 'debit', label: 'Débito fiscal (Bs)', type: 'number', width: '10rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '12rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

const PURCHASE_COLUMNS: DocTableColumn[] = [
  { key: 'date', label: 'Fecha', type: 'text', width: '9rem' },
  { key: 'number', label: 'N.º factura', type: 'code', width: '10rem' },
  { key: 'supplier', label: 'Proveedor · NIT', type: 'text' },
  { key: 'total', label: 'Importe (Bs)', type: 'number', width: '10rem' },
  { key: 'credit', label: 'Crédito fiscal (Bs)', type: 'number', width: '10rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '12rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

/**
 * FS-08 / FS-10 · VAT books (HU-FAC-18, 19, 20): the sales book (the invoices and credit notes the SIAT validated, with the 13 % fiscal
 * debit) and the purchases book (with the observed purchases that add no credit until their NIT is verified), by La Paz month, and the
 * export. A month that has not ended is a draft. The book and period are in the URL.
 */
@Component({
  selector: 'rs-vat-books-page',
  imports: [
    ButtonComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    RowActionComponent,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
    VatBookExportDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vat-books.page.html',
  styleUrl: './vat-books.page.scss',
})
export class VatBooksPage {
  private readonly api = inject(InvoicingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly context = inject(ContextStore);

  protected readonly bookOptions = BOOK_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);
  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });
  private readonly currentPeriod = currentVatBookPeriod(new Date());
  /** Short labels for the filter (the Figma select reads "Octubre 2026"); the export dialog marks the open one. */
  protected readonly periods = periodOptions(this.currentPeriod, 12, false);
  protected readonly exportPeriods = periodOptions(this.currentPeriod);

  protected readonly book = computed<VatBook>(() => (this.queryParams().get('book') === 'purchases' ? 'PURCHASES' : 'SALES'));
  protected readonly period = computed(() => {
    const raw = this.queryParams().get('period');
    return isVatBookPeriod(raw) ? raw : this.currentPeriod;
  });
  protected readonly branchId = computed(() => this.queryParams().get('branch'));
  protected readonly branchOptions = computed(() => this.context.branches().map((b) => ({ value: b.id, label: b.name })));

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly loaded = signal<BookData | null>(null);
  protected readonly search = signal('');
  protected readonly exportOpen = signal(false);
  /** Closed or filed periods, read when the export dialog opens: the dialog marks any other as a draft. */
  protected readonly closedPeriods = signal<readonly string[]>([]);

  protected readonly sales = computed(() => (this.loaded()?.book === 'SALES' ? (this.loaded()?.data as SalesBookResponse) : null));
  protected readonly purchases = computed(() => (this.loaded()?.book === 'PURCHASES' ? (this.loaded()?.data as PurchasesBookResponse) : null));
  protected readonly draft = computed(() => this.loaded()?.data.draft ?? false);
  protected readonly formats = computed<VatBookExportFormat[]>(() => this.loaded()?.data.exportFormats ?? ['XLSX', 'CSV']);
  protected readonly periodName = computed(() => periodLabel(this.period()));
  protected readonly formatBs = formatBs;
  protected readonly columns = computed(() => (this.book() === 'SALES' ? SALES_COLUMNS : PURCHASE_COLUMNS));
  protected readonly title = computed(() => (this.book() === 'SALES' ? 'Libro de ventas' : 'Libro de compras'));
  protected readonly description = computed(() =>
    this.book() === 'SALES'
      ? 'Facturas y notas que el SIAT validó en el período, en el formato del SIN.'
      : 'Facturas de compra del período que dan crédito fiscal. Cada registro se valida contra el SIN.',
  );
  protected readonly breadcrumbs = computed(() => [{ label: 'Inicio', link: '/' }, { label: 'Facturación SIAT' }, { label: this.title() }]);

  /** Rows that match the search box: the book is one month, so it is filtered on screen. */
  private readonly term = computed(() => this.search().trim().toLowerCase());
  protected readonly salesRows = computed(() => (this.sales()?.rows ?? []).filter((r) => this.matches(`${r.customerName} ${r.customerDocumentNumber} ${r.number}`)).map(toSalesBookRow));
  protected readonly purchaseRows = computed(() => (this.purchases()?.rows ?? []).filter((r) => this.matches(`${r.supplierName} ${r.supplierNit} ${r.invoiceNumber}`)).map(toPurchaseRow));
  protected readonly rows = computed(() => (this.book() === 'SALES' ? this.salesRows() : this.purchaseRows()));
  protected readonly totalRow = computed<Record<string, string> | null>(() => {
    const s = this.sales();
    const p = this.purchases();
    if (s) {
      const row: Record<string, string> = {
        date: 'Total',
        number: '',
        customer: `${s.rows.length} registros · ${VatBooksPage.plural(s.totals.cancelled, 'anulada', 'anuladas')}`,
        total: formatBs(s.totals.netAmount),
        debit: formatBs(s.totals.fiscalDebit),
        status: '',
        actions: '',
      };
      return row;
    }
    if (p) {
      const row: Record<string, string> = {
        date: 'Total',
        number: '',
        supplier: `${p.rows.length} registros · ${VatBooksPage.plural(p.totals.observed, 'observada', 'observadas')}`,
        total: formatBs(p.totals.totalAmount),
        credit: formatBs(p.totals.vatCredit),
        status: '',
        actions: '',
      };
      return row;
    }
    return null;
  });
  private static plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }
  protected readonly observedText = computed(() => {
    const n = this.purchases()?.totals.observed ?? 0;
    return VatBooksPage.plural(n, 'compra observada', 'compras observadas');
  });
  protected readonly observedShort = computed(() => {
    const n = this.purchases()?.totals.observed ?? 0;
    return n > 0 ? VatBooksPage.plural(n, 'observada', 'observadas') : 'Nada por revisar';
  });
  protected readonly invoicesText = computed(() => {
    const t = this.sales()?.totals;
    return t ? `${t.invoices}${t.cancelled > 0 ? ` · ${VatBooksPage.plural(t.cancelled, 'anulada', 'anuladas')}` : ''}` : '';
  });
  protected readonly entriesText = computed(() => {
    const t = this.purchases()?.totals;
    return t ? `${t.entries}${t.observed > 0 ? ` · ${VatBooksPage.plural(t.observed, 'observada', 'observadas')}` : ''}` : '';
  });
  protected readonly firstObserved = computed(() => this.purchases()?.rows.find((r) => r.status === 'OBSERVED') ?? null);
  protected readonly isEmpty = computed(() => this.state() === 'ready' && (this.loaded()?.data.rows.length ?? 0) === 0);
  protected readonly noResults = computed(() => this.state() === 'ready' && !this.isEmpty() && this.rows().length === 0);

  private readonly loadClosed = effect(() => {
    if (!this.exportOpen()) return;
    this.api
      .periods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (response) => this.closedPeriods.set(response.items.filter((item) => item.status !== 'OPEN').map((item) => item.period)), error: () => undefined });
  });

  private readonly request = computed(() => ({ book: this.book(), period: this.period(), branchId: this.branchId() ?? undefined }));

  constructor() {
    toObservable(this.request)
      .pipe(
        tap(() => this.state.set('loading')),
        switchMap((req) => this.fetch(req)),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.show(result));
  }

  private fetch(req: { book: VatBook; period: string; branchId?: string }) {
    const source = req.book === 'SALES' ? this.api.salesBook(req.period, req.branchId).pipe(map((data): BookData => ({ book: 'SALES', data }))) : this.api.purchasesBook(req.period).pipe(map((data): BookData => ({ book: 'PURCHASES', data })));
    return source.pipe(
      map((loaded) => ({ loaded })),
      catchError((err) => of({ error: problemOf(err) })),
    );
  }

  private show(result: { loaded: BookData } | { error: ReturnType<typeof problemOf> }) {
    if ('error' in result) {
      this.errorMessage.set(result.error.message);
      this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    this.loaded.set(result.loaded);
    this.state.set('ready');
  }

  protected reload() {
    this.state.set('loading');
    this.fetch(this.request()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => this.show(result));
  }

  private matches(text: string): boolean {
    return this.term() === '' || text.toLowerCase().includes(this.term());
  }

  protected setBook(value: unknown) {
    this.navigate({ book: value === 'PURCHASES' ? 'purchases' : null });
  }

  protected setPeriod(value: unknown) {
    this.navigate({ period: value && value !== this.currentPeriod ? String(value) : null });
  }

  protected setBranch(value: unknown) {
    this.navigate({ branch: value ? String(value) : null });
  }

  protected clearAll() {
    this.search.set('');
    this.navigate({ period: null, branch: null });
  }

  protected saleRowOf(rowId: string): SalesBookRow | null {
    return this.sales()?.rows.find((r) => r.id === rowId) ?? null;
  }

  protected saleMenuFor(row: SalesBookRow) {
    return [{ key: 'view', label: row.kind === 'CREDIT_NOTE' ? 'Ver nota' : 'Ver factura', icon: 'eye' as const }];
  }

  /** Opens the document of a row of the sales book. */
  protected openSaleRow(row: SalesBookRow) {
    void this.router.navigate([row.kind === 'CREDIT_NOTE' ? '/invoicing/notes' : '/invoicing/invoices', row.id]);
  }

  protected purchaseOf(rowId: string): PurchaseBookRow | null {
    return this.purchases()?.rows.find((r) => r.id === rowId) ?? null;
  }

  protected menuFor(entry: PurchaseBookRow) {
    return [{ key: 'verify', label: entry.status === 'OBSERVED' ? 'Verificar NIT' : 'Ver compra', icon: 'eye' as const }];
  }

  /** Opens the purchase (FS-38), where its NIT is verified. */
  protected openEntry(entry: PurchaseBookRow) {
    void this.router.navigate(['/invoicing/books/purchases', entry.id], { queryParams: { period: this.period() } });
  }

  protected openPeriods() {
    void this.router.navigate(['/invoicing/books/periods']);
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
