import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'brand';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Botón pill (Figma: Button Variant=Primary|Secondary|Ghost|Danger, Size=SM|MD|LG, Width=Hug|Fill).
 * Uso: <button rsButton variant="primary">Ingresar</button> · <a rsButton variant="ghost" routerLink="…">
 * `brand` = pill roja/verde de la marca (Cotizar / Comprar en la tienda).
 */
@Component({
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'button[rsButton], a[rsButton]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'rs-button',
    '[class.rs-button--secondary]': "variant() === 'secondary'",
    '[class.rs-button--ghost]': "variant() === 'ghost'",
    '[class.rs-button--danger]': "variant() === 'danger'",
    '[class.rs-button--brand]': "variant() === 'brand'",
    '[class.rs-button--sm]': "size() === 'sm'",
    '[class.rs-button--lg]': "size() === 'lg'",
    '[class.rs-button--fill]': 'fill()',
    '[class.rs-button--loading]': 'loading()',
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
      --_bg: var(--action-primary);
      --_fg: var(--action-on-primary);
      --_border: transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: var(--space-2);
      height: 40px;
      padding: 0 var(--space-5);
      border-radius: var(--radius-full);
      border: 1px solid var(--_border);
      background: var(--_bg);
      color: var(--_fg);
      font-weight: 600;
      font-size: var(--text-md);
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
      transition: filter var(--motion-fast) var(--ease-out), background var(--motion-fast) var(--ease-out);
      user-select: none;
    }
    :host(:hover) { filter: brightness(1.15); }
    :host(:active) { filter: brightness(0.92); }
    :host([disabled]), :host(.rs-button--loading) { opacity: 0.5; pointer-events: none; }
    :host(.rs-button--secondary) { --_bg: var(--bg-surface); --_fg: var(--text-primary); --_border: var(--border-strong); }
    :host(.rs-button--secondary:hover), :host(.rs-button--ghost:hover) { filter: none; background: var(--bg-surface-2); }
    :host(.rs-button--ghost) { --_bg: transparent; --_fg: var(--text-primary); }
    :host(.rs-button--danger) { --_bg: var(--status-danger); --_fg: var(--white); }
    :host(.rs-button--brand) { --_bg: var(--brand-primary-strong); --_fg: var(--brand-on-primary); }
    :host(.rs-button--sm) { height: 32px; padding: 0 var(--space-3); font-size: var(--text-sm); }
    :host(.rs-button--lg) { height: 48px; padding: 0 var(--space-6); font-size: var(--text-lg); }
    :host(.rs-button--fill) { display: flex; width: 100%; }
    .rs-button__spinner {
      width: 14px; height: 14px; border-radius: 50%;
      border: 2px solid currentColor; border-right-color: transparent;
      animation: rs-spin 0.7s linear infinite;
    }
    @keyframes rs-spin { to { transform: rotate(360deg); } }
  `,
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<ButtonSize>('md');
  readonly fill = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
}
