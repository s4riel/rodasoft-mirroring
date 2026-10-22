import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type BadgeVariant = 'new' | 'offer' | 'out-of-stock';

/** Product badge (Figma: Badge Variant=New|Offer|OutOfStock). Text via the default slot. */
@Component({
  selector: 'rs-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-variant]': 'variant()' },
  templateUrl: './badge.component.html',
  styleUrl: './badge.component.scss',
})
export class BadgeComponent {
  readonly variant = input<BadgeVariant>('new');
}
