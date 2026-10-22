import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

export interface SubNavItem {
  key: string;
  label: string;
  /** With a route the item is an `<a routerLink>` (active also when the route is active); otherwise a button. */
  route?: string;
  /** Optional count badge (Figma `ShowBadge`). */
  badge?: string | number;
  disabled?: boolean;
}

/**
 * Figma: SubNav Module=Sales|Invoicing|Inventory|... built from SubNav/Item (State=Default|Active, optional badge).
 * Items come via input (e.g. Inventory: Productos, Equivalencias, Almacenes, Transferencias, Ajustes, Kardex).
 */
@Component({
  selector: 'rs-sub-nav',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sub-nav.component.html',
  styleUrl: './sub-nav.component.scss',
})
export class SubNavComponent {
  readonly items = input.required<readonly SubNavItem[]>();
  /** Key of the active item (Figma `State=Active`). */
  readonly activeKey = model<string | undefined>(undefined);
  /** Accessible name of the navigation landmark. */
  readonly label = input('');
}
