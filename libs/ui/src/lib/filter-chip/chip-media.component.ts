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
  template: `
    @switch (type()) {
      @case ('flag') {
        <rs-flag [country]="country()" />
      }
      @case ('icon') {
        <ng-content />
      }
      @default {
        <span class="text">{{ text() }}</span>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
      width: 28px; /* Figma ChipMedia: 28x28 */
      height: 28px;
      border-radius: 14px; /* Figma: half of 28 (disc) */
      background: var(--white);
      color: var(--gray-900); /* fixed: the tile is white in both themes */
    }
    :host([data-type='brand']) { border-radius: var(--radius-sm); }
    .text { font-weight: 600; line-height: 1; white-space: nowrap; }
    :host([data-type='brand']) .text { font-size: 10px; font-weight: 700; }
    :host([data-type='initials']) .text { font-size: 11px; }
    :host([data-type='count']) .text { font-size: var(--body-sm-size); }
    /* Flag is drawn at 40x28 and cropped to the disc (Figma: left -6) */
    rs-flag { --rs-flag-border: 2px; width: 40px; height: 28px; margin-left: 0; flex: none; }
  `,
})
export class ChipMediaComponent {
  readonly type = input<ChipMediaType>('flag');
  readonly country = input<FlagCountry>('DE');
  /** Brand text (SKF), initials (RA) or count (12). */
  readonly text = input<string>('');
}
