import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import type { PointOfSaleListItem, PointOfSaleListResponse } from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableCellDirective,
  LinkComponent,
  type DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  KpiCardComponent,
  NoteComponent,
  PageHeaderComponent,
  RowActionComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { toPointOfSaleRow } from './fiscal-format';
import { InvoicingApi } from './invoicing-api.service';
import { PointOfSaleDialog } from './point-of-sale.dialog';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'PV', type: 'code', width: '5rem' },
  { key: 'branch', label: 'Sucursal', type: 'text', width: '14rem' },
  { key: 'point', label: 'Punto de venta', type: 'text' },
  { key: 'register', label: 'Caja', type: 'text', width: '12rem' },
  { key: 'lastInvoice', label: 'Última factura', type: 'code', width: '10rem' },
  { key: 'cuis', label: 'CUIS', type: 'status', width: '9rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '9rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

/**
 * FS-32 · Points of sale (HU-FAC-24): branch, SIN code, cash register, last invoice and CUIS of each point, the indicators, and the
 * form (FS-33) that registers a new one in the SIAT. A point that issued invoices is deactivated, never deleted.
 */
@Component({
  selector: 'rs-points-of-sale-page',
  imports: [
    ButtonComponent,
    LinkComponent,
    RouterLink,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    PointOfSaleDialog,
    RowActionComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './points-of-sale.page.html',
  styleUrl: './points-of-sale.page.scss',
})
export class PointsOfSalePage {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly columns = COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 4 }, (_, i) => i);
  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Facturación SIAT' },
    { label: 'Configuración fiscal', link: '/invoicing/settings' },
    { label: 'Puntos de venta' },
  ];

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<PointOfSaleListResponse | null>(null);
  protected readonly search = signal('');
  protected readonly dialogOpen = signal(false);

  private readonly term = computed(() => this.search().trim().toLowerCase());
  protected readonly filtered = computed(() =>
    (this.data()?.items ?? []).filter((item) => this.term() === '' || `${item.branchName} ${item.name} ${item.code} ${item.registerName ?? ''}`.toLowerCase().includes(this.term())),
  );
  protected readonly totals = computed(() => ({ code: 'Total', branch: `${this.data()?.items.length ?? 0} ${(this.data()?.items.length ?? 0) === 1 ? 'punto de venta' : 'puntos de venta'}` }));
  protected readonly rows = computed(() => this.filtered().map(toPointOfSaleRow));
  protected readonly isEmpty = computed(() => this.state() === 'ready' && (this.data()?.items.length ?? 0) === 0);
  protected readonly noResults = computed(() => this.state() === 'ready' && !this.isEmpty() && this.rows().length === 0);

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .pointsOfSale()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.data.set(data);
          this.state.set('ready');
        },
        error: (err) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  protected pointOf(id: string): PointOfSaleListItem | null {
    return this.data()?.items.find((item) => item.id === id) ?? null;
  }

  protected menuFor(point: PointOfSaleListItem) {
    return point.status === 'ACTIVE' ? [{ key: 'deactivate', label: 'Desactivar punto', icon: 'close' as const, danger: true }] : [];
  }

  protected deactivate(point: PointOfSaleListItem) {
    this.api
      .deactivatePointOfSale(point.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success(`Punto de venta ${point.name} desactivado`);
          this.load();
        },
        error: (err) => this.toast.danger(problemOf(err).message),
      });
  }

  protected clearSearch() {
    this.search.set('');
  }
}
