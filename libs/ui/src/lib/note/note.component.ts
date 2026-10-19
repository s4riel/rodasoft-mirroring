import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';

export type NoteType = 'info' | 'success' | 'warning' | 'danger';

/** Aviso en línea (Figma: Note Type=Info|Success|Warning|Danger). */
@Component({
  selector: 'rs-note',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()', '[attr.role]': "type() === 'danger' ? 'alert' : 'status'" },
  template: `
    <rs-icon [name]="icon()" [size]="20" />
    <div class="body">
      @if (title()) {
        <strong>{{ title() }}</strong>
      }
      <div><ng-content /></div>
    </div>
  `,
  styles: `
    :host {
      --_c: var(--status-info); --_bg: var(--status-info-soft);
      display: flex; gap: var(--space-3); padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-lg); background: var(--_bg); color: var(--text-primary);
    }
    :host([data-type='success']) { --_c: var(--status-success); --_bg: var(--status-success-soft); }
    :host([data-type='warning']) { --_c: var(--status-warning); --_bg: var(--status-warning-soft); }
    :host([data-type='danger']) { --_c: var(--status-danger); --_bg: var(--status-danger-soft); }
    rs-icon { color: var(--_c); margin-top: 1px; }
    .body { display: grid; gap: 2px; }
  `,
})
export class NoteComponent {
  readonly type = input<NoteType>('info');
  readonly title = input<string>();
  protected readonly icon = computed<IconName>(() => (this.type() === 'success' ? 'check' : this.type() === 'info' ? 'bell' : 'alert'));
}
