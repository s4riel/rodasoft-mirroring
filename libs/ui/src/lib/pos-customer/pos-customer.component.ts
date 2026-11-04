import { booleanAttribute, ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

/** Figma PosCustomer `Type`: `final` is a final consumer without NIT, `identified` is a customer with name, NIT and e-mail. */
export type PosCustomerType = 'final' | 'identified';

/**
 * Figma: PosCustomer (Design System `385:36271`, Type=Final|Identified). The customer and invoice data of the sale at the
 * top of the POS "Venta actual" card. The action ("Agregar NIT", "Cambiar") opens the customer search. Every text comes from
 * the app.
 *   <rs-pos-customer type="final" name="Consumidor final" detail="Sin NIT · factura a S/N" actionLabel="Agregar NIT"
 *     (action)="openSearch()" />
 */
@Component({
  selector: 'rs-pos-customer',
  imports: [ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-type]': 'type()' },
  templateUrl: './pos-customer.component.html',
  styleUrl: './pos-customer.component.scss',
})
export class PosCustomerComponent {
  readonly type = input<PosCustomerType>('final');
  /** "Consumidor final", or the customer's name. */
  readonly name = input.required<string>();
  /** The second line: the NIT and e-mail, or what invoicing a final consumer means. */
  readonly detail = input<string>('');
  readonly actionLabel = input.required<string>();
  /** Accessible name of the action when the label alone is not enough ("Cambiar cliente"). */
  readonly actionAriaLabel = input<string | null>(null);

  /** The action cannot be used (the POS without an open shift). */
  readonly disabled = input(false, { transform: booleanAttribute });

  readonly action = output<void>();
}
