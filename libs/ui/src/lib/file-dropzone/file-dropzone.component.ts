import { booleanAttribute, ChangeDetectionStrategy, Component, ElementRef, input, output, signal, viewChild } from '@angular/core';

/**
 * Drop area to pick files: a dashed panel with an icon tile, a title, the accepted formats, the size limit and a button.
 * The icon is projected (`<rs-icon name="image" />`); every text comes from the app (Spanish copy lives there).
 *   <rs-file-dropzone title="Arrastra tus fotos" formats="JPG, PNG, WEBP" limit="Máx. 5 MB por archivo"
 *     buttonLabel="Seleccionar archivos" accept="image/*" multiple (filesSelected)="onFiles($event)">
 *     <rs-icon name="image" [size]="24" />
 *   </rs-file-dropzone>
 * It only reports the files; checking and uploading them is the caller's job.
 */
@Component({
  selector: 'rs-file-dropzone',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-dragging]': 'dragging() || null', '[attr.aria-disabled]': 'disabled() || null' },
  templateUrl: './file-dropzone.component.html',
  styleUrl: './file-dropzone.component.scss',
})
export class FileDropzoneComponent {
  readonly title = input.required<string>();
  /** Accepted formats, shown in bold after `formatsLabel`. */
  readonly formats = input<string>('');
  readonly formatsLabel = input<string>('');
  readonly limit = input<string>('');
  readonly buttonLabel = input.required<string>();
  /** Native `accept` of the file input (`image/*`, `application/pdf`). */
  readonly accept = input<string>('');
  readonly multiple = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Shows the error look (red dashes) while the app has something to report. */
  readonly invalid = input(false, { transform: booleanAttribute });

  readonly filesSelected = output<File[]>();

  protected readonly dragging = signal(false);
  private readonly picker = viewChild.required<ElementRef<HTMLInputElement>>('picker');

  protected open(): void {
    if (!this.disabled()) this.picker().nativeElement.click();
  }

  protected onPick(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // the same file can be picked again after removing it
    if (files.length) this.filesSelected.emit(files);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (!this.disabled()) this.dragging.set(true);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    if (this.disabled()) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length) this.filesSelected.emit(this.multiple() ? files : files.slice(0, 1));
  }
}
