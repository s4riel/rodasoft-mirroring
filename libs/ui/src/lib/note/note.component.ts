import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';

export type NoteType = 'info' | 'success' | 'warning' | 'danger';

/**
 * Aviso en línea (Figma: Note Type=Info|Success|Warning|Danger).
 * `title` is optional; the message is the default slot.
 */
@Component({
  selector: 'rs-note',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()', '[attr.role]': "type() === 'danger' ? 'alert' : 'status'" },
  templateUrl: './note.component.html',
  styleUrl: './note.component.scss',
})
export class NoteComponent {
  readonly type = input<NoteType>('info');
  readonly title = input<string>();
  protected readonly icon = computed<IconName>(() =>
    this.type() === 'success' ? 'check' : this.type() === 'info' ? 'info' : 'alert',
  );
}
