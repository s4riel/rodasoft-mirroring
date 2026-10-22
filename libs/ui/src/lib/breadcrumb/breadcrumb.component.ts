import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

export interface BreadcrumbItem {
  label: string;
  /** Router link. Without it (or on the last item) the level is plain text. */
  link?: string;
  disabled?: boolean;
}

/**
 * Figma: Breadcrumb Levels=3|4 x State (Default/Hover/Pressed/Focus/Disabled).
 * Levels = number of items; the last one is the current page (label/md, text/primary).
 * Hover/Pressed/Focus are CSS only; Disabled per item.
 */
@Component({
  selector: 'rs-breadcrumb',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="label() || null">
      <ol>
        @for (item of items(); track $index; let last = $last) {
          <li>
            @if (!last && item.link && !item.disabled) {
              <a class="item" [routerLink]="item.link">{{ item.label }}</a>
            } @else {
              <span
                class="item"
                [class.current]="last"
                [class.disabled]="item.disabled"
                [attr.aria-current]="last ? 'page' : null"
                [attr.aria-disabled]="item.disabled ? 'true' : null"
                >{{ item.label }}</span
              >
            }
            @if (!last) {
              <span class="sep" aria-hidden="true">/</span>
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    ol {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-3);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .item,
    .sep {
      font-family: var(--font-family-ui);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
      font-weight: var(--body-md-weight);
      letter-spacing: var(--body-md-tracking);
      color: var(--text-muted);
      text-decoration: none;
      white-space: nowrap;
    }
    a.item {
      border-radius: var(--radius-xs);
    }
    a.item:hover {
      color: var(--text-primary);
      text-decoration: underline;
    }
    a.item:active {
      color: var(--action-primary-pressed);
    }
    a.item:focus-visible {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    .item.current {
      font-size: var(--label-md-size);
      line-height: var(--label-md-line-height);
      font-weight: var(--label-md-weight);
      letter-spacing: var(--label-md-tracking);
      color: var(--text-primary);
    }
    .item.disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
  `,
})
export class BreadcrumbComponent {
  readonly items = input.required<readonly BreadcrumbItem[]>();
  /** Accessible name of the navigation landmark (Spanish copy lives in the app). */
  readonly label = input('');
}
