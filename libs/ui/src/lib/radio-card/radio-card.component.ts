import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  forwardRef,
  inject,
  input,
  model,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

/**
 * Group of RadioCards (ControlValueAccessor). Owns the selected `value` and arrow-key navigation.
 * <rs-radio-card-group [(ngModel)]="shipping"> <rs-radio-card value="pickup" label="…"/> … </rs-radio-card-group>
 */
@Component({
  selector: 'rs-radio-card-group',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => RadioCardGroupComponent), multi: true },
  ],
  host: { role: 'radiogroup', '(keydown)': 'onKeydown($event)' },
  templateUrl: './radio-card-group.component.html',
  styleUrl: './radio-card-group.component.scss',
})
export class RadioCardGroupComponent implements ControlValueAccessor {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Current value. Also usable as `[(value)]` without forms. */
  readonly value = model<unknown>(null);
  readonly disabled = model(false);

  private onChange: (value: unknown) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  select(value: unknown): void {
    if (this.disabled() || Object.is(this.value(), value)) {
      return;
    }
    this.value.set(value);
    this.onChange(value);
    this.onTouched();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'];
    if (!keys.includes(event.key)) {
      return;
    }
    const radios = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])'),
    );
    if (radios.length === 0) {
      return;
    }
    const current = radios.indexOf(event.target as HTMLElement);
    const forward = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    const next = radios[(current + (forward ? 1 : -1) + radios.length) % radios.length];
    event.preventDefault();
    next.focus();
    next.click();
  }

  writeValue(value: unknown): void {
    this.value.set(value);
  }
  registerOnChange(fn: (value: unknown) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }
}

/**
 * Selectable card with radio semantics (Figma: RadioCard Checked=On|Off, State=Default|Hover|Pressed|Focus|Disabled).
 * Inside a `rs-radio-card-group` the checked state comes from the group's value; standalone use `[(checked)]`.
 * Text: `label` + `description`. Slot `[slot=media]` for a leading icon or illustration.
 */
@Component({
  selector: 'rs-radio-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'radio',
    '[attr.aria-checked]': 'isChecked()',
    '[attr.aria-disabled]': 'isDisabled() || null',
    '[attr.data-checked]': 'isChecked()',
    '[attr.tabindex]': 'isDisabled() ? -1 : 0',
    '(click)': 'choose()',
    '(keydown.space)': 'onSpace($event)',
  },
  templateUrl: './radio-card.component.html',
  styleUrl: './radio-card.component.scss',
})
export class RadioCardComponent {
  protected readonly group = inject(RadioCardGroupComponent, { optional: true });

  readonly value = input<unknown>(null);
  readonly label = input<string>('');
  readonly description = input<string>('');
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Standalone checked state (ignored inside a group). */
  readonly checked = model(false);

  protected readonly isDisabled = computed(() => this.disabled() || (this.group?.disabled() ?? false));
  protected readonly isChecked = computed(() =>
    this.group ? Object.is(this.group.value(), this.value()) : this.checked(),
  );

  protected choose(): void {
    if (this.isDisabled()) {
      return;
    }
    if (this.group) {
      this.group.select(this.value());
    } else {
      this.checked.set(true);
    }
  }

  protected onSpace(event: Event): void {
    event.preventDefault();
    this.choose();
  }
}
