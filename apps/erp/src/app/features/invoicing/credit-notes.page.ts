import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CreditNoteListItem, CreditNoteListResponse } from '@rodasoft/domain';
import {
  DateRangePickerComponent,
  type DateRangeValue,
  DocTableCellDirective,
  type DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  KpiCardComponent,
  PageHeaderComponent,
  PaginationComponent,
  RowActionComponent,
  SelectComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
  ButtonComponent,
} from '@rodasoft/ui';
import { catchError, firstValueFrom, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../core/api-error';
import { ContextStore } from '../../core/context.store';
import { formatBs } from '../sales/cash/cash-format';
import {
  documentNumberLabel,
  NOTE_PAGE_SIZE,
  NOTE_STATUS_OPTIONS,
  type NoteUrlFilters,
  noteMenuFor,
  noteRangeLabel,
  parseNoteStatus,
  toNoteQuery,
  toNoteRow,
} from './credit-note-format';
import { saveBlob } from './file-download';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/** The columns of the Figma table of FS-23, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'N.º nota', type: 'custom', width: '8rem' },
  { key: 'customer', label: 'Cliente', type: 'text' },
  { key: 'invoice', label: 'Factura', type: 'text', width: '9rem' },
  { key: 'origin', label: 'Origen', type: 'text', width: '14rem' },
  { key: 'total', label: 'Total', type: 'number', width: '9rem' },
  { key: 'status', label: 'Estado SIAT', type: 'status', width: '14rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

/** FS-23 · Credit and debit notes (HU-FAC-11): the month's indicators, the filters, the list with its row menu, and the empty, loading, error and no-permission states. */
@Component({
  selector: 'rs-credit-notes-page',
  imports: [
    ButtonComponent,
    DateRangePickerComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    KpiCardComponent,
    PageHeaderComponent,
    PaginationComponent,
    RouterLink,
    RowActionComponent,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './credit-notes.page.html',
  styleUrl: './credit-notes.page.scss',
})
export class CreditNotesPage {
  private readonly api = inject(InvoicingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly context = inject(ContextStore);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Facturación SIAT' }, { label: 'Notas de crédito y débito' }];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = NOTE_STATUS_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly filters = computed<NoteUrlFilters>(() => {
    const q = this.queryParams();
    return {
      q: q.get('q') ?? '',
      status: parseNoteStatus(q.get('status')),
      from: q.get('from'),
      to: q.get('to'),
      branchId: q.get('branch'),
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });
  protected readonly range = computed<DateRangeValue>(() => ({ from: this.filters().from, to: this.filters().to }));
  protected readonly branchOptions = computed(() => this.context.branches().map((b) => ({ value: b.id, label: b.name })));

  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<CreditNoteListResponse | null>(null);

  protected readonly items = computed<readonly CreditNoteListItem[]>(() => this.data()?.items ?? []);
  protected readonly rows = computed(() => this.items().map(toNoteRow));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly kpis = computed(() => this.data()?.kpis ?? null);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / NOTE_PAGE_SIZE)));
  protected readonly rangeText = computed(() => noteRangeLabel(this.filters().page, this.items().length, this.total()));
  protected readonly totals = computed(() => ({
    number: 'Total',
    customer: `${this.total()} ${this.total() === 1 ? 'nota' : 'notas'}`,
    invoice: '',
    origin: '',
    total: formatBs(this.data()?.totalAmount ?? '0.00'),
    status: '',
  }));
  protected readonly issuedMonthText = computed(() => {
    const k = this.kpis();
    return k ? `${k.issuedThisMonth.count} · ${formatBs(k.issuedThisMonth.total)}` : '';
  });
  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.status || f.from || f.to || f.q || f.branchId) || this.searchText().trim() !== '';
  });
  protected readonly showEmpty = computed(() => this.state() === 'ready' && this.total() === 0 && !this.hasFilters());
  protected readonly showNoResults = computed(() => this.state() === 'ready' && this.total() === 0 && this.hasFilters());

  private readonly params = computed(() => toNoteQuery(this.filters()));

  constructor() {
    effect(() => this.searchText.set(this.filters().q));
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));
    toObservable(this.params)
      .pipe(
        tap(() => this.state.set('loading')),
        switchMap((params) =>
          this.api.notes(params).pipe(
            map((data) => ({ data })),
            catchError((err) => of({ error: problemOf(err) })),
          ),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.show(result));
  }

  private show(result: { data: CreditNoteListResponse } | { error: ReturnType<typeof problemOf> }) {
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
      .notes(this.params())
      .pipe(
        map((data) => ({ data })),
        catchError((err) => of({ error: problemOf(err) })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => this.show(result));
  }

  protected itemOf(rowId: string): CreditNoteListItem | null {
    return this.items().find((i) => i.id === rowId) ?? null;
  }

  protected menuFor(item: CreditNoteListItem) {
    return noteMenuFor(item);
  }

  protected menuLabel(item: CreditNoteListItem): string {
    return `Acciones de la nota ${documentNumberLabel(item.number)}`;
  }

  /** The chosen action of a row's ⋯ menu. */
  protected async onAction(item: CreditNoteListItem, key: string) {
    if (key === 'view') void this.router.navigate(['/invoicing/notes', item.id]);
    if (key === 'issue') await this.issue(item);
    if (key === 'void') await this.void(item);
    if (key === 'pdf') await this.download(item, 'pdf');
    if (key === 'xml') await this.download(item, 'xml');
  }

  private async issue(item: CreditNoteListItem) {
    try {
      await firstValueFrom(this.api.issueNote(item.id));
      this.toast.success('Nota enviada al SIAT');
      this.retry();
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    }
  }

  private async void(item: CreditNoteListItem) {
    try {
      await firstValueFrom(this.api.voidNote(item.id));
      this.toast.success('Nota anulada');
      this.retry();
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    }
  }

  private async download(item: CreditNoteListItem, format: 'pdf' | 'xml') {
    try {
      const blob = await firstValueFrom(format === 'pdf' ? this.api.notePdf(item.id) : this.api.noteXml(item.id));
      saveBlob(blob, `nota-credito-debito-${String(item.number ?? 0).padStart(6, '0')}.${format}`);
    } catch (err) {
      this.toast.danger(problemOf(err).message);
    }
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
