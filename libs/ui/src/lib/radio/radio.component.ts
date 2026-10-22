import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

let nextRadioGroupId = 0;

/**
 * Exclusive group of `<rs-radio>`; ControlValueAccessor for the selected value.
 *   <rs-radio-group formControlName="delivery" ariaLabel="Entrega">
 *     <rs-radio value="pickup">Retiro en sucursal</rs-radio>
 *   </rs-radio-group>
 * Keyboard (arrows, Tab) comes from the native radio inputs that share the group `name`.
 */
@Component({
  selector: 'rs-radio-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RadioGroupComponent), multi: true },
  ],
  host: {
    role: 'radiogroup',
    '[class.rs-radio-group--horizontal]': "orientation() === 'horizontal'",
    '[attr.aria-label]': 'ariaLabel() || null',
    '[attr.aria-invalid]': 'invalid() ? "true" : null',
    '[attr.aria-disabled]': 'isDisabled() ? "true" : null',
  },
  templateUrl: './radio-group.component.html',
  styleUrl: './radio-group.component.scss',
})
export class RadioGroupComponent implements ControlValueAccessor {
  readonly value = model<unknown>(null);
  readonly name = input<string>(`rs-radio-group-${nextRadioGroupId++}`);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly orientation = input<'vertical' | 'horizontal'>('vertical');
  readonly ariaLabel = input<string>('');

  private readonly cvaDisabled = signal(false);
  readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  private onChange: (value: unknown) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  select(value: unknown): void {
    if (this.isDisabled()) return;
    this.value.set(value);
    this.onChange(value);
  }
  markTouched(): void {
    this.onTouched();
  }

  writeValue(value: unknown): void {
    this.value.set(value ?? null);
  }
  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.cvaDisabled.set(isDisabled);
  }
}

/**
 * Figma: Radio (Checked = On | Off, State = Default | Hover | Pressed | Focus | Disabled).
 * One option of an exclusive group. Inside `<rs-radio-group>` the group owns the value; standalone it uses `[(checked)]`.
 */
@Component({
  selector: 'rs-radio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './radio.component.html',
  styleUrl: './radio.component.scss',
})
export class RadioComponent {
  protected readonly group = inject(RadioGroupComponent, { optional: true });

  /** Value this option represents inside a group. */
  readonly value = input<unknown>(null);
  /** Figma Checked=On when used without a group (two-way). */
  readonly checked = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly name = input<string>('');
  readonly inputId = input<string>('');

  protected readonly isChecked = computed(() =>
    this.group ? Object.is(this.group.value(), this.value()) : this.checked(),
  );
  protected readonly isDisabled = computed(() => this.disabled() || (this.group?.isDisabled() ?? false));

  protected onSelect(): void {
    if (this.group) this.group.select(this.value());
    else this.checked.set(true);
  }
}
