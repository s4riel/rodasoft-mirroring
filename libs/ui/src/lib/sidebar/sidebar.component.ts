import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';

export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  route: string;
  badge?: number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Menú lateral del ERP (Figma: Sidebar Current=Home|Sales|…, 3 grupos).
 * El estado SIAT y el usuario se proyectan en el pie: <div rsSidebarFooter>.
 */
@Component({
  selector: 'rs-sidebar',
  imports: [RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="brand" routerLink="/">
      <span class="logo">{{ brandName() }}</span>
      <span class="logo-bar" aria-hidden="true"></span>
    </a>
    <nav aria-label="Módulos">
      @for (group of groups(); track group.label) {
        <p class="rs-eyebrow group">{{ group.label }}</p>
        <ul>
          @for (item of group.items; track item.key) {
            <li>
              <a [routerLink]="item.route" routerLinkActive="current" [routerLinkActiveOptions]="{ exact: item.route === '/' }"
                #rla="routerLinkActive" [attr.aria-current]="rla.isActive ? 'page' : null">
                <rs-icon [name]="item.icon" [size]="20" />
                <span>{{ item.label }}</span>
                @if (item.badge) {
                  <span class="badge">{{ item.badge }}</span>
                }
              </a>
            </li>
          }
        </ul>
      }
    </nav>
    <div class="footer"><ng-content select="[rsSidebarFooter]" /></div>
  `,
  styles: `
    :host {
      display: flex; flex-direction: column; width: var(--sidebar-width); height: 100%;
      padding: var(--space-5) var(--space-3); background: var(--bg-surface);
      border-right: 1px solid var(--border-default); overflow-y: auto;
    }
    .brand { display: inline-grid; gap: 4px; padding: 0 var(--space-3) var(--space-5); text-decoration: none; justify-self: start; }
    .logo { font-weight: 600; font-size: 14px; letter-spacing: var(--tracking-logo); text-transform: uppercase; }
    .logo-bar { width: 28px; height: 3px; border-radius: 2px; background: var(--brand-primary); }
    .group { padding: var(--space-4) var(--space-3) var(--space-2); }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
    a:not(.brand) {
      display: flex; align-items: center; gap: var(--space-3); height: 40px; padding: 0 var(--space-3);
      border-radius: var(--radius-md); color: var(--text-muted); text-decoration: none; font-weight: 500;
    }
    a:not(.brand):hover { background: var(--bg-surface-2); color: var(--text-primary); }
    a.current { background: var(--action-primary); color: var(--action-on-primary); }
    .badge {
      margin-left: auto; min-width: 20px; height: 20px; padding: 0 6px; border-radius: var(--radius-full);
      background: var(--brand-primary); color: var(--brand-on-primary); font-size: 11px; font-weight: 700;
      display: inline-grid; place-items: center;
    }
    .footer { margin-top: auto; padding-top: var(--space-4); }
  `,
})
export class SidebarComponent {
  readonly groups = input.required<NavGroup[]>();
  readonly brandName = input('Rodalaser');
}
