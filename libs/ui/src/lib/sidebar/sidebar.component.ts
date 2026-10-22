import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';

export interface NavItem {
  label: string;
  icon: IconName;
  route: string;
  /** Optional stable identifier. */
  key?: string;
  /** Optional count shown at the end of the item (not in Figma, kept for the ERP). */
  badge?: number;
  /** Forces the Figma `State=Current` look (otherwise derived from the active route). */
  current?: boolean;
  /** Figma `State=Disabled`: rendered as non-interactive text. */
  disabled?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Figma: Sidebar Current=Home|Inventory|... (248 px, 3 groups) built from Sidebar/NavItem
 * (State=Default|Hover|Current|Focus|Disabled). States are CSS; Current comes from the router (or `item.current`).
 * Bottom area (SIAT status, version) is projected: `<div rsSidebarFooter>`.
 */
@Component({
  selector: 'rs-sidebar',
  imports: [RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
})
export class SidebarComponent {
  readonly groups = input.required<NavGroup[]>();
  /** Wordmark text (Figma `brand/wordmark`; per company). */
  readonly brandName = input('');
  /** Glyph inside the red MapMarker pin (Figma uses the "bearing" glyph). */
  readonly brandIcon = input<IconName>('inventory');
  readonly homeLink = input('/');
  /** Accessible name of the navigation landmark (Spanish copy comes from the app). */
  readonly navLabel = input('');
}
