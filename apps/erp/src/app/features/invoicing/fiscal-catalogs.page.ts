import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { type CatalogEntriesResponse, type CatalogEntryRow, type CatalogSummary, SIAT_CATALOG_LABELS, type SiatCatalogKind } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableCellDirective,
  type DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FieldComponent,
  FilterBarProductsComponent,
  NoteComponent,
  PageHeaderComponent,
  PaginationComponent,
  SelectComponent,
  type SelectOption,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { formatDateTime } from '../sales/cash/cash-format';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const SUMMARY_COLUMNS: DocTableColumn[] = [
  { key: 'catalog', label: 'Catálogo', type: 'text' },
  { key: 'entries', label: 'Registros', type: 'number', width: '9rem' },
  { key: 'syncedAt', label: 'Última sincronización', type: 'text', width: '14rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '10rem' },
  { key: 'view', label: '', type: 'custom', align: 'end', width: '7rem' },
];
const ENTRY_COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code', width: '9rem' },
  { key: 'description', label: 'Descripción', type: 'text' },
  { key: 'activity', label: 'Actividad', type: 'code', width: '9rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '9rem' },
];
const ACTIVITY_COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code', width: '12rem' },
  { key: 'description', label: 'Actividad económica', type: 'text' },
  { key: 'kind', label: 'Tipo', type: 'text', width: '12rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '9rem' },
];
const LEGEND_COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code', width: '12rem' },
  { key: 'description', label: 'Leyenda', type: 'text' },
  { key: 'use', label: 'Uso', type: 'text', width: '16rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '9rem' },
];
const PAGE_SIZE = 10;

/**
 * FS-34 · SIN catalogues (HU-FAC-25): which tables were synced and when, "Sincronizar ahora", the rows of each one, and the choice of
 * the main economic activity and the default product code that the invoices use. Syncing replaces the rows; offline it keeps the old ones.
 */
@Component({
  selector: 'rs-fiscal-catalogs-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    FilterBarProductsComponent,
    NoteComponent,
    PageHeaderComponent,
    PaginationComponent,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './fiscal-catalogs.page.html',
  styleUrl: './fiscal-catalogs.page.scss',
})
export class FiscalCatalogsPage {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly summaryColumns = SUMMARY_COLUMNS;
  protected readonly entryColumns = ENTRY_COLUMNS;
  protected readonly activityColumns = ACTIVITY_COLUMNS;
  protected readonly legendColumns = LEGEND_COLUMNS;
  protected readonly skeletonRows = Array.from({ length: 5 }, (_, i) => i);
  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Facturación SIAT' },
    { label: 'Configuración fiscal', link: '/invoicing/settings' },
    { label: 'Catálogos del SIN' },
  ];

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly summary = signal<CatalogSummary | null>(null);
  protected readonly syncing = signal(false);
  protected readonly syncError = signal<string | null>(null);

  protected readonly selected = signal<SiatCatalogKind | null>(null);
  protected readonly entries = signal<CatalogEntriesResponse | null>(null);
  protected readonly entriesLoading = signal(false);
  protected readonly search = signal('');
  protected readonly page = signal(1);

  protected readonly activities = signal<SelectOption[]>([]);
  protected readonly products = signal<SelectOption[]>([]);
  protected readonly activityCode = signal<string | null>(null);
  protected readonly defaultProductCode = signal<string | null>(null);
  protected readonly activityError = signal<string | null>(null);
  protected readonly savingActivity = signal(false);
  protected readonly activityList = signal<CatalogEntryRow[]>([]);
  protected readonly legendList = signal<CatalogEntryRow[]>([]);

  protected readonly summaryRows = computed(() =>
    (this.summary()?.catalogs ?? []).map((row) => ({
      id: row.catalog,
      label: SIAT_CATALOG_LABELS[row.catalog],
      cells: {
        catalog: SIAT_CATALOG_LABELS[row.catalog],
        entries: row.entries,
        syncedAt: row.syncedAt ? formatDateTime(row.syncedAt) : 'Nunca',
        status: row.syncedAt ? { label: 'Sincronizado', status: 'success' as const, icon: 'check' as const } : { label: 'Pendiente', status: 'warning' as const, icon: 'alert' as const },
      },
    })),
  );
  /** The two tables of the Figma screen: the economic activities (the chosen one is the main) and the invoice legends. */
  protected readonly activityRows = computed(() =>
    this.activityList().map((item) => ({
      id: item.code,
      label: item.code,
      cells: {
        code: item.code,
        description: item.description,
        kind: item.code === this.activityCode() ? 'Principal' : 'Secundaria',
        status: item.active ? { label: 'Activa', status: 'success' as const, icon: 'check' as const } : { label: 'Inactiva', status: 'idle' as const },
      },
    })),
  );
  protected readonly legendRows = computed(() =>
    this.legendList().map((item) => ({
      id: `${item.activityCode}|${item.code}`,
      label: item.code,
      cells: {
        code: item.code,
        description: item.description,
        use: 'Se rota en cada factura',
        status: item.active ? { label: 'Activa', status: 'success' as const, icon: 'check' as const } : { label: 'Inactiva', status: 'idle' as const },
      },
    })),
  );
  protected readonly activityTotals = computed(() => ({ code: 'Total', description: `${this.activityList().length} ${this.activityList().length === 1 ? 'actividad' : 'actividades'}` }));
  protected readonly legendTotals = computed(() => ({ code: 'Total', description: `${this.legendList().length} ${this.legendList().length === 1 ? 'leyenda' : 'leyendas'}` }));
  protected readonly entryRows = computed(() =>
    (this.entries()?.items ?? []).map((item) => ({
      id: `${item.activityCode}|${item.code}`,
      label: item.code,
      cells: {
        code: item.code,
        description: item.description,
        activity: item.activityCode || '—',
        status: item.active ? { label: 'Vigente', status: 'success' as const } : { label: 'Inactivo', status: 'idle' as const },
      },
    })),
  );
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil((this.entries()?.total ?? 0) / PAGE_SIZE)));
  protected readonly selectedName = computed(() => (this.selected() ? SIAT_CATALOG_LABELS[this.selected() as SiatCatalogKind] : ''));
  protected readonly syncedText = computed(() => {
    const at = this.summary()?.syncedAt;
    return at ? `Sincronizado el ${formatDateTime(at)}` : 'Todavía no se sincronizó todo';
  });

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .catalogSummary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          this.summary.set(summary);
          this.state.set('ready');
          if (summary.synced) this.loadChoices();
        },
        error: (err) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  private loadChoices() {
    this.api
      .catalogEntries('ACTIVITY', { pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => {
        this.activityList.set(response.items);
        this.activities.set(response.items.filter((i) => i.active).map((i) => ({ value: i.code, label: `${i.code} · ${i.description}` })));
      });
    this.api
      .catalogEntries('LEGEND', { pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => this.legendList.set(response.items));
    this.api
      .catalogEntries('PRODUCT_SERVICE', { pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((response) => this.products.set(response.items.filter((i) => i.active).map((i) => ({ value: i.code, label: `${i.code} · ${i.description}` }))));
    this.api
      .fiscalSettings()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (settings) => {
          this.activityCode.set(settings.activity.mainActivityCode);
          this.defaultProductCode.set(settings.activity.defaultProductCode);
        },
        error: () => undefined,
      });
  }

  protected sync() {
    if (this.syncing()) return;
    this.syncing.set(true);
    this.syncError.set(null);
    this.api
      .syncCatalogs()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          this.syncing.set(false);
          this.summary.set(summary);
          this.toast.success('Catálogos sincronizados con el SIN');
          this.loadChoices();
          if (this.selected()) this.fetchEntries();
        },
        error: (err) => {
          this.syncing.set(false);
          this.syncError.set(problemOf(err).message);
        },
      });
  }

  protected view(catalog: string) {
    this.selected.set(catalog as SiatCatalogKind);
    this.search.set('');
    this.page.set(1);
    this.fetchEntries();
  }

  protected fetchEntries() {
    const catalog = this.selected();
    if (!catalog) return;
    this.entriesLoading.set(true);
    this.api
      .catalogEntries(catalog, { q: this.search().trim() || undefined, page: this.page(), pageSize: PAGE_SIZE })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.entries.set(response);
          this.entriesLoading.set(false);
        },
        error: (err) => {
          this.entriesLoading.set(false);
          this.toast.danger(problemOf(err).message);
        },
      });
  }

  protected setSearch(value: string) {
    this.search.set(value);
    this.page.set(1);
    this.fetchEntries();
  }

  protected setPage(page: number) {
    this.page.set(page);
    this.fetchEntries();
  }

  protected saveActivity() {
    const mainActivityCode = this.activityCode();
    if (!mainActivityCode || this.savingActivity()) return;
    this.savingActivity.set(true);
    this.activityError.set(null);
    this.api
      .saveActivity({ mainActivityCode, defaultProductCode: this.defaultProductCode() ?? '' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.savingActivity.set(false);
          this.toast.success('Actividad económica guardada');
        },
        error: (err) => {
          this.savingActivity.set(false);
          this.activityError.set(problemOf(err).message);
        },
      });
  }
}
