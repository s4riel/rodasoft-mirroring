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
  templateUrl: './pagination.component.html',
  styleUrl: './pagination.component.scss',
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
