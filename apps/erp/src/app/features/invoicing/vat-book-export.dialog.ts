import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isDraftPeriod, VAT_BOOKS, type VatBook, type VatBookExportFormat, vatBookFileName } from '@rodasoft/domain';
import { ButtonComponent, FieldComponent, ModalComponent, NoteComponent, SelectComponent, type SelectOption, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { saveBlob } from './file-download';
import { InvoicingApi } from './invoicing-api.service';

const BOOK_OPTIONS: SelectOption[] = [
  { value: 'SALES', label: 'Libro de ventas' },
  { value: 'PURCHASES', label: 'Libro de compras' },
];
const FORMAT_LABELS: Record<VatBookExportFormat, string> = { XLSX: 'Excel (.xlsx)', CSV: 'CSV (.csv)' };

/**
 * FS-39 · Exportar libro (HU-FAC-20): the book, the period and the file format. A period whose month has not ended is exported as a
 * draft ("BORRADOR" in the file and in its name). The column layout is the SIN's, to be confirmed with the accountant.
 */
@Component({
  selector: 'rs-vat-book-export-dialog',
  imports: [ButtonComponent, FieldComponent, ModalComponent, NoteComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './vat-book-export.dialog.html',
  styleUrl: './vat-book-export.dialog.scss',
})
export class VatBookExportDialog {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  /** What the screen shows now: the dialog opens with it chosen. */
  readonly book = input<VatBook>('SALES');
  readonly period = input.required<string>();
  readonly periods = input<readonly SelectOption[]>([]);
  readonly formats = input<readonly VatBookExportFormat[]>(['XLSX', 'CSV']);

  protected readonly bookOptions = BOOK_OPTIONS;
  protected readonly chosenBook = signal<VatBook>('SALES');
  protected readonly chosenPeriod = signal('');
  protected readonly chosenFormat = signal<VatBookExportFormat>('XLSX');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly formatOptions = computed<SelectOption[]>(() => this.formats().map((f) => ({ value: f, label: FORMAT_LABELS[f] })));
  protected readonly draft = computed(() => isDraftPeriod(this.chosenPeriod() || this.period(), new Date()));
  protected readonly fileName = computed(() => vatBookFileName(this.chosenBook(), this.chosenPeriod() || this.period(), this.chosenFormat(), this.draft()));

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.chosenBook.set(VAT_BOOKS.includes(this.book()) ? this.book() : 'SALES');
        this.chosenPeriod.set(this.period());
        this.chosenFormat.set(this.formats()[0] ?? 'XLSX');
        this.saving.set(false);
        this.error.set(null);
      });
    });
  }

  protected export() {
    if (this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .exportBook(this.chosenBook(), this.chosenPeriod(), this.chosenFormat())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.saving.set(false);
          if (response.body) saveBlob(response.body, this.fileName());
          this.toast.success(this.draft() ? 'Borrador del libro exportado' : 'Libro exportado');
          this.open.set(false);
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(problemOf(err).message);
        },
      });
  }
}
