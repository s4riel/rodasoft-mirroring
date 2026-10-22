import { booleanAttribute, ChangeDetectionStrategy, Component, computed, forwardRef, input, model, signal } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Figma: QtyStepper State=Default|Hover|Pressed|Focus|Disabled (minus, value, plus).
 * ControlValueAccessor over a number; also usable with `[(value)]`.
 */
@Component({
  selector: 'rs-qty-stepper',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => QtyStepperComponent), multi: true }],
  template: `
    <button
      type="button"
      class="btn"
      [attr.aria-label]="decrementLabel() || null"
      [disabled]="isDisabled() || atMin()"
      (click)="step(-1)"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="M5 12h14" />
      </svg>
    </button>
    <input
      #field
      class="value"
      type="text"
      inputmode="numeric"
      role="spinbutton"
      [attr.aria-label]="label() || null"
      [attr.aria-valuenow]="value()"
      [attr.aria-valuemin]="min()"
      [attr.aria-valuemax]="max()"
      [value]="value()"
      [disabled]="isDisabled()"
      (change)="commit(field.value); field.value = '' + value()"
      (blur)="onTouched()"
      (keydown.arrowup)="step(1); $event.preventDefault()"
      (keydown.arrowdown)="step(-1); $event.preventDefault()"
    />
    <button
      type="button"
      class="btn"
      [attr.aria-label]="incrementLabel() || null"
      [disabled]="isDisabled() || atMax()"
      (click)="step(1)"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      width: 104px; /* Figma set width, no token */
      height: var(--size-control-md);
      border: var(--stroke-default) solid var(--border-control);
      border-radius: var(--radius-full);
      background: var(--bg-surface);
      color: var(--text-primary);
      overflow: hidden;
    }
    :host(:hover:not(.is-disabled)) {
      border-color: var(--text-primary);
    }
    :host(:focus-within) {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    :host(.is-disabled) {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 32px; /* Figma button hit area, no token */
      height: 100%;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    .btn:hover:not(:disabled) {
      background: var(--bg-surface-2);
    }
    .btn:active:not(:disabled) {
      background: var(--action-primary-soft);
    }
    .btn:disabled {
      color: var(--text-muted);
      cursor: not-allowed;
    }
    .value {
      flex: 1;
      min-width: 0;
      height: 100%;
      padding: 0;
      border: 0;
      outline: none;
      background: transparent;
      text-align: center;
      font-family: var(--font-family-ui);
      font-size: var(--body-md-strong-size);
      font-weight: var(--body-md-strong-weight);
      font-variant-numeric: tabular-nums;
    }
  `,
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
