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
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RadioGroupComponent), multi: true }],
  host: {
    role: 'radiogroup',
    '[class.rs-radio-group--horizontal]': "orientation() === 'horizontal'",
    '[attr.aria-label]': 'ariaLabel() || null',
    '[attr.aria-invalid]': 'invalid() ? "true" : null',
    '[attr.aria-disabled]': 'isDisabled() ? "true" : null',
  },
  template: `<ng-content />`,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: var(--space-3);
    }
    :host(.rs-radio-group--horizontal) {
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--space-6);
    }
  `,
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
  template: `
    <label class="root" [class.disabled]="isDisabled()">
      <input
        class="native"
        type="radio"
        [attr.name]="group?.name() ?? (name() || null)"
        [attr.id]="inputId() || null"
        [checked]="isChecked()"
        [disabled]="isDisabled()"
        (change)="onSelect()"
        (blur)="group?.markTouched()"
      />
      <span class="circle" aria-hidden="true"></span>
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
    .circle {
      position: relative;
      flex: none;
      width: 20px; /* Figma Control 20 x 20 */
      height: 20px;
      border: var(--stroke-default) solid var(--border-control);
      border-radius: var(--radius-full);
      background: var(--bg-surface);
      transition: background var(--motion-fast) var(--ease-out);
    }
    .circle::after {
      content: '';
      position: absolute;
      inset: 50% auto auto 50%;
      width: 10px; /* inner dot geometry from the Figma control */
      height: 10px;
      border-radius: var(--radius-full);
      background: var(--action-primary);
      transform: translate(-50%, -50%) scale(0);
      transition: transform var(--motion-fast) var(--ease-out);
    }
    .native:checked + .circle::after {
      transform: translate(-50%, -50%) scale(1);
    }
    .root:hover .native:not(:disabled) + .circle {
      background: var(--bg-surface-2);
    }
    .root:active .native:not(:disabled) + .circle {
      background: var(--action-primary-soft);
    }
    .native:disabled + .circle {
      background: var(--action-primary-soft);
    }
    .native:disabled + .circle::after {
      background: var(--text-muted);
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
