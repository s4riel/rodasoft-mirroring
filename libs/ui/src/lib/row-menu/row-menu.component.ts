import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';

export interface RowMenuItem {
  key: string;
  label: string;
  icon: IconName;
  /** Destructive action (Figma: status/danger text). */
  danger?: boolean;
  /** Draws the divider above the item. */
  separated?: boolean;
}

/**
 * Figma: RowMenu. Action menu of a table row; the parent decides which items the user may see.
 * Keyboard: focus lands on the first item when it opens; ArrowUp/ArrowDown/Home/End move between items.
 */
@Component({
  selector: 'rs-row-menu',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'menu',
    '(keydown.arrowdown)': 'move($event, 1)',
    '(keydown.arrowup)': 'move($event, -1)',
    '(keydown.home)': 'moveTo($event, 0)',
    '(keydown.end)': 'moveTo($event, -1)',
  },
  templateUrl: './row-menu.component.html',
  styleUrl: './row-menu.component.scss',
})
export class RowMenuComponent {
  readonly items = input.required<readonly RowMenuItem[]>();
  readonly selected = output<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => this.buttons()[0]?.focus());
  }

  protected move(event: Event, step: 1 | -1) {
    const buttons = this.buttons();
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = current < 0 ? (step === 1 ? 0 : buttons.length - 1) : (current + step + buttons.length) % buttons.length;
    buttons[next].focus();
  }

  /** `index` -1 means the last item. */
  protected moveTo(event: Event, index: number) {
    const buttons = this.buttons();
    if (!buttons.length) return;
    event.preventDefault();
    buttons.at(index)?.focus();
  }

  private buttons(): HTMLButtonElement[] {
    return Array.from(this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'));
  }
}
