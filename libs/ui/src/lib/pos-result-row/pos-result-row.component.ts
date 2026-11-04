import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonComponent } from '../button/button.component';
import { IconButtonComponent } from '../icon-button/icon-button.component';
import { IconComponent } from '../icon/icon.component';
import { StockFlagComponent } from '../stock-flag/stock-flag.component';

/** Stock of the result: `ok` shows only the label, `low` adds the warning flag, `out` the danger flag and text. */
export type PosResultStockLevel = 'ok' | 'low' | 'out';

/**
 * Figma: PosResultRow (Design System `385:36146`, Stock=Default|Low|None). One POS search result: code, brand monogram
 * and description, stock in the register's branch, price, the eye button (product sheet) and Agregar. `Stock=None` swaps
 * the action for Equivalentes when `showEquivalents` is on; with it off the Agregar button stays, disabled.
 * Every text comes from the app.
 *   <rs-pos-result-row code="6205-2RS" description="Rodamiento rígido de bolas · SKF" brandInitials="SK"
 *     stockLabel="24 en Central" stockLevel="ok" price="Bs 245,00" addLabel="Agregar" (add)="add(p)" />
 */
@Component({
  selector: 'rs-pos-result-row',
  imports: [ButtonComponent, IconButtonComponent, IconComponent, StockFlagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-stock]': 'stockLevel()' },
  templateUrl: './pos-result-row.component.html',
  styleUrl: './pos-result-row.component.scss',
})
export class PosResultRowComponent {
  readonly code = input.required<string>();
  readonly description = input<string>('');
  /** Figma BrandMark: provisional monogram until the brand logos are wired. */
  readonly brandInitials = input<string>('');
  /** "24 en Central", "Agotado aquí". */
  readonly stockLabel = input.required<string>();
  readonly stockLevel = input<PosResultStockLevel>('ok');
  /** Formatted price ("Bs 245,00"). */
  readonly price = input.required<string>();
  readonly addLabel = input.required<string>();
  /** Accessible name of the add button when it needs more than its text ("Agregar 6205-2RS"). */
  readonly addAriaLabel = input<string>('');
  /** Figma "Detalle" (eye) button, HU-VEN-04. */
  readonly showDetail = input(false, { transform: booleanAttribute });
  readonly detailLabel = input<string>('');
  /** Figma Stock=None action, HU-VEN-03. */
  readonly showEquivalents = input(false, { transform: booleanAttribute });
  readonly equivalentsLabel = input<string>('');
  /** Disables Agregar for a reason the row cannot see (a request in flight). Out of stock disables it anyway. */
  readonly addDisabled = input(false, { transform: booleanAttribute });

  readonly add = output<void>();
  readonly detail = output<void>();
  readonly equivalents = output<void>();

  protected readonly isOut = computed(() => this.stockLevel() === 'out');
  protected readonly swapsToEquivalents = computed(() => this.isOut() && this.showEquivalents());
  protected readonly flagLevel = computed(() => (this.isOut() ? 'out' : 'low'));
}
