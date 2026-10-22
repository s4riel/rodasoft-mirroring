import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type SkeletonShape = 'rect' | 'text' | 'circle';

/**
 * Loading placeholder (Figma: Skeleton). `width`/`height` accept any CSS length.
 * Shapes: rect (radius-sm), text (one line, radius-xs), circle.
 */
@Component({
  selector: 'rs-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[attr.data-shape]': 'shape()',
    '[style.width]': 'width()',
    '[style.height]': 'height()',
  },
  template: ``,
  styles: `
    :host {
      display: block;
      background: linear-gradient(90deg, var(--bg-surface-2) 0%, var(--border-default) 50%, var(--bg-surface-2) 100%);
      background-size: 200% 100%;
      border-radius: var(--radius-sm);
      animation: rs-skeleton-shimmer 1.4s var(--ease-out) infinite;
    }
    :host([data-shape='text']) { border-radius: var(--radius-xs); }
    :host([data-shape='circle']) { border-radius: var(--radius-full); }
    @keyframes rs-skeleton-shimmer {
      from { background-position: 100% 0; }
      to { background-position: -100% 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      :host { animation: none; }
    }
  `,
})
export class SkeletonComponent {
  readonly shape = input<SkeletonShape>('rect');
  readonly width = input<string>('100%');
  readonly height = input<string>('16px');
}
