import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FlagComponent, FlagCountry } from '../flag/flag.component';

export type FieldMediaType = 'flag' | 'brand';

/** 24 px media slot for Input/Select prefixes (Figma: FieldMedia Type=Flag|Brand). */
@Component({
  selector: 'rs-field-media',
  imports: [FlagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()' },
  templateUrl: './field-media.component.html',
  styleUrl: './field-media.component.scss',
})
export class FieldMediaComponent {
  readonly type = input<FieldMediaType>('flag');
  readonly country = input<FlagCountry>('DE');
  /** Brand text (SKF). */
  readonly text = input<string>('');
}
