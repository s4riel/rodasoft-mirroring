import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type FileItemStatus = 'uploading' | 'done' | 'error';

/**
 * One file of an upload list: icon or thumbnail, name, a detail line ("3,5 MB · 36 s restantes"), a remove button and, while
 * it uploads, a progress bar with its percentage. The icon / thumbnail is projected; every text comes from the app.
 *   <rs-file-item name="RT-3552_v1.jpg" detail="3,5 MB" status="uploading" [progress]="40" removeLabel="Cancelar subida"
 *     (removed)="cancel()"><rs-icon name="image" [size]="20" /></rs-file-item>
 */
@Component({
  selector: 'rs-file-item',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-status]': 'status()' },
  templateUrl: './file-item.component.html',
  styleUrl: './file-item.component.scss',
})
export class FileItemComponent {
  readonly name = input.required<string>();
  /** Second line: size and remaining time, or the error text when `status` is `error`. */
  readonly detail = input<string>('');
  readonly status = input<FileItemStatus>('done');
  /** 0–100; only drawn while `status` is `uploading`. */
  readonly progress = input<number>(0);
  /** Accessible name of the remove button ("Quitar", "Cancelar subida"). */
  readonly removeLabel = input.required<string>();

  readonly removed = output<void>();

  protected readonly percent = computed(() => Math.max(0, Math.min(100, Math.round(this.progress()))));
}
