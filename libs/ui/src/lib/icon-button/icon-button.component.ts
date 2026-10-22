import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type IconButtonSize = 'sm' | 'md' | 'lg';

/**
 * Figma: IconButton (Size = SM | MD | LG, State = Default | Hover | Pressed | Focus | Disabled).
 * Circular 36/44/52 control with a projected 20 px `<rs-icon>`. The accessible name is mandatory (`label`).
 *   <button rsIconButton label="Buscar"><rs-icon name="search" /></button>
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'button[rsIconButton], a[rsIconButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'rs-icon-button',
    '[class]': 'modifiers()',
    '[attr.aria-label]': 'label()',
  },
  templateUrl: './icon-button.component.html',
  styleUrl: './icon-button.component.scss',
})
export class IconButtonComponent {
  /** Accessible name (required: an icon without a name is not allowed). */
  readonly label = input.required<string>();
  readonly size = input<IconButtonSize>('md');

  protected readonly modifiers = computed(() => `rs-icon-button rs-icon-button--${this.size()}`);
}
