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

/**
 * Figma: QtyStepper State=Default|Hover|Pressed|Focus|Disabled (minus, value, plus).
 * ControlValueAccessor over a number; also usable with `[(value)]`.
 */
@Component({
  selector: 'rs-qty-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => QtyStepperComponent), multi: true },
  ],
  templateUrl: './qty-stepper.component.html',
  styleUrl: './qty-stepper.component.scss',
  host: { '[class.is-disabled]': 'isDisabled()' },
})
export class QtyStepperComponent implements ControlValueAccessor {
  readonly value = model(1);
  readonly min = input(1);
  readonly max = input<number | null>(null);
  readonly stepSize = input(1);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Accessible names (Spanish copy comes from the app). */
  readonly label = input('');
  readonly decrementLabel = input('');
  readonly incrementLabel = input('');

  private readonly formDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.formDisabled());
  protected readonly atMin = computed(() => this.value() <= this.min());
  protected readonly atMax = computed(() => this.max() !== null && this.value() >= (this.max() as number));

  private onChange: (value: number) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  protected step(direction: 1 | -1): void {
    this.set(this.value() + direction * this.stepSize());
  }

  protected commit(raw: string): void {
    const parsed = Number(raw.replace(',', '.'));
    this.set(Number.isFinite(parsed) ? Math.round(parsed) : this.value());
  }

  private set(next: number): void {
    const max = this.max();
    const clamped = Math.max(this.min(), max === null ? next : Math.min(max, next));
    if (clamped !== this.value()) {
      this.value.set(clamped);
      this.onChange(clamped);
    }
  }

  writeValue(value: number | null): void {
    this.value.set(value ?? this.min());
  }
  registerOnChange(fn: (value: number) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }
}
