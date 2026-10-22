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
  template: `<ng-content />`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: var(--size-control-md);
      height: var(--size-control-md);
      padding: 0;
      border: var(--stroke-default) solid var(--border-control);
      border-radius: var(--radius-full);
      background: var(--bg-surface);
      color: var(--text-primary);
      text-decoration: none;
      cursor: pointer;
      transition: background var(--motion-fast) var(--ease-out);
    }
    :host(.rs-icon-button--sm) {
      width: var(--size-control-sm);
      height: var(--size-control-sm);
    }
    :host(.rs-icon-button--lg) {
      width: var(--size-control-lg);
      height: var(--size-control-lg);
    }
    :host(:hover:not(:disabled):not([aria-disabled='true'])) {
      background: var(--bg-surface-2);
    }
    :host(:active:not(:disabled):not([aria-disabled='true'])) {
      background: var(--action-primary-soft);
    }
    :host(:focus-visible) {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    :host(:disabled),
    :host([aria-disabled='true']) {
      background: var(--action-primary-soft);
      color: var(--text-muted);
      cursor: not-allowed;
      pointer-events: none;
    }
  `,
})
export class IconButtonComponent {
  /** Accessible name (required: an icon without a name is not allowed). */
  readonly label = input.required<string>();
  readonly size = input<IconButtonSize>('md');

  protected readonly modifiers = computed(() => `rs-icon-button rs-icon-button--${this.size()}`);
}
