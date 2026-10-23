import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icons';
import { TooltipDirective } from '../tooltip/tooltip.directive';

export type Status = 'success' | 'warning' | 'danger' | 'info' | 'idle';
export type StatusPillSize = 'md' | 'lg';

/**
 * Estado = color + punto + texto (nunca solo color).
 * Figma: StatusPill Status=Success|Warning|Danger|Info|Idle. Text via the default slot.
 */
@Component({
  selector: 'rs-status-pill',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [{ directive: TooltipDirective, inputs: ['rsTooltip: tooltip'] }],
  // with a tooltip the pill is a keyboard stop, so the text is reachable without a mouse
  host: { '[attr.data-status]': 'status()', '[attr.data-size]': 'size()', '[attr.tabindex]': 'tooltip() ? 0 : null' },
  templateUrl: './status-pill.component.html',
  styleUrl: './status-pill.component.scss',
})
export class StatusPillComponent {
  readonly status = input<Status>('idle');
  /** `md` is the 24 px pill of tables; `lg` the 34 px one of list rows (IN-03 suggestions). */
  readonly size = input<StatusPillSize>('md');
  /** Figma LeadingIcon: a glyph (check, alert…) shown instead of the dot. */
  readonly icon = input<IconName | null>(null);
  /** Detail shown on hover and keyboard focus (e.g. the list of differences). */
  readonly tooltip = input<string | null | undefined>(null);
}
