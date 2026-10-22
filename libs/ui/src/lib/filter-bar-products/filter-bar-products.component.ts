import { booleanAttribute, ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { InputDirective, InputGroupComponent } from '../input/input.component';

/**
 * Figma: FilterBar/Products. Search field + "clear" action on the first row; the filter selects
 * (Industry, Category, Subcategory, Brand, Status) are projected into `[rsFilters]`.
 * All visible text comes from the screen.
 */
@Component({
  selector: 'rs-filter-bar-products',
  imports: [IconComponent, InputDirective, InputGroupComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './filter-bar-products.component.html',
  styleUrl: './filter-bar-products.component.scss',
})
export class FilterBarProductsComponent {
  readonly search = model('');
  readonly searchPlaceholder = input('');
  readonly searchLabel = input('');
  readonly clearLabel = input('');
  /** Disables the clear action while nothing is applied. */
  readonly clearDisabled = input(false, { transform: booleanAttribute });
  /** Emits when the user presses the clear action. */
  readonly cleared = output<void>();

  protected onSearch(event: Event) {
    this.search.set((event.target as HTMLInputElement).value);
  }
}
