import { ChangeDetectionStrategy, Component, computed, effect, inject, model, output, signal } from '@angular/core';
import {
  describeImportIssue,
  IMPORT_MAX_BYTES,
  type ImportCommitResponse,
  type ImportMode,
  type ImportPreviewResponse,
  type ImportPreviewRow,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  FileDropzoneComponent,
  FileItemComponent,
  FilterChipComponent,
  IconComponent,
  KpiCardComponent,
  ModalComponent,
  NoteComponent,
  PaginationComponent,
  RadioCardComponent,
  RadioCardGroupComponent,
  ToastService,
} from '@rodasoft/ui';
import type { Observable } from 'rxjs';
import { problemOf } from '../../../../core/api-error';
import { ProductsApi } from '../products-api.service';

type Step = 'upload' | 'preview';
type RowFilter = 'all' | 'error' | 'warning';

/** Rows per page of the preview table (design notes: lists of 100+ rows are paginated by 10). */
export const IMPORT_PREVIEW_PAGE_SIZE = 10;

const COLUMNS: readonly DocTableColumn[] = [
  { key: 'row', label: 'Fila', type: 'number', width: '4.5rem' },
  { key: 'code', label: 'Código', type: 'code' },
  { key: 'brand', label: 'Marca' },
  { key: 'status', label: 'Estado', type: 'status', width: '9rem' },
  { key: 'messages', label: 'Observaciones' },
];

const FILTERS: readonly { key: RowFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'error', label: 'Con error' },
  { key: 'warning', label: 'Con advertencia' },
];

const plural = (n: number) => (n === 1 ? 'producto' : 'productos');

/**
 * IN-21a / IN-21b · Import products from Excel. Step 1 takes the file and the mode; step 2 shows every row as valid or
 * with an error before anything is written. Only the valid rows are imported; the error report lists the rest.
 */
