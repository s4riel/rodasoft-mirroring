import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HOMOLOGATION_IMPORT_ERROR_LABELS, type HomologationImportPreview } from '@rodasoft/domain';
import { ButtonComponent, FileDropzoneComponent, FileItemComponent, ModalComponent, NoteComponent, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { saveBlob } from './file-download';
import { InvoicingApi } from './invoicing-api.service';

/**
 * Excel import of SIN codes (HU-FAC-26): the file is read and checked first (the preview lists each row with its errors), and only a
 * file without errors can be applied. Applying is all or nothing.
 */
@Component({
  selector: 'rs-homologation-import-dialog',
  imports: [ButtonComponent, FileDropzoneComponent, FileItemComponent, ModalComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './homologation-import.dialog.html',
  styleUrl: './homologation-import.dialog.scss',
})
export class HomologationImportDialog {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly imported = output<void>();

  protected readonly file = signal<File | null>(null);
  protected readonly preview = signal<HomologationImportPreview | null>(null);
  protected readonly checking = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly canApply = computed(() => this.preview() !== null && this.preview()?.withErrors === 0 && (this.preview()?.valid ?? 0) > 0 && !this.saving());
  protected readonly errorRows = computed(() =>
    (this.preview()?.rows ?? [])
      .filter((row) => row.errors.length > 0)
      .slice(0, 20)
      .map((row) => ({ line: row.line, sku: row.sku, text: row.errors.map((code) => HOMOLOGATION_IMPORT_ERROR_LABELS[code]).join(' · ') })),
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => this.reset());
    });
  }

  private reset() {
    this.file.set(null);
    this.preview.set(null);
    this.checking.set(false);
    this.saving.set(false);
    this.error.set(null);
  }

  protected pick(files: File[]) {
    const file = files[0];
    if (!file) return;
    this.file.set(file);
    this.preview.set(null);
    this.error.set(null);
    this.checking.set(true);
    this.api
      .previewHomologationImport(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (preview) => {
          this.preview.set(preview);
          this.checking.set(false);
        },
        error: (err) => {
          this.checking.set(false);
          this.error.set(problemOf(err).message);
        },
      });
  }

  protected removeFile() {
    this.reset();
  }

  protected template() {
    this.api
      .homologationTemplate()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (response) => response.body && saveBlob(response.body, 'plantilla-homologacion.xlsx'), error: (err) => this.error.set(problemOf(err).message) });
  }

  protected apply() {
    const file = this.file();
    if (!file || !this.canApply()) return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .importHomologation(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.toast.success(`${result.updated} ${result.updated === 1 ? 'producto homologado' : 'productos homologados'}`);
          this.open.set(false);
          this.imported.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(problemOf(err).message);
        },
      });
  }
}
