import { ChangeDetectionStrategy, Component, input } from '@angular/core';

let nextId = 0;

/**
 * Campo de formulario: etiqueta + control + ayuda o error (Figma: Field).
 * El control proyectado usa la clase global .rs-input y debe tener id = forId.
 *   <rs-field label="Correo" [forId]="'email'" [error]="err">
 *     <input class="rs-input" id="email" formControlName="email" />
 *   </rs-field>
 */
@Component({
  selector: 'rs-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.has-error]': '!!error()' },
  template: `
    <div class="head">
      <label [attr.for]="forId()">{{ label() }}</label>
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
    :host { display: grid; gap: 6px; }
    .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
    label { font-weight: 500; font-size: var(--text-md); }
    .msg { font-size: var(--text-sm); color: var(--text-muted); }
    .msg.error { color: var(--status-danger); }
  `,
})
export class FieldComponent {
  readonly label = input.required<string>();
  readonly forId = input<string>(`rs-field-${nextId++}`);
  readonly hint = input<string>();
  readonly error = input<string | null>();
}
