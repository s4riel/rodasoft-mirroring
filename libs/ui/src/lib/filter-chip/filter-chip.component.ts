import { booleanAttribute, ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type FilterChipSize = 'm' | 'l';

/**
 * Toggle filter chip (Figma: FilterChip Size=M|L, Selected=Off|On, State=Default|Hover|Pressed|Focus|Disabled).
 * State is CSS only (:hover/:active/:focus-visible/disabled). `selected` is a two-way model.
 * Content: text via `label` or the default slot; optional `<rs-chip-media>` (Figma ShowMedia/Media swap).
 * When selected, a close glyph (16 px) is shown at the end: clicking the chip toggles it off.
 */
@Component({
  selector: 'rs-filter-chip',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-size]': 'size()',
    '[attr.data-selected]': 'selected()',
    '[attr.data-disabled]': 'disabled() || null',
  },
  template: `
    <button type="button" class="chip" [disabled]="disabled()" [attr.aria-pressed]="selected()" (click)="toggle()">
      @if (showMedia()) {
        <ng-content select="rs-chip-media" />
      }
      <span class="text">{{ label() }}<ng-content /></span>
      @if (selected()) {
        <rs-icon class="close" name="close" [size]="16" />
      }
    </button>
  `,
  styles: `
    :host { display: inline-flex; }
    .chip {
      --_bg: var(--border-default); /* Figma: gray-200 */
      --_ring: transparent;
      --_ring-w: 0px;
      --_fg: var(--text-primary);
      display: inline-flex;
      align-items: center;
      height: 40px; /* Figma Size=M */
      padding: 0 0 0 6px; /* Figma: 6 + media; the text carries px 8 */
      border: 0;
      border-radius: var(--radius-full);
      background: var(--_bg);
      color: var(--_fg);
      font-family: inherit;
      font-size: var(--label-md-size);
      font-weight: var(--label-md-weight);
      line-height: 1.2;
      cursor: pointer;
      white-space: nowrap;
      /* the Figma stroke is drawn inset so the chip never changes size between states */
      box-shadow: inset 0 0 0 var(--_ring-w) var(--_ring);
      transition: background var(--motion-fast) var(--ease-out), box-shadow var(--motion-fast) var(--ease-out);
    }
    :host([data-size='l']) .chip { height: 48px; font-size: var(--body-lg-size); padding-left: 10px; }
    .text { padding: 0 8px; }
    .close { margin-left: -2px; }

    /* Selected = On */
    :host([data-selected='true']) .chip {
      --_bg: var(--brand-primary-soft);
      --_ring: var(--brand-primary);
      --_ring-w: 1.5px; /* Figma: 1.5 */
      --_fg: var(--brand-accent-on-page);
      padding-right: 12px;
    }
    :host([data-selected='true'][data-size='l']) .chip { padding-right: 14px; }
    :host([data-selected='true']) .text { padding: 0 6px 0 8px; }

    /* States (Off): hover gray-300, pressed gray-300 + control stroke, focus control-focus stroke */
    .chip:hover:not(:disabled) { --_bg: color-mix(in srgb, var(--border-default), var(--text-primary) 12%); }
    .chip:active:not(:disabled) {
      --_bg: color-mix(in srgb, var(--border-default), var(--text-primary) 12%);
      --_ring: var(--border-control);
      --_ring-w: 1.5px;
    }
    :host([data-selected='true']) .chip:hover:not(:disabled) { --_bg: color-mix(in srgb, var(--brand-primary-soft), var(--brand-primary) 10%); }
    :host([data-selected='true']) .chip:active:not(:disabled) {
      --_bg: color-mix(in srgb, var(--brand-primary-soft), var(--brand-primary) 18%);
      --_ring: var(--brand-primary);
    }
    .chip:focus-visible {
      outline: none;
      --_ring: var(--focus-control);
      --_ring-w: var(--stroke-focus);
    }
    .chip:disabled { opacity: 0.5; cursor: not-allowed; --_fg: var(--text-muted); }
  `,
})
export class FilterChipComponent {
  readonly size = input<FilterChipSize>('m');
  readonly selected = model(false);
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Figma ShowMedia: hide the projected media. */
  readonly showMedia = input(true, { transform: booleanAttribute });
  /** Figma Label. Alternatively project the text. */
  readonly label = input<string>('');

  protected toggle(): void {
    if (!this.disabled()) {
      this.selected.update((v) => !v);
    }
  }
}
