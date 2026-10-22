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

export type PriceRangeValue = readonly [number, number];

/**
 * Figma: PriceRange State=Default|Hover|Pressed|Focus|Disabled.
 * Dual slider + two numeric fields. ControlValueAccessor over `[min, max]`; also usable with `[(value)]`.
 * Without a value the full range `[min, max]` is selected.
 */
@Component({
  selector: 'rs-price-range',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PriceRangeComponent), multi: true },
  ],
  templateUrl: './price-range.component.html',
  styleUrl: './price-range.component.scss',
  host: { '[class.is-disabled]': 'isDisabled()' },
})
export class PriceRangeComponent implements ControlValueAccessor {
  /** Selected `[from, to]`; `null` means the whole range. */
  readonly value = model<PriceRangeValue | null>(null);
  readonly min = input(0);
  readonly max = input(1000);
  readonly step = input(1);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Visible / accessible texts (Spanish copy comes from the app). */
  readonly label = input('');
  readonly lowLabel = input('');
  readonly highLabel = input('');
  /** Currency prefix inside the numeric fields, e.g. "Bs". */
  readonly prefix = input('');

  private readonly formDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.formDisabled());
  protected readonly low = computed(() => this.value()?.[0] ?? this.min());
  protected readonly high = computed(() => this.value()?.[1] ?? this.max());
  protected readonly fromPct = computed(() => this.pct(this.low()));
  protected readonly toPct = computed(() => this.pct(this.high()));

  private onChange: (value: PriceRangeValue) => void = () => undefined;
  protected onTouched: () => void = () => undefined;

  private pct(n: number): number {
    const span = this.max() - this.min();
    return span <= 0 ? 0 : Math.min(100, Math.max(0, ((n - this.min()) / span) * 100));
  }

  private clamp(n: number): number {
    return Math.min(this.max(), Math.max(this.min(), Number.isFinite(n) ? n : this.min()));
  }

  protected setLow(n: number): void {
    this.commit([Math.min(this.clamp(n), this.high()), this.high()]);
  }

  protected setHigh(n: number): void {
    this.commit([this.low(), Math.max(this.clamp(n), this.low())]);
  }

  private commit(next: PriceRangeValue): void {
    this.value.set(next);
    this.onChange(next);
  }

  writeValue(value: PriceRangeValue | null): void {
    this.value.set(value);
  }
  registerOnChange(fn: (value: PriceRangeValue) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.formDisabled.set(isDisabled);
  }
}
