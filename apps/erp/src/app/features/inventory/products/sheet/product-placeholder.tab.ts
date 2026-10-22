import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { EmptyStateIllustratedComponent } from '@rodasoft/ui';

const COPY = {
  movements: {
    illustration: 'no-movements',
    description: 'Aquí verás el kardex del producto: entradas, salidas y saldo.',
  },
} as const;

/** "Disponible próximamente" state of the Movimientos tab (HU-INV-22). */
@Component({
  selector: 'rs-product-placeholder-tab',
  imports: [EmptyStateIllustratedComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-placeholder.tab.html',
  styleUrl: './product-placeholder.tab.scss',
})
export class ProductPlaceholderTab {
  protected readonly copy = COPY[inject(ActivatedRoute).snapshot.data['kind'] as keyof typeof COPY] ?? COPY.movements;
}
