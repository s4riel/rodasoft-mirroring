import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'brand' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Figma: Button (Variant = Primary | Secondary | Ghost | Brand | Danger, State = Default | Hover | Pressed | Focus | Disabled)
 * + Button/Content (Size = SM | MD | LG, Icon = None | Left | Right).
 *
 * States are CSS only (:hover, :active, :focus-visible, :disabled / [aria-disabled='true']).
 * Icons are projected: `<button rsButton><rs-icon name="plus" [size]="16" /> Label</button>` (icon left)
 * or `<button rsButton>Label <rs-icon name="arrow" [size]="16" /></button>` (icon right).
 * `brand` is the red/green accent button (Cotizar, Comprar); the main action is monochrome (`primary`).
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'button[rsButton], a[rsButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'rs-button',
    '[class]': 'modifiers()',
    '[attr.aria-busy]': 'loading() || null',
  },
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss',
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  /** Figma Width=Fill. */
  readonly fill = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });

  protected readonly modifiers = computed(
    () =>
      `rs-button rs-button--${this.variant()} rs-button--${this.size()}` +
      (this.fill() ? ' rs-button--fill' : '') +
      (this.loading() ? ' rs-button--loading' : ''),
  );
}
