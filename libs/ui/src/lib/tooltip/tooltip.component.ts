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
  template: `{{ text() }}<ng-content />`,
  styles: `
    :host {
      display: inline-block;
      max-width: 280px;
      padding: var(--space-2) var(--space-3);
      border-radius: var(--radius-sm);
      background: var(--action-primary);
      color: var(--action-on-primary);
      font-size: var(--body-sm-size);
      line-height: var(--body-sm-line-height);
      font-weight: 500;
      pointer-events: none;
    }
  `,
})
export class TooltipComponent {
  readonly text = input<string>('');
  readonly position = input<TooltipPosition>('top');
}
