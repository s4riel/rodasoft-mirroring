import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { EmptyStateIllustratedComponent } from '@rodasoft/ui';

const COPY = {
  equivalents: {
    illustration: 'no-equivalents',
    description: 'Aquí verás los equivalentes de otras marcas y sus diferencias.',
  },
  movements: {
    illustration: 'no-movements',
    description: 'Aquí verás el kardex del producto: entradas, salidas y saldo.',
  },
} as const;

/** "Disponible próximamente" state of the Equivalentes (HU-INV-04) and Movimientos (HU-INV-22) tabs. */
@Component({
  selector: 'rs-product-placeholder-tab',
  imports: [EmptyStateIllustratedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-placeholder.tab.html',
  styleUrl: './product-placeholder.tab.scss',
})
export class ProductPlaceholderTab {
  protected readonly copy = COPY[inject(ActivatedRoute).snapshot.data['kind'] as keyof typeof COPY] ?? COPY.equivalents;
}
