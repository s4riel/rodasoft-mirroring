import { ChangeDetectionStrategy, Component, ElementRef, HostListener, inject, input, output, signal } from '@angular/core';
import { FlagComponent, FlagCountry } from '../flag/flag.component';
import { IconComponent } from '../icon/icon.component';
import { ProductThumbComponent } from '../product-thumb/product-thumb.component';
import { RowMenuComponent, RowMenuItem } from '../row-menu/row-menu.component';
import type { IconName } from '../icon/icons';

export type ProductAvailability = 'available' | 'low' | 'out' | 'inactive';

export interface ProductTableRow {
  id: string;
  photoUrl: string | null;
  /** Glyph of the photo placeholder (category icon); defaults to the bearing. */
  thumbIcon?: IconName;
  code: string;
  name: string;
  brandName: string;
  /** Brand logo; without it the brand shows its initials (decision #38). */
  brandLogoUrl: string | null;
  country: FlagCountry | null;
  description: string;
  totalStock: number;
  /** null = no branch selected. */
  branchStock: number | null;
  /** Decimal string with 2 decimals, e.g. "1150.00". */
  price: string;
  availability: ProductAvailability;
}

export interface ProductTableLabels {
  photo: string;
  code: string;
  product: string;
  description: string;
  totalStock: string;
  branchStock: string;
  price: string;
  status: string;
  /** Prefix of the row action button name, e.g. "Acciones de". */
  rowActions: string;
  availability: Record<ProductAvailability, string>;
}

/** Figma ProductTable Cell/Status: tinted pill with a glyph (check / warning); inactive has none. */
const STATUS_ICON: Record<ProductAvailability, IconName | null> = {
  available: 'check',
  low: 'alert',
  out: 'alert',
  inactive: null,
};

/** "1150.5" -> "1.150,50" (es-BO). Works on the decimal string so no amount goes through `number`. */
export function formatBoliviano(amount: string): string {
  const [int = '0', frac = ''] = amount.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${grouped},${(frac + '00').slice(0, 2)}`;
}

/**
 * Figma: ProductTable / ProductTable10 (Header, Row, Cell/Product, TotalRow, RowAction + RowMenu).
 * Presentational: rows, labels and menu items come from the screen. The row menu opens under the
 * kebab button and closes with Escape or a click outside.
 */
@Component({
  selector: 'rs-product-table',
  imports: [FlagComponent, IconComponent, ProductThumbComponent, RowMenuComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-table.component.html',
  styleUrl: './product-table.component.scss',
})
export class ProductTableComponent {
  readonly rows = input.required<readonly ProductTableRow[]>();
  readonly labels = input.required<ProductTableLabels>();
  readonly menuItems = input<readonly RowMenuItem[]>([]);
  /** Footer row ("Subtotal"); hidden when empty. */
  readonly footerLabel = input('');
  readonly footerNote = input('');
  readonly footerBranchStock = input<number | null>(null);
  /** Accessible name of the table. */
  readonly tableLabel = input<string | null>(null);

  /** Emits `{ id, key }` of the chosen row menu item. */
  readonly rowAction = output<{ id: string; key: string }>();

  protected readonly openRowId = signal<string | null>(null);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected statusIcon(a: ProductAvailability): IconName | null {
    return STATUS_ICON[a];
  }

  protected price(amount: string) {
    return formatBoliviano(amount);
  }

  protected initials(name: string) {
    return name.slice(0, 2).toUpperCase();
  }

  protected toggleMenu(id: string, event: Event) {
    event.stopPropagation();
    this.openRowId.update((current) => (current === id ? null : id));
  }

  protected choose(id: string, key: string) {
    this.closeMenu(id);
    this.rowAction.emit({ id, key });
  }

  /** Closes the open menu and gives focus back to its kebab button. */
  private closeMenu(id: string | null) {
    this.openRowId.set(null);
    if (!id) return;
    Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('[data-kebab]'))
      .find((kebab) => kebab.dataset['kebab'] === id)
      ?.focus();
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event) {
    if (this.openRowId() && !this.host.nativeElement.contains(event.target as Node)) this.openRowId.set(null);
  }

  @HostListener('keydown.escape')
  protected onEscape() {
    const open = this.openRowId();
    if (open) this.closeMenu(open);
  }
}
