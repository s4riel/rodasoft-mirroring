import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { QtyStepperComponent } from '../qty-stepper/qty-stepper.component';

/**
 * Figma: PosCartLine (Design System `80:4553`, State=Default|Discount). One line of the POS cart: product, unit price,
 * quantity (`rs-qty-stepper`), line total and the trash button. A non-empty `discountLabel` is State=Discount. The drag
 * handle of VP-03 is `rs-drag-handle`, which Figma draws outside this component ("Línea con arrastre"): the screen places it
 * at the line's left. The second text is cut with an ellipsis and carries the full text as its title. Every text comes from the app.
 *   <rs-pos-cart-line title="6205-2RS · SKF" unitPrice="Bs 245,00 c/u" [(quantity)]="qty" [max]="24" total="Bs 490,00"
 *     removeLabel="Quitar 6205-2RS" (remove)="remove(line)" />
 */
@Component({
  selector: 'rs-pos-cart-line',
  imports: [IconComponent, QtyStepperComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-state]': "hasDiscount() ? 'discount' : 'default'" },
  templateUrl: './pos-cart-line.component.html',
  styleUrl: './pos-cart-line.component.scss',
})
export class PosCartLineComponent {
  readonly title = input.required<string>();
  /** Formatted unit price ("Bs 245,00 c/u"). */
  readonly unitPrice = input.required<string>();
  readonly quantity = model(1);
  /** Most the cashier may set; `null` without a limit. */
  readonly max = input<number | null>(null);
  /** Formatted line total ("Bs 490,00"). */
  readonly total = input.required<string>();
  /** Figma State=Discount ("−5 % · −Bs 19,00"). */
  readonly discountLabel = input<string>('');
  /** Accessible names. */
  readonly removeLabel = input.required<string>();
  readonly quantityLabel = input<string>('');
  readonly decrementLabel = input<string>('');
  readonly incrementLabel = input<string>('');

  readonly remove = output<void>();

  protected readonly hasDiscount = computed(() => this.discountLabel() !== '');
}
