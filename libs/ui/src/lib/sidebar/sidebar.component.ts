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
  template: `
    <a class="logo" [routerLink]="homeLink()" [attr.aria-label]="brandName()">
      <span class="pin" aria-hidden="true"><rs-icon [name]="brandIcon()" [size]="16" /></span>
      <span class="wordmark">{{ brandName() }}</span>
    </a>
    <nav class="body" [attr.aria-label]="navLabel() || null">
      @for (group of groups(); track group.label) {
        <p class="group">{{ group.label }}</p>
        @for (item of group.items; track item.route) {
          @if (item.disabled) {
            <span class="item disabled" aria-disabled="true">
              <rs-icon [name]="item.icon" [size]="20" />
              <span class="text">{{ item.label }}</span>
            </span>
          } @else {
            <a
              class="item"
              [routerLink]="item.route"
              routerLinkActive="current"
              [routerLinkActiveOptions]="{ exact: item.route === '/' }"
              [class.current]="item.current"
              #rla="routerLinkActive"
              [attr.aria-current]="rla.isActive || item.current ? 'page' : null"
            >
              <span class="indicator" aria-hidden="true"></span>
              <rs-icon [name]="item.icon" [size]="20" />
              <span class="text">{{ item.label }}</span>
              @if (item.badge) {
                <span class="badge">{{ item.badge }}</span>
              }
            </a>
          }
        }
      }
    </nav>
    <div class="footer"><ng-content select="[rsSidebarFooter]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
      width: var(--sidebar-width);
      height: 100%;
      padding: var(--space-4);
      overflow: hidden;
      background: var(--nav-surface);
      border: var(--stroke-default) solid var(--border-default);
    }
    .logo {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--text-primary);
      text-decoration: none;
      border-radius: var(--radius-xs);
    }
    .logo:focus-visible {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    .pin {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: 32px; /* Figma MapMarker pin, no token */
      height: 32px;
      border-radius: var(--radius-full);
      background: var(--brand-primary);
      color: var(--brand-on-primary);
    }
    .wordmark {
      font-family: var(--font-family-ui);
      font-size: var(--logo-wordmark-size);
      line-height: var(--logo-wordmark-line-height);
      font-weight: var(--logo-wordmark-weight);
      letter-spacing: var(--logo-wordmark-tracking);
      text-transform: uppercase;
    }
    .body {
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      gap: var(--space-1);
      min-height: 0;
      overflow-y: auto;
    }
    .group {
      margin: 0;
      padding: var(--space-4) 0 var(--space-1) var(--space-3);
      color: var(--text-muted);
      font-size: var(--eyebrow-size);
      line-height: var(--eyebrow-line-height);
      font-weight: var(--eyebrow-weight);
      letter-spacing: var(--eyebrow-tracking);
      text-transform: uppercase;
    }
    .item {
      position: relative;
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex: none;
      height: var(--size-control-md);
      padding: 0 var(--space-3);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      text-decoration: none;
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
      font-weight: var(--body-md-weight);
      letter-spacing: var(--body-md-tracking);
    }
    .text {
      flex: 1 1 0;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item:hover:not(.disabled) {
      background: var(--bg-surface-2);
    }
    .item:focus-visible {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    .indicator {
      display: none;
      position: absolute;
      left: 0;
      top: 50%;
      width: var(--space-1);
      height: var(--space-6);
      transform: translateY(-50%);
      /* nav/current-indicator is defined by the Figma Phase 3 variables; falls back to the brand accent */
      background: var(--nav-current-indicator, var(--brand-primary));
    }
    .item.current {
      background: var(--bg-surface-2);
      font-size: var(--body-md-strong-size);
      line-height: var(--body-md-strong-line-height);
      font-weight: var(--body-md-strong-weight);
      letter-spacing: var(--body-md-strong-tracking);
    }
    .item.current .indicator {
      display: block;
    }
    .item.disabled {
      background: var(--action-primary-soft);
      color: var(--text-muted);
      cursor: not-allowed;
    }
    .badge {
      display: inline-grid;
      place-items: center;
      min-width: 20px;
      height: 20px;
      padding: 0 var(--space-1);
      border-radius: var(--radius-full);
      background: var(--brand-primary);
      color: var(--brand-on-primary);
      font-size: var(--body-sm-size);
      font-weight: var(--body-md-strong-weight);
    }
    .footer {
      display: grid;
      gap: var(--space-2);
      flex: none;
    }
    .footer:empty {
      display: none;
    }
  `,
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
