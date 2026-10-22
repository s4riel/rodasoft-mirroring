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
  templateUrl: './input.component.html',
  styleUrl: './input.component.scss',
})
export class InputGroupComponent {
  readonly invalid = input(false, { transform: booleanAttribute });
}
