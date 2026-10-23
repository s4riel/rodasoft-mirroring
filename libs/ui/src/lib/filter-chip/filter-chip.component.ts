import { booleanAttribute, ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type FilterChipSize = 's' | 'm' | 'l';

/**
 * Toggle filter chip (Figma: FilterChip Size=M|L, Selected=Off|On, State=Default|Hover|Pressed|Focus|Disabled).
 * State is CSS only (:hover/:active/:focus-visible/disabled). `selected` is a two-way model.
 * Content: text via `label` or the default slot; optional `<rs-chip-media>` (Figma ShowMedia/Media swap).
 * When selected, a close glyph (16 px) is shown at the end: clicking the chip toggles it off.
 */
@Component({
  selector: 'rs-filter-chip',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-size]': 'size()',
    '[attr.data-selected]': 'selected()',
    '[attr.data-disabled]': 'disabled() || null',
  },
  templateUrl: './filter-chip.component.html',
  styleUrl: './filter-chip.component.scss',
})
export class FilterChipComponent {
  readonly size = input<FilterChipSize>('m');
  readonly selected = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Figma ShowMedia: hide the projected media. */
  readonly showMedia = input(true, { transform: booleanAttribute });
  /** Figma Label. Alternatively project the text. */
  readonly label = input<string>('');
  /** Accessible name while selected, e.g. "Quitar filtro: SKF" (the chip then removes the filter). */
  readonly removeLabel = input<string>('');

  protected toggle(): void {
    if (!this.disabled()) {
      this.selected.update((v) => !v);
    }
  }
}
