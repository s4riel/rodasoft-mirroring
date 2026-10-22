import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/** Page numbers to show; `null` is an ellipsis. Always keeps first, last and the neighbours of the current page. */
export function buildPageList(page: number, total: number): (number | null)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const wanted = new Set<number>([1, total, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => wanted.add(n));
  if (page >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => wanted.add(n));
  const sorted = [...wanted].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let prev = 0;
  for (const n of sorted) {
    if (n - prev === 2) out.push(prev + 1);
    else if (n - prev > 2) out.push(null);
    out.push(n);
    prev = n;
  }
  return out;
}

/**
 * Figma: Pagination State=Default|Hover|Pressed|Focus|Disabled.
 * Previous / next buttons plus page numbers; the selected page is filled with action/primary.
 */
@Component({
  selector: 'rs-pagination',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav [attr.aria-label]="label() || null">
      <button
        type="button"
        class="btn"
        [attr.aria-label]="previousLabel() || null"
        [disabled]="disabled() || page() <= 1"
        (click)="go(page() - 1)"
      >
        <rs-icon name="chevron-down" class="prev" [size]="16" />
      </button>
      @for (item of items(); track $index) {
        @if (item === null) {
          <span class="ellipsis" aria-hidden="true">…</span>
        } @else {
          <button
            type="button"
            class="btn"
            [class.selected]="item === page()"
            [attr.aria-current]="item === page() ? 'page' : null"
            [disabled]="disabled()"
            (click)="go(item)"
          >
            {{ item }}
          </button>
        }
      }
      <button
        type="button"
        class="btn"
        [attr.aria-label]="nextLabel() || null"
        [disabled]="disabled() || page() >= pageCount()"
        (click)="go(page() + 1)"
      >
        <rs-icon name="chevron-down" class="next" [size]="16" />
      </button>
    </nav>
  `,
  styles: `
    :host {
      display: block;
    }
    nav {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: var(--size-control-md);
      height: var(--size-control-md);
      padding: 0 var(--space-3);
      border: var(--stroke-default) solid transparent;
      border-radius: var(--radius-full);
      background: transparent;
      color: var(--text-primary);
      font-family: var(--font-family-ui);
      font-size: var(--body-md-size);
      line-height: var(--body-md-line-height);
      font-weight: var(--label-md-weight);
      font-variant-numeric: tabular-nums;
      cursor: pointer;
    }
    .btn:hover:not(:disabled) {
      background: var(--bg-surface-2);
      border-color: var(--border-control);
    }
    .btn:active:not(:disabled) {
      background: var(--action-primary-soft);
    }
    .btn:focus-visible {
      outline: var(--stroke-focus) solid var(--focus-control);
      outline-offset: var(--focus-offset);
    }
    .btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .btn.selected {
      background: var(--action-primary);
      color: var(--action-on-primary);
      font-weight: var(--body-md-strong-weight);
    }
    .btn.selected:hover:not(:disabled) {
      background: var(--action-primary-hover);
      border-color: transparent;
    }
    .btn.selected:active:not(:disabled) {
      background: var(--action-primary-pressed);
    }
    .prev {
      transform: rotate(90deg);
    }
    .next {
      transform: rotate(-90deg);
    }
    .ellipsis {
      min-width: var(--space-6);
      text-align: center;
      color: var(--text-muted);
    }
  `,
})
export class PaginationComponent {
  /** Current page, 1-based (two-way). */
  readonly page = model(1);
  readonly pageCount = input.required<number>();
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Accessible names (Spanish copy comes from the app). */
  readonly label = input('');
  readonly previousLabel = input('');
  readonly nextLabel = input('');

  protected readonly items = computed(() => buildPageList(this.page(), this.pageCount()));

  protected go(target: number): void {
    const next = Math.min(Math.max(1, target), this.pageCount());
    if (next !== this.page()) {
      this.page.set(next);
    }
  }
}
