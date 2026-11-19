import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { type HomologationResponse, type HomologationRow, type HomologationStatus, isHomologationStatus } from '@rodasoft/domain';
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
  PaginationComponent,
  RowActionComponent,
  SelectComponent,
  type SelectOption,
  SkeletonComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { catchError, debounceTime, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../core/api-error';
import { formatDateTime } from '../sales/cash/cash-format';
import { toHomologationRow } from './fiscal-format';
import { HomologationImportDialog } from './homologation-import.dialog';
import { HomologationProductDialog } from './homologation-product.dialog';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const PAGE_SIZE = 10;
const STATUS_OPTIONS: SelectOption[] = [
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'DONE', label: 'Homologados' },
];
const COLUMNS: DocTableColumn[] = [
  { key: 'sku', label: 'Código', type: 'code', width: '10rem' },
  { key: 'product', label: 'Producto', type: 'text' },
  { key: 'sin', label: 'Código del SIN', type: 'text', width: '18rem' },
  { key: 'unit', label: 'Unidad de medida', type: 'code', width: '9rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '10rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

/**
 * FS-35 · Product homologation (HU-FAC-26): the SIN code of every product, with the progress, the pending ones first, a form to set
 * one code and the Excel import (preview, then apply all or nothing).
 */
@Component({
  selector: 'rs-homologation-page',
  imports: [
    ButtonComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    HomologationImportDialog,
    HomologationProductDialog,
    KpiCardComponent,
    NoteComponent,
    PageHeaderComponent,
    PaginationComponent,
    RowActionComponent,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './homologation.page.html',
  styleUrl: './homologation.page.scss',
})
export class HomologationPage {
  private readonly api = inject(InvoicingApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly columns = COLUMNS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);
  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Facturación SIAT' },
    { label: 'Configuración fiscal', link: '/invoicing/settings' },
    { label: 'Homologación' },
  ];

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<HomologationResponse | null>(null);
  protected readonly search = signal('');
  protected readonly status = signal<HomologationStatus | null>('PENDING');
  protected readonly page = signal(1);
  protected readonly importOpen = signal(false);
  protected readonly editing = signal<HomologationRow | null>(null);
  protected readonly editOpen = signal(false);
  private readonly reloadTick = signal(0);

  protected readonly rows = computed(() => (this.data()?.items ?? []).map(toHomologationRow));
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil((this.data()?.total ?? 0) / PAGE_SIZE)));
  protected readonly syncedText = computed(() => {
    const at = this.data()?.syncedAt;
    return at ? formatDateTime(at) : 'Sin sincronizar';
  });
  protected readonly isEmpty = computed(() => this.state() === 'ready' && this.rows().length === 0);
  protected readonly filtered = computed(() => this.search() !== '' || this.status() !== null);

  private readonly request = computed(() => ({ q: this.search().trim() || undefined, status: this.status() ?? undefined, page: this.page(), pageSize: PAGE_SIZE, tick: this.reloadTick() }));

  constructor() {
    toObservable(this.request)
      .pipe(
        debounceTime(200),
        tap(() => this.state.set('loading')),
        switchMap(({ tick: _tick, ...query }) =>
          this.api.homologation(query).pipe(
            catchError((err) => of({ error: problemOf(err) })),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((result) => {
        if ('error' in result) {
          this.errorMessage.set(result.error.message);
          this.state.set(result.error.status === 403 ? 'forbidden' : 'error');
          return;
        }
        this.data.set(result);
        this.state.set('ready');
      });
  }

  protected reload() {
    this.reloadTick.update((n) => n + 1);
  }

  protected setSearch(value: string) {
    this.search.set(value);
    this.page.set(1);
  }

  protected setStatus(value: unknown) {
    this.status.set(isHomologationStatus(value) ? value : null);
    this.page.set(1);
  }

  protected clearAll() {
    this.search.set('');
    this.status.set(null);
    this.page.set(1);
  }

  protected rowOf(id: string): HomologationRow | null {
    return this.data()?.items.find((item) => item.id === id) ?? null;
  }

  protected menuFor(row: HomologationRow) {
    return [{ key: 'edit', label: row.status === 'DONE' ? 'Cambiar código SIN' : 'Asignar código SIN', icon: 'edit' as const }];
  }

  protected edit(row: HomologationRow) {
    this.editing.set(row);
    this.editOpen.set(true);
  }
}
