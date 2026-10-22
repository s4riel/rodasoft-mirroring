import { booleanAttribute, ChangeDetectionStrategy, Component, computed, forwardRef, input, model, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';

let nextCheckboxId = 0;

/**
 * Figma: Checkbox (Checked = On | Off, State = Default | Hover | Pressed | Focus | Disabled).
 * Native `<input type="checkbox">` (visually replaced) + projected label text. ControlValueAccessor (boolean).
 *   <rs-checkbox formControlName="datasheet">Incluir ficha técnica</rs-checkbox>
 *   <rs-checkbox [(checked)]="on">…</rs-checkbox>
 * The focus ring wraps the whole row (box + label) as in Figma.
 */
@Component({
  selector: 'rs-checkbox',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CheckboxComponent), multi: true }],
  template: `
    <label class="root" [class.disabled]="isDisabled()">
      <input
        class="native"
        type="checkbox"
        [attr.id]="inputId()"
        [attr.name]="name() || null"
        [attr.aria-invalid]="invalid() ? 'true' : null"
        [checked]="checked()"
        [disabled]="isDisabled()"
        (change)="onToggle($event)"
        (blur)="onTouched()"
      />
      <span class="box" aria-hidden="true">
        @if (checked()) {
          <rs-icon name="check" [size]="16" />
        }
      </span>
      <span class="text"><ng-content /></span>
    </label>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .root {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: var(--space-3);
      color: var(--text-primary);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
      font-weight: var(--body-md-weight);
      cursor: pointer;
      border-radius: var(--radius-xs);
    }
    .root.disabled {
      color: var(--text-muted);
      cursor: not-allowed;
    }
    .native {
      position: absolute;
      left: 0;
      top: 50%;
      width: 20px;
      height: 20px;
      margin: 0;
      opacity: 0;
      transform: translateY(-50%);
      cursor: inherit;
    }
    .box {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 20px; /* Figma Control 20 x 20 */
      height: 20px;
      border: var(--stroke-default) solid var(--border-control);
      border-radius: var(--radius-xs);
      background: var(--bg-surface);
      color: var(--action-on-primary);
      transition: background var(--motion-fast) var(--ease-out);
    }
    .native:checked + .box {
      background: var(--action-primary);
    }
    .root:hover .native:not(:disabled) + .box {
      background: var(--bg-surface-2);
    }
    .root:hover .native:checked:not(:disabled) + .box {
      background: var(--action-primary);
    }
    .root:active .native:not(:disabled) + .box {
      background: var(--action-primary-soft);
    }
    .root:active .native:checked:not(:disabled) + .box {
      background: var(--action-primary-pressed);
    }
    .native:disabled + .box {
      background: var(--action-primary-soft);
      color: var(--text-muted);
    }
    .native[aria-invalid='true'] + .box {
      border-color: var(--status-danger);
      box-shadow: inset 0 0 0 var(--stroke-default) var(--status-danger);
    }
    .root:has(.native:focus-visible) {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    .text:empty {
      display: none;
    }
  `,
})
export class CheckboxComponent implements ControlValueAccessor {
  /** Figma Checked=On (two-way). */
  readonly checked = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly name = input<string>('');
  readonly inputId = input<string>(`rs-checkbox-${nextCheckboxId++}`);

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  private onChange: (value: boolean) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  protected onToggle(event: Event): void {
    const value = (event.target as HTMLInputElement).checked;
    this.checked.set(value);
    this.onChange(value);
  }

  writeValue(value: unknown): void {
    this.checked.set(!!value);
  }
  registerOnChange(fn: (value: boolean) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }
}
