import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
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

/** Figma: RowMenu. Action menu of a table row; the parent decides which items the user may see. */
@Component({
  selector: 'rs-row-menu',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'menu' },
  templateUrl: './row-menu.component.html',
  styleUrl: './row-menu.component.scss',
})
export class RowMenuComponent {
  readonly items = input.required<readonly RowMenuItem[]>();
  readonly selected = output<string>();
}
