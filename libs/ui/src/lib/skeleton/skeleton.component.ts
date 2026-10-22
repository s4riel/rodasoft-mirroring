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
  templateUrl: './skeleton.component.html',
  styleUrl: './skeleton.component.scss',
})
export class SkeletonComponent {
  readonly shape = input<SkeletonShape>('rect');
  readonly width = input<string>('100%');
  readonly height = input<string>('16px');
}
