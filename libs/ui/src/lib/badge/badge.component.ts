import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BadgeVariant = 'new' | 'offer' | 'out-of-stock';

/** Product badge (Figma: Badge Variant=New|Offer|OutOfStock). Text via the default slot. */
@Component({
  selector: 'rs-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-variant]': 'variant()' },
  template: `<ng-content />`,
  styles: `
    :host {
      --_bg: var(--action-primary);
      --_fg: var(--action-on-primary);
      display: inline-flex;
      align-items: center;
      height: 24px;
      padding: 0 var(--space-3);
      border-radius: var(--radius-full);
      background: var(--_bg);
      color: var(--_fg);
      font-size: var(--body-sm-size);
      line-height: var(--body-sm-line-height);
      font-weight: 600;
      white-space: nowrap;
    }
    :host([data-variant='offer']) { --_bg: var(--brand-primary); --_fg: var(--brand-on-primary); }
    :host([data-variant='out-of-stock']) {
      --_bg: var(--bg-surface-2);
      --_fg: var(--text-muted);
      box-shadow: inset 0 0 0 var(--stroke-default) var(--border-control);
    }
  `,
})
export class BadgeComponent {
  readonly variant = input<BadgeVariant>('new');
}
