import {
  AfterViewChecked,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
} from '@angular/core';

let nextId = 0;

/**
 * Figma: Field (Control = Input | Select | Textarea, State = Default | … | Error | Disabled):
 * label + control + hint or error. The control is projected and must carry `id = forId`:
 *   <rs-field label="Código" forId="code" hint="Ayuda" [error]="err" required>
 *     <input rsInput id="code" formControlName="code" />
 *   </rs-field>
 * Works with `input[rsInput]` / `.rs-input`, `textarea[rsTextarea]` and `<rs-select inputId="…">`.
 * The error state (`.has-error` on the host) paints the projected control and Field mirrors
 * `aria-describedby` / `aria-invalid` onto the control with id `forId`.
 * Optional `[rsFieldAction]` content (e.g. "¿Olvidaste tu contraseña?") sits at the end of the label row.
 */
@Component({
  selector: 'rs-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.has-error]': '!!error()' },
  template: `
    <div class="head">
      <label class="label" [attr.for]="forId()">
        {{ label() }}
        @if (required()) {
          <span class="required" aria-hidden="true">*</span>
        }
      </label>
      <ng-content select="[rsFieldAction]" />
    </div>
    <ng-content />
    @if (error()) {
      <p class="msg error" [id]="forId() + '-error'" role="alert">{{ error() }}</p>
    } @else if (hint()) {
      <p class="msg" [id]="forId() + '-hint'">{{ hint() }}</p>
    }
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-2);
    }
    .head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .label {
      color: var(--text-primary);
      font-size: var(--label-md-size);
      line-height: var(--label-md-line-height);
      font-weight: var(--label-md-weight);
      letter-spacing: var(--label-md-tracking);
    }
    .required {
      color: var(--status-danger);
    }
    .msg {
      color: var(--text-muted);
      font-size: var(--body-sm-size);
      line-height: var(--body-sm-line-height);
      font-weight: var(--body-sm-weight);
      letter-spacing: var(--body-sm-tracking);
    }
    .msg.error {
      color: var(--status-danger);
    }
  `,
})
export class FieldComponent implements AfterViewChecked {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Visible label (Figma: Label text property). Never hide it. */
  readonly label = input.required<string>();
  /** id of the projected control (the label `for`). */
  readonly forId = input<string>(`rs-field-${nextId++}`);
  /** Helper text shown under the control (Figma: helper). */
  readonly hint = input<string>();
  /** Error message; when set the control shows Figma State=Error. */
  readonly error = input<string | null>();
  /** Adds the visual required marker. Put the native `required` attribute on the control too. */
  readonly required = input(false, { transform: booleanAttribute });

  private managedDescribedBy: string | null = null;
  private managedInvalid = false;

  /**
   * Runs after the projected control has been refreshed (so its own host bindings cannot overwrite the attributes).
   */
  ngAfterViewChecked(): void {
    const id = this.forId();
    const hasError = !!this.error();
    const hasHint = !hasError && !!this.hint();
    const control = this.host.nativeElement.querySelector<HTMLElement>(`[id="${id}"]`);
    if (!control) return;
    const descriptor = hasError ? `${id}-error` : hasHint ? `${id}-hint` : null;
    if (descriptor) {
      if (control.getAttribute('aria-describedby') !== descriptor) control.setAttribute('aria-describedby', descriptor);
      this.managedDescribedBy = descriptor;
    } else if (this.managedDescribedBy) {
      if (control.getAttribute('aria-describedby') === this.managedDescribedBy) control.removeAttribute('aria-describedby');
      this.managedDescribedBy = null;
    }
    if (hasError) {
      if (control.getAttribute('aria-invalid') !== 'true') control.setAttribute('aria-invalid', 'true');
      this.managedInvalid = true;
    } else if (this.managedInvalid) {
      control.removeAttribute('aria-invalid');
      this.managedInvalid = false;
    }
  }
}
