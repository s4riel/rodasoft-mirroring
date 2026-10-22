import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FlagComponent, FlagCountry } from '../flag/flag.component';

export type FieldMediaType = 'flag' | 'brand';

/** 24 px media slot for Input/Select prefixes (Figma: FieldMedia Type=Flag|Brand). */
@Component({
  selector: 'rs-field-media',
  imports: [FlagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()' },
  template: `
    @if (type() === 'flag') {
      <rs-flag [country]="country()" />
    } @else {
      <span class="text">{{ text() }}</span>
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
      width: 24px; /* Figma FieldMedia: 24x24 */
      height: 24px;
      border-radius: 12px; /* Figma: half of 24 (disc) */
      background: var(--white);
      color: var(--gray-900);
    }
    :host([data-type='brand']) {
      border-radius: 6px; /* Figma: 6, no token */
      box-shadow: inset 0 0 0 var(--stroke-default) var(--gray-200);
    }
    .text { font-size: 9px; font-weight: 700; line-height: 1; white-space: nowrap; }
    rs-flag { --rs-flag-border: 1.714px; width: 34.286px; height: 24px; flex: none; }
  `,
})
export class FieldMediaComponent {
  readonly type = input<FieldMediaType>('flag');
  readonly country = input<FlagCountry>('DE');
  /** Brand text (SKF). */
  readonly text = input<string>('');
}
