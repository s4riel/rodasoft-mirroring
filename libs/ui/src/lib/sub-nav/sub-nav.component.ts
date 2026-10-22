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
  template: `
    <nav [attr.aria-label]="label() || null">
      <ul>
        @for (item of items(); track item.key) {
          <li>
            @if (item.route && !item.disabled) {
              <a
                class="item"
                [routerLink]="item.route"
                routerLinkActive="active"
                [routerLinkActiveOptions]="{ exact: false }"
                [class.active]="item.key === activeKey()"
                [attr.aria-current]="item.key === activeKey() ? 'page' : null"
                (click)="activeKey.set(item.key)"
              >
                <span class="text">{{ item.label }}</span>
                @if (item.badge !== undefined && item.badge !== '') {
                  <span class="badge">{{ item.badge }}</span>
                }
              </a>
            } @else {
              <button
                type="button"
                class="item"
                [class.active]="item.key === activeKey()"
                [disabled]="item.disabled"
                [attr.aria-current]="item.key === activeKey() ? 'page' : null"
                (click)="activeKey.set(item.key)"
              >
                <span class="text">{{ item.label }}</span>
                @if (item.badge !== undefined && item.badge !== '') {
                  <span class="badge">{{ item.badge }}</span>
                }
              </button>
            }
          </li>
        }
      </ul>
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    ul {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
      height: 45px; /* Figma: 44 item + 1 divider */
      margin: 0;
      padding: 0;
      list-style: none;
      border-bottom: var(--stroke-default) solid var(--border-default);
    }
    .item {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      height: var(--size-control-md);
      padding: 0 var(--space-3);
      border: 0;
      border-bottom: 4px solid transparent; /* Figma active indicator, no token */
      background: transparent;
      color: var(--text-muted);
      font-family: var(--font-family-ui);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
      font-weight: var(--body-md-weight);
      letter-spacing: var(--body-md-tracking);
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
    }
    .item:hover:not(:disabled) {
      color: var(--text-primary);
    }
    .item:focus-visible {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: calc(-1 * var(--stroke-focus));
    }
    .item:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .item.active {
      color: var(--text-primary);
      font-size: var(--body-md-strong-size);
      line-height: var(--body-md-strong-line-height);
      font-weight: var(--body-md-strong-weight);
      border-bottom-color: var(--brand-primary);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px; /* Figma badge size, no token */
      height: 20px;
      padding: 0 var(--space-1);
      border-radius: var(--radius-full);
      background: var(--bg-surface-2);
      color: var(--text-muted);
      font-size: var(--body-sm-size);
      line-height: var(--body-sm-line-height);
      font-weight: var(--body-sm-weight);
    }
    .item.active .badge {
      background: var(--brand-primary);
      color: var(--brand-on-primary);
    }
  `,
})
export class SubNavComponent {
  readonly items = input.required<readonly SubNavItem[]>();
  /** Key of the active item (Figma `State=Active`). */
  readonly activeKey = model<string | undefined>(undefined);
  /** Accessible name of the navigation landmark. */
  readonly label = input('');
}
