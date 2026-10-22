import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FlagComponent, FlagCountry } from '../flag/flag.component';

export type ChipMediaType = 'flag' | 'brand' | 'icon' | 'initials' | 'count';

/**
 * 28 px media slot of a FilterChip (Figma: ChipMedia Type=Flag|Brand|Icon|Initials|Count).
 * - flag: `country`. - brand / initials / count: `text`. - icon: project an `<rs-icon size="20"/>` (18 px in Figma).
 * The medium is always on a white disc/tile so logos and flags keep their real colours in dark mode.
 */
@Component({
  selector: 'rs-chip-media',
  imports: [FlagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()' },
  templateUrl: './chip-media.component.html',
  styleUrl: './chip-media.component.scss',
})
export class ChipMediaComponent {
  readonly type = input<ChipMediaType>('flag');
  readonly country = input<FlagCountry>('DE');
  /** Brand text (SKF), initials (RA) or count (12). */
  readonly text = input<string>('');
  /** Brand logo; when set, a `brand` media shows it instead of `text`. */
  readonly logoUrl = input<string | null>(null);
}
