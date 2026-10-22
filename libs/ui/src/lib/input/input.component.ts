import { booleanAttribute, ChangeDetectionStrategy, Component, Directive, input } from '@angular/core';

/**
 * Figma: Input (State = Default | Hover | Pressed | Focus | Error | Disabled). Native single-line field.
 * Styles live in the global `.rs-input` class (`styles/_base.scss`); this directive applies the class and mirrors
 * `invalid` to `aria-invalid`. Works with `formControlName`/`ngModel` through Angular's native value accessor.
 *   <input rsInput type="text" formControlName="code" />
 * Inside `<rs-field>` the error state is applied automatically.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: 'input[rsInput]',
  host: {
    class: 'rs-input',
    '[attr.aria-invalid]': 'invalid() ? "true" : null',
  },
})
export class InputDirective {
  /** Figma State=Error. */
  readonly invalid = input(false, { transform: booleanAttribute });
}

/**
 * Figma: Input with ShowLeadingIcon / ShowTrailingIcon. Draws the box (border, hover, focus ring, error) and
 * projects `[rsInputLeading]`, the native `<input rsInput>` and `[rsInputTrailing]` (16 px `<rs-icon>`).
 *   <rs-input-group>
 *     <rs-icon rsInputLeading name="search" [size]="16" />
 *     <input rsInput placeholder="…" />
 *   </rs-input-group>
 */
@Component({
  selector: 'rs-input-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.rs-input-group--invalid]': 'invalid()',
  },
  template: `
    <ng-content select="[rsInputLeading]" />
    <ng-content />
    <ng-content select="[rsInputTrailing]" />
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      width: 100%;
      height: var(--size-control-md);
      padding: 0 calc(var(--space-3) - var(--stroke-default));
      border: var(--stroke-default) solid var(--border-control);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
      color: var(--text-primary);
      transition: background var(--motion-fast) var(--ease-out);
    }
    :host(:hover:not(:has(.rs-input:disabled))) {
      background: var(--bg-surface-2);
    }
    :host(:has(.rs-input:active:not(:disabled))) {
      background: var(--action-primary-soft);
    }
    :host(:has(.rs-input:focus-visible)) {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    :host(:has(.rs-input:disabled)) {
      background: var(--action-primary-soft);
      color: var(--text-muted);
      cursor: not-allowed;
    }
    :host(.rs-input-group--invalid),
    :host(:has(.rs-input[aria-invalid='true'])),
    :host-context(.has-error) {
      border-color: var(--status-danger);
      box-shadow: inset 0 0 0 var(--stroke-default) var(--status-danger);
    }
    /* The inner input is borderless: the group draws the box */
    :host ::ng-deep input.rs-input.rs-input {
      flex: 1 1 0;
      min-width: 0;
      height: 100%;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      outline: none;
    }
    :host ::ng-deep rs-icon {
      flex: none;
    }
  `,
})
export class InputGroupComponent {
  readonly invalid = input(false, { transform: booleanAttribute });
}
