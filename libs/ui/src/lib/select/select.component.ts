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
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icons';

export interface SelectOption<T = unknown> {
  value: T;
  label: string;
  disabled?: boolean;
}

let nextSelectId = 0;

/**
 * Figma: Select (State = Default | Hover | Pressed | Focus | Error | Disabled, Open = Closed | Open).
 * Custom listbox (WAI-ARIA combobox + listbox) with keyboard support and ControlValueAccessor.
 *
 *   <rs-select inputId="branch" [options]="branches" placeholder="Selecciona…" formControlName="branch" />
 *
 * Keyboard: ArrowDown/ArrowUp (open / move), Home/End, Enter or Space (open / choose), Escape (close),
 * Tab (close), letters (typeahead). The `open` model also lets the showcase render the Open state statically.
 * State=Hover/Pressed/Focus are CSS; `invalid` (or an ancestor `rs-field` with an error) draws State=Error.
 */
@Component({
  selector: 'rs-select',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectComponent), multi: true }],
  host: {
    '[class.rs-select--open]': 'open()',
    '(document:click)': 'onDocumentClick($event)',
  },
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
})
export class SelectComponent implements ControlValueAccessor {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly options = input<readonly SelectOption[]>([]);
  readonly placeholder = input('');
  /** Selected value (two-way). Also driven by forms through the ControlValueAccessor. */
  readonly value = model<unknown>(null);
  /** Figma Open = Open. Two-way so the component can close itself. */
  readonly open = model(false);
  /** Figma State=Error. */
  readonly invalid = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Figma ShowLeadingIcon: glyph name rendered at 16 px before the value. */
  readonly leadingIcon = input<IconName | null>(null);
  /** id of the trigger button; must match `rs-field`'s `forId`. */
  readonly inputId = input<string>(`rs-select-${nextSelectId++}`);
  /** Accessible name when there is no associated label. */
  readonly ariaLabel = input<string>('');

  protected readonly listId = `rs-select-list-${nextSelectId++}`;
  protected readonly activeIndex = signal(-1);
  private readonly cvaDisabled = signal(false);
  protected readonly isDisabled = computed(() => this.disabled() || this.cvaDisabled());

  protected readonly selectedIndex = computed(() =>
    this.options().findIndex((o) => Object.is(o.value, this.value())),
  );
  protected readonly selectedOption = computed(() => this.options()[this.selectedIndex()] ?? null);

  private onChange: (value: unknown) => void = () => undefined;
  private onTouched: () => void = () => undefined;
  private typeahead = '';
  private typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

  protected optionId(index: number): string {
    return `${this.listId}-opt-${index}`;
  }

  // ── ControlValueAccessor ──
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
    if (isDisabled) this.open.set(false);
  }

  // ── Open / close ──
  protected toggle(): void {
    if (this.open()) this.close();
    else this.show();
  }

  private show(): void {
    if (this.isDisabled() || this.open()) return;
    const selected = this.selectedIndex();
    this.activeIndex.set(selected >= 0 && !this.options()[selected]?.disabled ? selected : this.step(-1, 1));
    this.open.set(true);
  }

  private close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.onTouched();
  }

  protected onBlur(): void {
    // Touched only when the list is not open (clicking an option keeps focus on the trigger).
    if (!this.open()) this.onTouched();
  }

  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }

  protected onHover(index: number): void {
    if (!this.options()[index]?.disabled) this.activeIndex.set(index);
  }

  protected choose(index: number): void {
    const option = this.options()[index];
    if (!option || option.disabled) return;
    this.value.set(option.value);
    this.onChange(option.value);
    this.close();
  }

  // ── Keyboard ──
  protected onKeydown(event: KeyboardEvent): void {
    if (this.isDisabled()) return;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.open()) {
          this.show();
          return;
        }
        this.moveActive(this.step(this.activeIndex(), event.key === 'ArrowDown' ? 1 : -1));
        return;
      }
      case 'Home':
      case 'End': {
        if (!this.open()) return;
        event.preventDefault();
        this.moveActive(event.key === 'Home' ? this.step(-1, 1) : this.step(this.options().length, -1));
        return;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        if (this.open()) this.choose(this.activeIndex());
        else this.show();
        return;
      }
      case 'Escape': {
        if (this.open()) {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
        return;
      }
      case 'Tab': {
        this.close();
        return;
      }
      default: {
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
          this.search(event.key);
      }
    }
  }

  /** Next enabled option index from `from` in direction `dir`; stays on `from` when none is found. */
  private step(from: number, dir: 1 | -1): number {
    const options = this.options();
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) {
      if (!options[i].disabled) return i;
    }
    return from >= 0 && from < options.length ? from : -1;
  }

  private moveActive(index: number): void {
    if (index < 0) return;
    this.activeIndex.set(index);
    this.host.nativeElement.ownerDocument
      .getElementById(this.optionId(index))
      ?.scrollIntoView?.({ block: 'nearest' });
  }

  private search(char: string): void {
    clearTimeout(this.typeaheadTimer);
    this.typeahead += char.toLowerCase();
    this.typeaheadTimer = setTimeout(() => (this.typeahead = ''), 500);
    const options = this.options();
    const start = this.open() ? this.activeIndex() : this.selectedIndex();
    // Same letter repeated cycles through matches; otherwise match the accumulated prefix from the current item.
    const cycle = this.typeahead.split('').every((c) => c === this.typeahead[0]);
    const prefix = cycle ? this.typeahead[0] : this.typeahead;
    for (let n = 1; n <= options.length; n++) {
      const i = (start + n + options.length) % options.length;
      const option = options[i];
      if (!option.disabled && option.label.toLowerCase().startsWith(prefix)) {
        if (this.open()) this.moveActive(i);
        else {
          this.value.set(option.value);
          this.onChange(option.value);
        }
        return;
      }
    }
  }
}
