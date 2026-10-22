import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  model,
  signal,
} from '@angular/core';
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
  templateUrl: './checkbox.component.html',
  styleUrl: './checkbox.component.scss',
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
