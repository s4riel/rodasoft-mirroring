import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type StockFlagLevel = 'low' | 'out';

/**
 * Figma: StockFlag Level=Low|None. Alert glyph next to a quantity: warning when stock is low, danger when out.
 * `label` is the accessible name; without it the glyph is decorative (the text status is shown elsewhere).
 */
@Component({
  selector: 'rs-stock-flag',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-level]': 'level()',
    '[attr.role]': "label() ? 'img' : null",
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': "label() ? null : 'true'",
  },
  templateUrl: './stock-flag.component.html',
  styleUrl: './stock-flag.component.scss',
})
export class StockFlagComponent {
  readonly level = input<StockFlagLevel>('low');
  readonly label = input('');
}