@Component({
  selector: 'rs-import-products-dialog',
  imports: [
    ButtonComponent,
    DocTableComponent,
    FileDropzoneComponent,
    FileItemComponent,
    FilterChipComponent,
    IconComponent,
    KpiCardComponent,
    ModalComponent,
    NoteComponent,
    PaginationComponent,
    RadioCardComponent,
    RadioCardGroupComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './import-products.dialog.html',
  styleUrl: './import-products.dialog.scss',
})
export class ImportProductsDialog {
  private readonly api = inject(ProductsApi);
  private readonly toast = inject(ToastService);

  readonly open = model(false);
  /** Emits after a successful import, so the list reloads. */
  readonly imported = output<ImportCommitResponse>();

  protected readonly columns = COLUMNS;
  protected readonly filters = FILTERS;

  protected readonly step = signal<Step>('upload');
  protected readonly file = signal<File | null>(null);
  protected readonly mode = signal<ImportMode>('create_only');
  protected readonly fileError = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly committing = signal(false);
  protected readonly downloading = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly preview = signal<ImportPreviewResponse | null>(null);
  protected readonly filter = signal<RowFilter>('all');
  protected readonly page = signal(1);

  protected readonly busy = computed(() => this.loading() || this.committing());
  protected readonly summary = computed(() => this.preview()?.summary ?? null);

  private readonly filteredRows = computed<ImportPreviewRow[]>(() => {
    const rows = this.preview()?.rows ?? [];
    switch (this.filter()) {
      case 'error':
        return rows.filter((r) => r.status === 'error');
      case 'warning':
        return rows.filter((r) => r.warnings.length > 0);
      default:
        return [...rows];
    }
  });
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.filteredRows().length / IMPORT_PREVIEW_PAGE_SIZE)));
  protected readonly tableRows = computed<DocTableRow[]>(() => {
    const start = (this.page() - 1) * IMPORT_PREVIEW_PAGE_SIZE;
    return this.filteredRows()
      .slice(start, start + IMPORT_PREVIEW_PAGE_SIZE)
      .map((r) => ({
        id: String(r.rowNumber),
        cells: {
          row: r.rowNumber,
          code: r.code || '—',
          brand: r.brand || '—',
          status:
            r.status === 'error'
              ? { label: 'Error', status: 'danger' as const, icon: 'alert' as const }
              : r.warnings.length
                ? { label: 'Advertencia', status: 'warning' as const }
                : { label: 'Válida', status: 'success' as const },
          messages: [...r.errors, ...r.warnings].map(describeImportIssue).join(' · '),
        },
      }));
  });
  protected readonly rangeLabel = computed(() => {
    const total = this.filteredRows().length;
    if (!total) return '';
    const from = (this.page() - 1) * IMPORT_PREVIEW_PAGE_SIZE + 1;
    return `Mostrando ${from}–${Math.min(total, from + IMPORT_PREVIEW_PAGE_SIZE - 1)} de ${total}`;
  });
  protected readonly confirmLabel = computed(() => {
    const valid = this.summary()?.valid ?? 0;
    return `Importar ${valid} ${plural(valid)}`;
  });
  protected readonly stockLine = computed(() => {
    const s = this.summary();
    return s && s.pieces > 0 ? `${s.pieces} piezas de stock · Bs ${s.value}` : '';
  });
  protected readonly unknownColumns = computed(() => this.preview()?.unknownColumns.join(', ') ?? '');

  constructor() {
    // opening starts again from step 1
    effect(() => {
      if (!this.open()) return;
      this.step.set('upload');
      this.file.set(null);
      this.mode.set('create_only');
      this.fileError.set(null);
      this.submitError.set(null);
      this.preview.set(null);
      this.filter.set('all');
      this.page.set(1);
      this.loading.set(false);
      this.committing.set(false);
    });
  }

  protected fileDetail(file: File): string {
    return `${(file.size / 1024).toFixed(file.size < 10 * 1024 ? 1 : 0)} KB`;
  }

  protected onFiles(files: File[]) {
    const picked = files[0];
    this.submitError.set(null);
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith('.xlsx')) {
      this.fileError.set('Solo se aceptan archivos Excel (.xlsx).');
      return;
    }
    if (picked.size > IMPORT_MAX_BYTES) {
      this.fileError.set('El archivo supera el límite de 5 MB.');
      return;
    }
    this.fileError.set(null);
    this.file.set(picked);
  }

  protected removeFile() {
    this.file.set(null);
    this.fileError.set(null);
  }

  protected setMode(mode: unknown) {
    this.mode.set(mode === 'create_or_update' ? 'create_or_update' : 'create_only');
  }

  protected setFilter(filter: RowFilter) {
    this.filter.set(filter);
    this.page.set(1);
  }

  protected downloadTemplate() {
    this.download(this.api.importTemplate(), 'plantilla-productos.xlsx', 'No pudimos descargar la plantilla.');
  }

  protected downloadErrors() {
    const file = this.file();
    if (file) this.download(this.api.importErrorReport(file, this.mode()), 'errores-importacion.xlsx', 'No pudimos generar el reporte de errores.');
  }

  protected review() {
    const file = this.file();
    if (!file || this.busy()) return;
    this.loading.set(true);
    this.submitError.set(null);
    this.api.importPreview(file, this.mode()).subscribe({
      next: (preview) => {
        this.loading.set(false);
        this.preview.set(preview);
        this.filter.set('all');
        this.page.set(1);
        this.step.set('preview');
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.submitError.set(this.messageOf(err));
      },
    });
  }

  protected back() {
    if (this.committing()) return;
    this.step.set('upload');
    this.submitError.set(null);
  }

  protected confirm() {
    const file = this.file();
    if (!file || this.busy() || !(this.summary()?.valid ?? 0)) return;
    this.committing.set(true);
    this.submitError.set(null);
    this.api.importCommit(file, this.mode()).subscribe({
      next: (result) => {
        this.committing.set(false);
        const done = result.created + result.updated;
        this.toast.success(`${done} ${plural(done)} ${done === 1 ? 'importado' : 'importados'} (${result.skipped} ${result.skipped === 1 ? 'omitido' : 'omitidos'})`);
        this.open.set(false);
        this.imported.emit(result);
      },
      error: (err: unknown) => {
        this.committing.set(false);
        this.submitError.set(this.messageOf(err));
      },
    });
  }

  protected cancel() {
    if (!this.busy()) this.open.set(false);
  }

  /** The adjustments permission is the one a user can be missing when the file has stock columns. */
  private messageOf(err: unknown): string {
    const problem = problemOf(err);
    if (problem.code === 'NO_PERMISSION') {
      return 'Para importar stock necesitas el permiso de ajustes de inventario. Quita las columnas de stock o pide acceso.';
    }
    if (problem.code === 'IMPORT_INVALID_TEMPLATE') {
      const missing = (problem.details as { missing?: string[] } | undefined)?.missing;
      if (missing?.length) return `Faltan columnas obligatorias: ${missing.join(', ')}. Descarga la plantilla y vuelve a intentar.`;
    }
    if (problem.code === 'IMPORT_TOO_MANY_ROWS') {
      const max = (problem.details as { max?: number } | undefined)?.max;
      if (max) return `El archivo tiene más de ${max} filas. Divídelo en partes más pequeñas.`;
    }
    return problem.message;
  }

  private download(source: Observable<Blob>, name: string, failure: string) {
    if (this.downloading()) return;
    this.downloading.set(true);
    source.subscribe({
      next: (blob) => {
        this.downloading.set(false);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
      },
      error: () => {
        this.downloading.set(false);
        this.toast.danger(failure);
      },
    });
  }
}
