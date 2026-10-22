import { booleanAttribute, ChangeDetectionStrategy, Component, computed, forwardRef, input, model, signal } from '@angular/core';
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
  template: `
    <label class="root" [class.disabled]="isDisabled()">
      <input
        class="native"
        type="checkbox"
        role="switch"
        [attr.id]="inputId()"
        [attr.name]="name() || null"
        [attr.aria-checked]="checked()"
        [checked]="checked()"
        [disabled]="isDisabled()"
        (change)="onToggle($event)"
        (blur)="onTouched()"
      />
      <span class="track" aria-hidden="true"><span class="thumb"></span></span>
      <span class="text"><ng-content /></span>
      @if (statusText()) {
        <span class="status">{{ statusText() }}</span>
      }
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
      top: 0;
      width: 44px;
      height: 28px;
      margin: 0;
      opacity: 0;
      cursor: inherit;
    }
    .track {
      position: relative;
      flex: none;
      width: 44px; /* Figma Track 44 x 28 */
      height: 28px;
      border: var(--stroke-default) solid var(--border-control);
      border-radius: var(--radius-full);
      background: var(--bg-surface);
      transition: background var(--motion-fast) var(--ease-out);
    }
    .thumb {
      position: absolute;
      top: 3px; /* (28 - 20 thumb) / 2 - 1 border */
      left: 3px;
      width: 20px;
      height: 20px;
      border: var(--stroke-default) solid var(--border-control);
      border-radius: var(--radius-full);
      background: var(--bg-surface);
      transition: transform var(--motion-fast) var(--ease-out);
    }
    .native:checked + .track {
      border-color: var(--action-primary);
      background: var(--action-primary);
    }
    .native:checked + .track .thumb {
      border-color: var(--action-on-primary);
      background: var(--action-on-primary);
      transform: translateX(16px);
    }
    .root:hover .native:not(:disabled) + .track {
      background: var(--bg-surface-2);
    }
    .root:hover .native:checked:not(:disabled) + .track {
      background: var(--action-primary-hover);
    }
    .root:active .native:not(:disabled) + .track {
      background: var(--action-primary-soft);
    }
    .root:active .native:checked:not(:disabled) + .track {
      background: var(--action-primary-pressed);
    }
    .native:disabled:not(:checked) + .track {
      background: var(--action-primary-soft);
    }
    .root:has(.native:focus-visible) {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    .status {
      color: var(--text-muted);
      font-family: var(--font-family-mono);
      font-size: var(--mono-md-size);
      line-height: var(--mono-md-line-height);
      font-weight: var(--mono-md-weight);
      letter-spacing: var(--mono-md-tracking);
    }
    .text:empty {
      display: none;
    }
    @media (prefers-reduced-motion: reduce) {
      .thumb,
      .track {
        transition: none;
      }
    }
  `,
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
