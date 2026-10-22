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

let nextSwitchId = 0;

/**
 * Figma: Switch (Checked = On | Off, State = Default | Hover | Pressed | Focus | Disabled).
 * Native `<input type="checkbox" role="switch">` + projected label + optional status text
 * (Figma shows "Activado" / "Desactivado" next to the label so the state is not only the thumb).
 *   <rs-switch [(checked)]="onlyAvailable" onText="Activado" offText="Desactivado">Solo disponibles</rs-switch>
 */
@Component({
  selector: 'rs-switch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SwitchComponent), multi: true }],
  templateUrl: './switch.component.html',
  styleUrl: './switch.component.scss',
})
export class SwitchComponent implements ControlValueAccessor {
  /** Figma Checked=On (two-way). */
  readonly checked = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Status text shown when on (Figma: "Activado"). Provided by the app so copy stays outside the library. */
  readonly onText = input<string>('');
  /** Status text shown when off (Figma: "Desactivado"). */
  readonly offText = input<string>('');
  readonly name = input<string>('');
  readonly inputId = input<string>(`rs-switch-${nextSwitchId++}`);

  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());
  protected readonly statusText = computed(() => (this.checked() ? this.onText() : this.offText()));

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
