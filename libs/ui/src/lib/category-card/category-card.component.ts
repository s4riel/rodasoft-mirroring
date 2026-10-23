import { booleanAttribute, ChangeDetectionStrategy, Component, model, input } from '@angular/core';

/**
 * Category choice card of the product wizard (Figma: CategoryCard, Selected/Disabled; Hover is CSS).
 * The glyph goes in a `[slot=glyph]` child, the title and description in inputs.
 * Behaves as a radio: Space and Enter select it; the parent keeps one selected at a time through `[(selected)]`.
 */
@Component({
  selector: 'rs-category-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'radio',
    '[attr.aria-checked]': 'selected()',
    '[attr.aria-disabled]': 'disabled() || null',
    '[attr.data-selected]': 'selected()',
    '[attr.tabindex]': 'disabled() || !tabStop() ? -1 : 0',
    '(click)': 'choose()',
    '(keydown.enter)': 'choose()',
    '(keydown.space)': 'onSpace($event)',
  },
  templateUrl: './category-card.component.html',
  styleUrl: './category-card.component.scss',
})
export class CategoryCardComponent {
  readonly title = input.required<string>();
  readonly description = input<string>('');
  readonly selected = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Roving tab stop: only the selected card (or the first one) is reached with Tab; arrows move between the rest. */
  readonly tabStop = input(true, { transform: booleanAttribute });

  protected choose(): void {
    if (this.disabled()) return;
    this.selected.set(true);
  }

  protected onSpace(event: Event): void {
    event.preventDefault();
    this.choose();
  }
}
