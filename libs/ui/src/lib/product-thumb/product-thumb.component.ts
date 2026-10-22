import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons';

/**
 * Figma: ProductThumb (Size = SM, State = Photo). 40 px square with the product photo, or a category glyph
 * while the product has no photo.
 */
@Component({
  selector: 'rs-product-thumb',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-thumb.component.html',
  styleUrl: './product-thumb.component.scss',
})
export class ProductThumbComponent {
  readonly src = input<string | null>(null);
  /** Glyph shown when there is no photo. */
  readonly icon = input<IconName>('bearing');
  /** Accessible description of the photo; empty = decorative. */
  readonly alt = input('');
}
