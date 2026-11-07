import { computed, DestroyRef, Directive, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, map, type Observable, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { DOCUMENTS_PAGE_SIZE, documentRangeLabel, type DocumentUrlFilters } from './quote-format';

export type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

type ListResult<R> = { data: R } | { error: ReturnType<typeof problemOf> };

const SEARCH_DEBOUNCE_MS = 300;

/**
 * What the quotes and the orders lists share: the filters kept in the URL, the debounced search, the paging
 * and the loading, empty, error and no-permission states.
 */
@Directive()
export abstract class DocumentListBase<
  S extends string,
  Item extends { id: string },
  Query,
  Response extends { items: Item[]; total: number },
> {
  private readonly route = inject(ActivatedRoute);
  protected readonly router = inject(Router);
  protected readonly destroyRef = inject(DestroyRef);

  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  /** Reads the status out of the URL; `null` when it is not a known one. */
  protected abstract parseStatus(raw: string | null): S | null;
  protected abstract toQuery(filters: DocumentUrlFilters<S>): Query;
  protected abstract fetchList(query: Query): Observable<Response>;
  /** Singular and plural of the document, for the range text. */
  protected abstract readonly documentNames: readonly [singular: string, plural: string];

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });
  protected readonly filters = computed<DocumentUrlFilters<S>>(() => {
    const q = this.queryParams();
    return { q: q.get('q') ?? '', status: this.parseStatus(q.get('status')), page: Math.max(1, Number(q.get('page')) || 1) };
  });

  protected readonly searchText = signal('');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<Response | null>(null);

  protected readonly items = computed<readonly Item[]>(() => this.data()?.items ?? []);
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / DOCUMENTS_PAGE_SIZE)));
  protected readonly rangeText = computed(() =>
    documentRangeLabel(this.filters().page, this.items().length, this.total(), this.documentNames[0], this.documentNames[1]),
  );
  protected readonly hasFilters = computed(() => !!(this.filters().status || this.filters().q) || this.searchText().trim() !== '');
  /** No document at all: the first-use empty state. */
  protected readonly showEmpty = computed(() => this.state() === 'ready' && this.total() === 0 && !this.hasFilters());
  protected readonly showNoResults = computed(() => this.state() === 'ready' && this.total() === 0 && this.hasFilters());

  private readonly params = computed(() => this.toQuery(this.filters()));

  constructor() {
    effect(() => this.searchText.set(this.filters().q));
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));

    toObservable(this.params)
      .pipe(
        tap(() => this.state.set('loading')),
        switchMap((params) => this.load(params)),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.show(result));
  }

  private load(params: Query): Observable<ListResult<Response>> {
    return this.fetchList(params).pipe(
      map((data) => ({ data })),
      catchError((err) => of({ error: problemOf(err) })),
    );
  }

  private show(result: ListResult<Response>) {
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

  protected onSearch(text: string) {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.navigate({ q: text.trim() || null, page: null }), SEARCH_DEBOUNCE_MS);
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
    this.load(this.params()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => this.show(result));
  }

  protected itemOf(rowId: string): Item | null {
    return this.items().find((i) => i.id === rowId) ?? null;
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
