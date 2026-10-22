import { booleanAttribute, Directive, input } from '@angular/core';

/**
 * Figma: Textarea (State = Default | Hover | Pressed | Focus | Error | Disabled). Native multi-line field.
 * Styles live in the global `.rs-textarea` class (`styles/_base.scss`). Value text is body/md (not mono).
 *   <textarea rsTextarea rows="3" formControlName="notes"></textarea>
 * Inside `<rs-field>` the error state is applied automatically.
 */
@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: 'textarea[rsTextarea]',
  host: {
    class: 'rs-textarea',
    '[attr.aria-invalid]': 'invalid() ? "true" : null',
  },
})
export class TextareaDirective {
  /** Figma State=Error. */
  readonly invalid = input(false, { transform: booleanAttribute });
}
