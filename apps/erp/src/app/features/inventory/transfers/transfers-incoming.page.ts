import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { TransferListItem, TransferListResponse, TransferStatus } from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  PageHeaderComponent,
  PaginationComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { TransfersApi } from './transfers-api.service';
import { rangeLabel, toRow, TRANSFER_STATUS_PILLS, TRANSFERS_PAGE_SIZE, transferErrorMessage } from './transfers.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const INCOMING_STATUSES: readonly TransferStatus[] = ['IN_TRANSIT', 'PARTIALLY_RECEIVED'];
const STATUS_OPTIONS: SelectOption[] = INCOMING_STATUSES.map((value) => ({ value, label: TRANSFER_STATUS_PILLS[value].label }));

const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'N.º', type: 'custom', width: '7.5rem' },
  { key: 'route', label: 'Ruta', type: 'text' },
  { key: 'products', label: 'Ítems', type: 'number', width: '6.25rem' },
  { key: 'date', label: 'Enviada', type: 'number', width: '8.125rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '10rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '8rem' },
];

/** IN-24a · Transfers on their way to the user's branches: what is in transit and what was received in part. */
@Component({
  selector: 'rs-transfers-incoming-page',
  imports: [
    ButtonComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    PageHeaderComponent,
    PaginationComponent,
    RouterLink,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfers-incoming.page.html',
  styleUrl: './transfers-incoming.page.scss',
})
export class TransfersIncomingPage {
  private readonly api = inject(TransfersApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Transferencias', link: '/inventory/transfers' },
    { label: 'Por recibir' },
  ];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 4 }, (_, i) => i);
  protected readonly canView = computed(() => this.ctx.can('inventory.transfers.receive'));

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly filters = computed(() => {
    const q = this.queryParams();
    const status = q.get('status');
    return {
      q: q.get('q') ?? '',
      status: INCOMING_STATUSES.find((s) => s === status) ?? null,
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });

  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<TransferListResponse | null>(null);

  protected readonly items = computed<readonly TransferListItem[]>(() => this.data()?.items ?? []);
  protected readonly rows = computed(() => this.items().map(toRow));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / TRANSFERS_PAGE_SIZE)));
  protected readonly range = computed(() => rangeLabel(this.filters().page, this.items().length, this.total()));
  protected readonly hasFilters = computed(() => !!(this.filters().status || this.filters().q) || this.searchText().trim() !== '');
  protected readonly showEmpty = computed(() => this.state() === 'ready' && this.total() === 0 && !this.hasFilters());
  protected readonly showNoResults = computed(() => this.state() === 'ready' && this.total() === 0 && this.hasFilters());

  private readonly params = computed(() => ({
    q: this.filters().q || undefined,
    status: this.filters().status ?? undefined,
    page: this.filters().page,
    pageSize: TRANSFERS_PAGE_SIZE,
  }));

  constructor() {
    effect(() => this.searchText.set(this.filters().q));
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));

    toObservable(this.params)
      .pipe(
        tap(() => this.state.set(this.canView() ? 'loading' : 'forbidden')),
        switchMap((params) => {
          if (!this.canView()) return of(null);
          return this.api.incoming(params).pipe(
            map((data) => ({ data })),
            catchError((err) => of({ error: problemOf(err) })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (!result) return;
        if ('error' in result) {
          this.errorMessage.set(transferErrorMessage(result.error));
          this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
          return;
        }
        this.data.set(result.data);
        this.state.set('ready');
      });
  }

  protected itemOf(rowId: string): TransferListItem | null {
    return this.items().find((i) => i.id === rowId) ?? null;
  }

  protected setStatus(value: unknown) {
    this.navigate({ status: value ? String(value) : null, page: null });
  }

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null, page: null }), 300);
  }

  protected clearAll() {
    clearTimeout(this.searchTimer);
    this.navigate({ q: null, status: null, page: null });
  }

  protected goToPage(page: number) {
    if (page !== this.filters().page) this.navigate({ page: page > 1 ? String(page) : null });
  }

  protected retry() {
    this.state.set('loading');
    this.api
      .incoming(this.params())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.data.set(data);
          this.state.set('ready');
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.errorMessage.set(transferErrorMessage(problem));
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  protected receive(item: TransferListItem) {
    void this.router.navigate(['/inventory/transfers', item.id], { queryParams: { receive: 1 } });
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
