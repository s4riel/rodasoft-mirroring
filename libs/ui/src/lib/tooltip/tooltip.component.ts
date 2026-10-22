import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

/**
 * Tooltip bubble (Figma: Tooltip). Normally created by the `rsTooltip` directive; it can also be
 * used inline (static, e.g. in the showcase) as `<rs-tooltip text="…" />`.
 */
@Component({
  selector: 'rs-tooltip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'tooltip', '[attr.data-position]': 'position()' },
  templateUrl: './tooltip.component.html',
  styleUrl: './tooltip.component.scss',
})
export class TooltipComponent {
  readonly text = input<string>('');
  readonly position = input<TooltipPosition>('top');
}
