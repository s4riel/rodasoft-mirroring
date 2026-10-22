import { booleanAttribute, ChangeDetectionStrategy, Component, computed, forwardRef, input, model, signal } from '@angular/core';
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
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => PriceRangeComponent), multi: true }],
  template: `
    @if (label()) {
      <span class="label">{{ label() }}</span>
    }
    <div class="slider" [style.--from]="fromPct() + '%'" [style.--to]="toPct() + '%'">
      <div class="track"><div class="fill"></div></div>
      <input
        type="range"
        class="thumb"
        [attr.aria-label]="lowLabel() || null"
        [min]="min()"
        [max]="max()"
        [step]="step()"
        [value]="low()"
        [disabled]="isDisabled()"
        (input)="setLow($any($event.target).valueAsNumber)"
        (blur)="onTouched()"
      />
      <input
        type="range"
        class="thumb"
        [attr.aria-label]="highLabel() || null"
        [min]="min()"
        [max]="max()"
        [step]="step()"
        [value]="high()"
        [disabled]="isDisabled()"
        (input)="setHigh($any($event.target).valueAsNumber)"
        (blur)="onTouched()"
      />
    </div>
    <div class="fields">
      <label class="field">
        <span class="field-label">{{ lowLabel() }}</span>
        <span class="box">
          @if (prefix()) {
            <span class="prefix">{{ prefix() }}</span>
          }
          <input #lowField type="number" class="num" [min]="min()" [max]="max()" [step]="step()" [value]="low()" [disabled]="isDisabled()"
            (change)="setLow(lowField.valueAsNumber); lowField.value = '' + low()" (blur)="onTouched()" />
        </span>
      </label>
      <label class="field">
        <span class="field-label">{{ highLabel() }}</span>
        <span class="box">
          @if (prefix()) {
            <span class="prefix">{{ prefix() }}</span>
          }
          <input #highField type="number" class="num" [min]="min()" [max]="max()" [step]="step()" [value]="high()" [disabled]="isDisabled()"
            (change)="setHigh(highField.valueAsNumber); highField.value = '' + high()" (blur)="onTouched()" />
        </span>
      </label>
    </div>
  `,
  styles: `
    :host {
      display: grid;
      gap: var(--space-4);
      color: var(--text-primary);
    }
    :host(.is-disabled) {
      opacity: 0.55;
    }
    .label {
      font-size: var(--label-md-size);
      line-height: var(--label-md-line-height);
      font-weight: var(--label-md-weight);
    }
    .slider {
      --_thumb: 20px; /* Figma thumb size, no token */
      position: relative;
      height: var(--_thumb);
    }
    .track {
      position: absolute;
      left: calc(var(--_thumb) / 2);
      right: calc(var(--_thumb) / 2);
      top: 50%;
      height: 4px; /* Figma track thickness, no token */
      transform: translateY(-50%);
      border-radius: var(--radius-full);
      background: var(--border-default);
    }
    .fill {
      position: absolute;
      top: 0;
      bottom: 0;
      left: var(--from);
      right: calc(100% - var(--to));
      border-radius: var(--radius-full);
      background: var(--action-primary);
    }
    .thumb {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      background: transparent;
      pointer-events: none;
      appearance: none;
      -webkit-appearance: none;
    }
    .thumb::-webkit-slider-runnable-track {
      background: transparent;
      height: var(--_thumb);
    }
    .thumb::-moz-range-track {
      background: transparent;
    }
    .thumb::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: var(--_thumb);
      height: var(--_thumb);
      border-radius: var(--radius-full);
      border: var(--stroke-focus) solid var(--action-primary);
      background: var(--bg-surface);
      cursor: grab;
      pointer-events: auto;
    }
    .thumb::-moz-range-thumb {
      width: var(--_thumb);
      height: var(--_thumb);
      box-sizing: border-box;
      border-radius: var(--radius-full);
      border: var(--stroke-focus) solid var(--action-primary);
      background: var(--bg-surface);
      cursor: grab;
      pointer-events: auto;
    }
    .thumb:hover:not(:disabled)::-webkit-slider-thumb {
      background: var(--bg-surface-2);
    }
    .thumb:active:not(:disabled)::-webkit-slider-thumb {
      background: var(--action-primary-soft);
      cursor: grabbing;
    }
    .thumb:focus-visible {
      outline: none;
    }
    .thumb:focus-visible::-webkit-slider-thumb {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    .thumb:focus-visible::-moz-range-thumb {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    .thumb:disabled::-webkit-slider-thumb {
      cursor: not-allowed;
    }
    .fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--space-3);
    }
    .field {
      display: grid;
      gap: var(--space-2);
    }
    .field-label {
      font-size: var(--label-md-size);
      line-height: var(--label-md-line-height);
      font-weight: var(--label-md-weight);
    }
    .box {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      height: var(--size-control-md);
      padding: 0 var(--space-3);
      border: var(--stroke-default) solid var(--border-control);
      border-radius: var(--radius-sm);
      background: var(--bg-surface);
    }
    .box:hover {
      border-color: var(--text-primary);
    }
    .box:focus-within {
      border-color: var(--focus-control);
      box-shadow: 0 0 0 var(--stroke-focus) var(--focus-control);
    }
    .prefix {
      color: var(--text-muted);
      font-size: var(--body-md-size);
    }
    .num {
      flex: 1;
      min-width: 0;
      height: 100%;
      padding: 0;
      border: 0;
      outline: none;
      background: transparent;
      font-family: var(--font-family-ui);
      font-size: var(--body-md-size);
      font-variant-numeric: tabular-nums;
      appearance: textfield;
      -moz-appearance: textfield;
    }
  `,
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
