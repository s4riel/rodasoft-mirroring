import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal } from '@angular/core';
import { TRANSFER_FILE_MAX_BYTES, type TransferLineGroup, type TransferResolveResponse } from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  DocTableStatus,
  FileDropzoneComponent,
  FileItemComponent,
  IconComponent,
  KpiCardComponent,
  ModalComponent,
  NoteComponent,
  TextareaDirective,
} from '@rodasoft/ui';
import type { Observable } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { type AddableProduct, recognizedLines } from './transfer-lines';
import { TransfersApi } from './transfers-api.service';
import { PASTE_ERROR_LABELS, transferErrorMessage } from './transfers.mapper';

type Step = 'input' | 'preview';

/** How the list is given: typed into the box (IN-06b) or uploaded as a file (IN-06c). */
export type TransferListMode = 'paste' | 'file';

/** What "Agregar" hands back: the products that were recognized with enough stock, with the quantity asked for. */
export interface TransferListAddition {
  product: AddableProduct;
  quantity: number;
}

const COLUMNS: readonly DocTableColumn[] = [
  { key: 'line', label: 'Línea', type: 'number', width: '4.5rem' },
  { key: 'code', label: 'Código', type: 'code' },
  { key: 'product', label: 'Producto', type: 'text' },
  { key: 'quantity', label: 'Cantidad', type: 'number' },
  { key: 'available', label: 'Stock en origen', type: 'number' },
  { key: 'status', label: 'Resultado', type: 'status', width: '12rem' },
];

const GROUP_PILLS: Record<TransferLineGroup, DocTableStatus> = {
  RECOGNIZED: { label: 'Reconocido', status: 'success' },
  INSUFFICIENT_STOCK: { label: 'Sin stock suficiente', status: 'warning' },
  NOT_FOUND: { label: 'No encontrado', status: 'danger', icon: 'alert' },
  INACTIVE: { label: 'Producto inactivo', status: 'idle' },
};

const plural = (n: number) => (n === 1 ? 'producto' : 'productos');

/**
 * IN-06b / IN-06c · Paste a `code, quantity` list or upload an Excel/CSV. The list is read first and shown as recognized,
 * without enough stock, not found or inactive; only the recognized lines are added. Nothing is saved here.
 */
@Component({
  selector: 'rs-transfer-list-dialog',
  imports: [
    ButtonComponent,
    DocTableComponent,
    FileDropzoneComponent,
    FileItemComponent,
    IconComponent,
    KpiCardComponent,
    ModalComponent,
    NoteComponent,
    TextareaDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfer-list.dialog.html',
  styleUrl: './transfer-list.dialog.scss',
})
export class TransferListDialog {
  private readonly api = inject(TransfersApi);

  readonly open = model(false);
  readonly mode = input<TransferListMode>('paste');
  /** The origin warehouse: the stock of every line is checked against it. */
  readonly warehouseId = input.required<string>();
  readonly added = output<TransferListAddition[]>();

  protected readonly columns = COLUMNS;
  protected readonly step = signal<Step>('input');
  protected readonly text = signal('');
  protected readonly file = signal<File | null>(null);
  protected readonly fileError = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly result = signal<TransferResolveResponse | null>(null);

  protected readonly heading = computed(() =>
    this.step() === 'preview' ? 'Revisa la lista' : this.mode() === 'paste' ? 'Pegar lista' : 'Importar Excel',
  );
  protected readonly canReview = computed(() => (this.mode() === 'paste' ? this.text().trim() !== '' : this.file() !== null));
  protected readonly additions = computed(() => recognizedLines(this.result()?.lines ?? []));
  protected readonly addLabel = computed(() => {
    const n = this.additions().length;
    return `Agregar ${n} ${plural(n)}`;
  });
  protected readonly pasteErrors = computed(() =>
    (this.result()?.errors ?? []).map((e) => `Línea ${e.line}: ${PASTE_ERROR_LABELS[e.reason]}`),
  );

  protected readonly rows = computed<DocTableRow[]>(() =>
    (this.result()?.lines ?? []).map((l) => ({
      id: String(l.line),
      cells: {
        line: l.line,
        code: l.code,
        product: l.product ? `${l.product.name} · ${l.product.brand}` : '—',
        quantity: l.quantity,
        available: l.available,
        status: GROUP_PILLS[l.group],
      },
    })),
  );

  constructor() {
    // opening starts again from the first step, with nothing left over from the last time
    effect(() => {
      if (!this.open()) return;
      this.step.set('input');
      this.text.set('');
      this.file.set(null);
      this.fileError.set(null);
      this.submitError.set(null);
      this.result.set(null);
      this.loading.set(false);
    });
  }

  protected onText(event: Event) {
    this.text.set((event.target as HTMLTextAreaElement).value);
    this.submitError.set(null);
  }

  protected fileDetail(file: File): string {
    return `${(file.size / 1024).toFixed(file.size < 10 * 1024 ? 1 : 0)} KB`;
  }

  protected onFiles(files: File[]) {
    const picked = files[0];
    this.submitError.set(null);
    if (!picked) return;
    if (!/\.(xlsx|csv)$/i.test(picked.name)) {
      this.fileError.set('Solo se aceptan archivos .xlsx o .csv.');
      return;
    }
    if (picked.size > TRANSFER_FILE_MAX_BYTES) {
      this.fileError.set('El archivo supera el límite de 1 MB.');
      return;
    }
    this.fileError.set(null);
    this.file.set(picked);
  }

  protected removeFile() {
    this.file.set(null);
    this.fileError.set(null);
  }

  protected review() {
    if (!this.canReview() || this.loading()) return;
    const file = this.file();
    const request: Observable<TransferResolveResponse> =
      this.mode() === 'file' && file ? this.api.resolveFile(this.warehouseId(), file) : this.api.resolveText(this.warehouseId(), this.text());
    this.loading.set(true);
    this.submitError.set(null);
    request.subscribe({
      next: (result) => {
        this.loading.set(false);
        this.result.set(result);
        this.step.set('preview');
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.submitError.set(transferErrorMessage(problemOf(err)));
      },
    });
  }

  protected back() {
    this.step.set('input');
    this.submitError.set(null);
  }

  protected add() {
    const additions = this.additions();
    if (!additions.length) return;
    this.added.emit(additions);
    this.open.set(false);
  }

  protected cancel() {
    if (!this.loading()) this.open.set(false);
  }
}
