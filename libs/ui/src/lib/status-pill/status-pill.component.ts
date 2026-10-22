import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type Status = 'success' | 'warning' | 'danger' | 'info' | 'idle';

/**
 * Estado = color + punto + texto (nunca solo color).
 * Figma: StatusPill Status=Success|Warning|Danger|Info|Idle. Text via the default slot.
 */
@Component({
  selector: 'rs-status-pill',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-status]': 'status()' },
  templateUrl: './status-pill.component.html',
  styleUrl: './status-pill.component.scss',
})
export class StatusPillComponent {
  readonly status = input<Status>('idle');
}
