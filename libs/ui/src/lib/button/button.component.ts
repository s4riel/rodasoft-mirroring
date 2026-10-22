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
  template: `
    @if (loading()) {
      <span class="rs-button__spinner" aria-hidden="true"></span>
    }
    <ng-content />
  `,
  styles: `
    :host {
      /* Variant tokens (Primary by default) */
      --_bg: var(--action-primary);
      --_bg-hover: var(--action-primary-hover);
      --_bg-active: var(--action-primary-pressed);
      --_fg: var(--action-on-primary);
      --_fg-hover: var(--_fg);
      --_fg-active: var(--_fg);
      --_border: transparent;
      /* Content padding: Figma px 16/20/24 minus the 1px border (the border sits inside the Figma frame) */
      --_pad: calc(var(--space-5) - var(--stroke-default));

      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      height: var(--size-control-md);
      padding: 0 var(--_pad);
      border: var(--stroke-default) solid var(--_border);
      border-radius: var(--radius-full);
      background: var(--_bg);
      color: var(--_fg);
      font-family: var(--font-family-ui);
      font-size: var(--label-md-size);
      line-height: var(--label-md-line-height);
      font-weight: var(--label-md-weight);
      letter-spacing: var(--label-md-tracking);
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
      transition: background var(--motion-fast) var(--ease-out), color var(--motion-fast) var(--ease-out);
    }
    :host(.rs-button--sm) {
      height: var(--size-control-sm);
      --_pad: calc(var(--space-4) - var(--stroke-default));
    }
    :host(.rs-button--lg) {
      height: var(--size-control-lg);
      --_pad: calc(var(--space-6) - var(--stroke-default));
    }
    :host(.rs-button--fill) {
      display: flex;
      width: 100%;
    }

    :host(.rs-button--secondary) {
      --_bg: var(--bg-surface);
      --_bg-hover: var(--bg-surface-2);
      --_bg-active: var(--action-primary-soft);
      --_fg: var(--text-primary);
      --_border: var(--border-control);
    }
    :host(.rs-button--ghost) {
      --_bg: transparent;
      --_bg-hover: var(--bg-surface-2);
      --_bg-active: var(--action-primary-soft);
      --_fg: var(--text-primary);
    }
    :host(.rs-button--brand) {
      --_bg: var(--brand-primary);
      --_bg-hover: var(--brand-primary-hover);
      --_bg-active: var(--brand-accent-on-page);
      --_fg: var(--brand-on-primary);
      --_fg-hover: var(--brand-on-hover);
      --_fg-active: var(--brand-on-primary);
      --_border: var(--border-control);
    }
    /* Figma: Danger keeps the same fill in Hover and Pressed */
    :host(.rs-button--danger) {
      --_bg: var(--status-danger);
      --_bg-hover: var(--status-danger);
      --_bg-active: var(--status-danger);
      --_fg: var(--action-on-danger);
    }

    :host(:hover:not(:disabled):not([aria-disabled='true']):not(.rs-button--loading)) {
      background: var(--_bg-hover);
      color: var(--_fg-hover);
    }
    :host(:active:not(:disabled):not([aria-disabled='true']):not(.rs-button--loading)) {
      background: var(--_bg-active);
      color: var(--_fg-active);
    }
    :host(:focus-visible) {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    /* Figma: Disabled = soft fill + muted text, no border; never authorizes an action */
    :host(:disabled),
    :host([aria-disabled='true']) {
      background: var(--action-primary-soft);
      color: var(--text-muted);
      border-color: transparent;
      cursor: not-allowed;
      pointer-events: none;
    }
    :host(.rs-button--loading) {
      cursor: progress;
      pointer-events: none;
    }

    .rs-button__spinner {
      flex: none;
      width: 14px; /* spinner geometry, no Figma token */
      height: 14px;
      border-radius: var(--radius-full);
      border: var(--stroke-focus) solid currentColor;
      border-right-color: transparent;
      animation: rs-button-spin 0.7s linear infinite;
    }
    @keyframes rs-button-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
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
