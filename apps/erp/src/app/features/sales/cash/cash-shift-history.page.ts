import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { CashShiftDisplayStatus, CashShiftListQuery, CashShiftListResponse, CashShiftListRow } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  type DateRangeValue,
  DateRangePickerComponent,
  type DocTableCell,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  type DocTableRow,
  EmptyStateIllustratedComponent,
  KpiCardComponent,
  PageHeaderComponent,
  PaginationComponent,
  RowActionComponent,
  type RowMenuItem,
  SelectComponent,
  type SelectOption,
  SkeletonComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { catchError, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { CashApi } from './cash-api.service';
import { formatBs, formatScheduleShort, formatSignedBs, parseShiftStatus, SHIFT_STATUS_OPTIONS, SHIFT_STATUS_PILLS } from './cash-format';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

export const SHIFT_HISTORY_PAGE_SIZE = 20;

interface HistoryFilters {
  from: string | null;
  to: string | null;
  cashierId: string | null;
  status: CashShiftDisplayStatus | null;
  page: number;
}

/** The columns of the Figma table of VP-23, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'Turno', type: 'custom', width: '7rem' },
  { key: 'cashier', label: 'Cajero · caja', type: 'text' },
  { key: 'schedule', label: 'Horario', type: 'text', width: '15rem' },
  { key: 'sales', label: 'Ventas', type: 'number', width: '9rem' },
  { key: 'difference', label: 'Diferencia', type: 'number', width: '9rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '12rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const parseDay = (raw: string | null): string | null => (raw !== null && DAY.test(raw) ? raw : null);

/**
 * VP-23 · Historial de turnos (HU-VEN-25). Openings and closings with their sales, difference and review status. Who reviews
 * differences sees every cashier's shifts and reaches the closings waiting for review from here (there is no approvals inbox
 * until HU-VEN-29); a cashier sees only their own. The filters live in the URL, so coming back from a review keeps them.
 */
@Component({
  selector: 'rs-cash-shift-history-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DateRangePickerComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
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
  templateUrl: './cash-shift-history.page.html',
  styleUrl: './cash-shift-history.page.scss',
})
export class CashShiftHistoryPage {
  private readonly api = inject(CashApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Historial de turnos' },
  ];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = SHIFT_STATUS_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);

  private readonly queryParams = toSignal(this.route.queryParamMap, { requireSync: true });

  protected readonly filters = computed<HistoryFilters>(() => {
    const q = this.queryParams();
    return {
      from: parseDay(q.get('from')),
      to: parseDay(q.get('to')),
      cashierId: q.get('cashierId'),
      status: parseShiftStatus(q.get('status')),
      page: Math.max(1, Number(q.get('page')) || 1),
    };
  });
  protected readonly range = computed<DateRangeValue>(() => ({ from: this.filters().from, to: this.filters().to }));

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<CashShiftListResponse | null>(null);

  protected readonly items = computed<readonly CashShiftListRow[]>(() => this.data()?.items ?? []);
  protected readonly canReview = computed(() => this.data()?.canReview ?? false);
  protected readonly cashierOptions = computed<SelectOption[]>(() => (this.data()?.cashiers ?? []).map((c) => ({ value: c.id, label: c.name })));
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / SHIFT_HISTORY_PAGE_SIZE)));

  protected readonly kpis = computed(() => {
    const month = this.data()?.month;
    return {
      shifts: String(month?.shifts ?? 0),
      withDifference: String(month?.withDifference ?? 0),
      pendingReview: String(month?.pendingReview ?? 0),
      accumulated: formatSignedBs(month?.accumulatedDifference ?? '0'),
    };
  });

  protected readonly rows = computed<DocTableRow[]>(() =>
    this.items().map((item) => ({
      id: item.id,
      label: item.number,
      cells: {
        number: item.number,
        cashier: `${item.cashier.name} · ${item.register.name}`,
        schedule: formatScheduleShort(item.openedAt, item.closedAt),
        sales: formatBs(item.sales.total),
        difference: formatSignedBs(item.difference),
        status: SHIFT_STATUS_PILLS[item.displayStatus],
        actions: null,
      },
    })),
  );

  /** The total row: every shift the filters match, not only this page. */
  protected readonly totals = computed<Record<string, DocTableCell>>(() => {
    const totals = this.data()?.totals;
    const shifts = totals?.shifts ?? 0;
    return {
      number: 'Total',
      cashier: `${shifts} ${shifts === 1 ? 'turno' : 'turnos'}`,
      schedule: '',
      sales: formatBs(totals?.salesTotal ?? '0'),
      difference: formatSignedBs(totals?.difference ?? '0'),
      status: '',
      actions: '',
    };
  });

  protected readonly rangeText = computed(() => {
    const total = this.total();
    if (!total) return '';
    const from = (this.filters().page - 1) * SHIFT_HISTORY_PAGE_SIZE + 1;
    const to = Math.min(total, from + this.items().length - 1);
    return `${from}–${to} de ${total} ${total === 1 ? 'turno' : 'turnos'}`;
  });

  protected readonly hasFilters = computed(() => {
    const f = this.filters();
    return !!(f.from || f.to || f.cashierId || f.status);
  });
  protected readonly showEmpty = computed(() => this.state() === 'ready' && this.total() === 0 && !this.hasFilters());
  protected readonly showNoResults = computed(() => this.state() === 'ready' && this.total() === 0 && this.hasFilters());

  private readonly params = computed<CashShiftListQuery>(() => {
    const f = this.filters();
    return {
      from: f.from ?? undefined,
      to: f.to ?? undefined,
      cashierId: f.cashierId ?? undefined,
      status: f.status ?? undefined,
      page: f.page,
      pageSize: SHIFT_HISTORY_PAGE_SIZE,
    };
  });

  constructor() {
    toObservable(this.params)
      .pipe(
        tap(() => this.state.set('loading')),
        switchMap((params) => this.fetch(params)),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.show(result));
  }

  private fetch(params: CashShiftListQuery) {
    return this.api.shifts(params).pipe(
      map((data) => ({ data })),
      catchError((err: unknown) => of({ error: problemOf(err) })),
    );
  }

  private show(result: { data: CashShiftListResponse } | { error: ReturnType<typeof problemOf> }) {
    if ('error' in result) {
      this.errorMessage.set(result.error.message);
      this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
      return;
    }
    this.data.set(result.data);
    this.state.set('ready');
  }

  protected itemOf(id: string): CashShiftListRow | undefined {
    return this.items().find((item) => item.id === id);
  }

  /** A closing waiting for review is reviewed by who may; every other closed shift is only read. An open shift has no closing yet. */
  protected menuFor(item: CashShiftListRow): RowMenuItem[] {
    if (item.status === 'OPEN') return [];
    const review = this.canReview() && item.displayStatus === 'PENDING_REVIEW';
    return [{ key: 'review', label: review ? 'Revisar cierre' : 'Ver cierre', icon: 'eye' }];
  }

  protected openReview(item: CashShiftListRow) {
    void this.router.navigate(['/sales/cash-register/shifts', item.id, 'review']);
  }

  protected setRange(range: DateRangeValue) {
    this.navigate({ from: range.from, to: range.to, page: null });
  }

  protected setFilter(key: 'cashierId' | 'status', value: unknown) {
    this.navigate({ [key]: value ? String(value) : null, page: null });
  }

  protected clearAll() {
    this.navigate({ from: null, to: null, cashierId: null, status: null, page: null });
  }

  protected goToPage(page: number) {
    if (page !== this.filters().page) this.navigate({ page: page > 1 ? String(page) : null });
  }

  protected retry() {
    this.state.set('loading');
    this.fetch(this.params()).subscribe((result) => this.show(result));
  }

  private navigate(queryParams: Record<string, string | null>) {
    void this.router.navigate([], { relativeTo: this.route, queryParams, queryParamsHandling: 'merge' });
  }
}
