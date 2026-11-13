import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, input, model, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ButtonComponent, ModalComponent, NoteComponent, SkeletonComponent } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { invoiceFileName, saveBlob } from './file-download';
import { invoiceNumberLabel } from './invoice-format';
import { InvoicingApi } from './invoicing-api.service';

type PreviewState = 'loading' | 'ready' | 'error';

/**
 * FS-15 · Preview of the invoice in its printed layout. The PDF is rendered by the API, so what the user sees is what the
 * download, the e-mail and the ZIP carry. The blob lives in memory only while the dialog is open.
 */
@Component({
  selector: 'rs-invoice-preview-dialog',
  imports: [ButtonComponent, ModalComponent, NoteComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-preview.dialog.html',
  styleUrl: './invoice-preview.dialog.scss',
})
export class InvoicePreviewDialog {
  private readonly api = inject(InvoicingApi);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly invoiceId = input.required<string>();
  /** Printed number, for the title and the file name. */
  readonly invoiceNumber = input<number | null>(null);
  protected readonly numberLabel = computed(() => invoiceNumberLabel(this.invoiceNumber()));
  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('pdfFrame');

  protected readonly state = signal<PreviewState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly source = signal<SafeResourceUrl | null>(null);
  private blob: Blob | null = null;
  private objectUrl: string | null = null;

  constructor() {
    effect(() => {
      if (!this.open()) {
        untracked(() => this.release());
        return;
      }
      const id = this.invoiceId();
      untracked(() => this.load(id));
    });
    this.destroyRef.onDestroy(() => this.release());
  }

  protected download() {
    if (this.blob) saveBlob(this.blob, invoiceFileName(this.invoiceNumber(), 'pdf'));
  }

  /** "Imprimir": the browser's own print dialog on the PDF shown. */
  protected print() {
    this.frame()?.nativeElement.contentWindow?.print();
  }

  private load(id: string) {
    this.release();
    this.state.set('loading');
    this.api
      .pdf(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          this.blob = blob;
          this.objectUrl = URL.createObjectURL(blob);
          this.source.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.objectUrl));
          this.state.set('ready');
        },
        error: (err) => {
          // the body of an error is a blob too (`responseType: 'blob'`), so the code cannot be read: say it plainly
          this.errorMessage.set(problemOf(err).message);
          this.state.set('error');
        },
      });
  }

  private release() {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.blob = null;
    this.source.set(null);
  }
}
