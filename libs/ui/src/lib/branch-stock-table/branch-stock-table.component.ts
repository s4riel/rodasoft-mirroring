import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type BranchStockAvailability = 'available' | 'low' | 'out';

export interface BranchStockRow {
  id: string;
  branch: string;
  warehouse: string;
  available: number;
  minStock: number | null;
  availability: BranchStockAvailability;
  /** Figma Row Current=On: the user's active branch is highlighted. */
  current: boolean;
}

export interface BranchStockLabels {
  branch: string;
  warehouse: string;
  available: string;
  min: string;
  status: string;
  availability: Record<BranchStockAvailability, string>;
  empty: string;
}

/**
 * Figma: BranchStockTable (+ BranchStockTable/Row Current, Level Ok|Low|None). Stock of a product by branch and
 * warehouse: Sucursal, Almacén, Disponible, Mínimo and Estado, with a total row. Built with the Table/Cell look
 * (52 px rows, 16 px padding, mono numbers) and the StatusPill look for Estado. Labels come from the screen.
 */
@Component({
  selector: 'rs-branch-stock-table',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './branch-stock-table.component.html',
  styleUrl: './branch-stock-table.component.scss',
})
export class BranchStockTableComponent {
  readonly rows = input.required<readonly BranchStockRow[]>();
  readonly labels = input.required<BranchStockLabels>();
  /** Total row label, e.g. "Total · 4 sucursales". */
  readonly totalLabel = input.required<string>();
  readonly totalAvailable = input.required<number>();
  readonly totalMin = input<number | null>(null);
  /** Accessible name of the table. */
  readonly tableLabel = input('');
}
