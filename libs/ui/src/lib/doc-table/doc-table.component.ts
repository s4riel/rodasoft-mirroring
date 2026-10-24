import { NgTemplateOutlet } from '@angular/common';
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, contentChildren, input, model } from '@angular/core';
import { CheckboxComponent } from '../checkbox/checkbox.component';
import { IconName } from '../icon/icons';
import { StatusPillComponent, Status } from '../status-pill/status-pill.component';
import { TooltipDirective } from '../tooltip/tooltip.directive';
import { DocTableCellDirective } from './doc-table-cell.directive';

/** Figma Table/Cell Type: Code and Number are monospaced and Number sits on the right; Status is a StatusPill. */
export type DocTableCellType = 'text' | 'code' | 'number' | 'status' | 'custom';

export interface DocTableColumn {
  key: string;
  label: string;
  type?: DocTableCellType;
  /** Alignment; numbers sit on the right by default, everything else on the left. */
  align?: 'start' | 'end';
  /** CSS width of the column (e.g. `12rem`); fluid when omitted. */
  width?: string;
}

/** Value of a `status` cell. `tooltip` adds the full explanation on hover and focus. */
export interface DocTableStatus {
  label: string;
  status: Status;
  icon?: IconName;
  tooltip?: string;
}

export type DocTableCell = string | number | DocTableStatus | null;

export interface DocTableRow {
  id: string;
  /** Accessible name of the row's selection checkbox (e.g. the product code); falls back to the id. */
  label?: string;
  cells: Record<string, DocTableCell>;
}

export type DocTableSize = 'md' | 'lg';

/**
 * Figma: DocTable (Header, Row, TotalRow, Footer). Generic read-only table with a column definition, typed cells,
 * custom cell templates (`rsDocCell`), an optional total row and a footer slot (`[slot=footer]`) for the range text and
 * the pagination. `size` picks the row height: `lg` is the 72 px of the Figma DocTable, `md` the 52 px of Table/Cell.
 * With `selectable` the first column is a checkbox per row (Figma table checkbox variant): `selectedIds` is two-way, and
 * once `maxSelected` rows are checked the others are disabled and show `maxSelectedLabel` as a tooltip.
 * Labels and texts come from the screen.
 */
@Component({
  selector: 'rs-doc-table',
  imports: [CheckboxComponent, NgTemplateOutlet, StatusPillComponent, TooltipDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-size]': 'size()' },
  templateUrl: './doc-table.component.html',
  styleUrl: './doc-table.component.scss',
})
export class DocTableComponent {
  readonly columns = input.required<readonly DocTableColumn[]>();
  readonly rows = input.required<readonly DocTableRow[]>();
  /** Cells of the total row, by column key; the row is hidden when omitted. */
  readonly totals = input<Record<string, DocTableCell> | null>(null);
  readonly size = input<DocTableSize>('lg');
  /** Accessible name of the table. */
  readonly tableLabel = input('');
  /** Message shown when there are no rows; without it an empty table shows no row at all. */
  readonly emptyLabel = input('');
  /** Adds the checkbox column. */
  readonly selectable = input(false, { transform: booleanAttribute });
  /** Ids of the checked rows (two-way). */
  readonly selectedIds = model<readonly string[]>([]);
  /** Most rows that can be checked at once; unlimited when omitted. */
  readonly maxSelected = input<number | null>(null);
  /** Tooltip of the checkboxes disabled by `maxSelected`. */
  readonly maxSelectedLabel = input('');
  /** Hidden header text of the checkbox column. */
  readonly selectionHeader = input('');

  protected readonly templates = contentChildren(DocTableCellDirective);
  private readonly templateByKey = computed(() => new Map(this.templates().map((t) => [t.key(), t.template])));

  protected templateOf(key: string) {
    return this.templateByKey().get(key) ?? null;
  }

  private readonly selectedSet = computed(() => new Set(this.selectedIds()));

  protected isSelected(id: string): boolean {
    return this.selectedSet().has(id);
  }

  /** A row that is not checked cannot be once the limit is reached. */
  protected isBlocked(id: string): boolean {
    const max = this.maxSelected();
    return max !== null && !this.isSelected(id) && this.selectedSet().size >= max;
  }

  protected toggle(id: string, checked: boolean): void {
    if (checked === this.isSelected(id) || (checked && this.isBlocked(id))) return;
    this.selectedIds.set(checked ? [...this.selectedIds(), id] : this.selectedIds().filter((x) => x !== id));
  }

  protected colspan(): number {
    return this.columns().length + (this.selectable() ? 1 : 0);
  }

  protected typeOf(column: DocTableColumn): DocTableCellType {
    return column.type ?? 'text';
  }

  protected isRight(column: DocTableColumn): boolean {
    return column.align ? column.align === 'end' : this.typeOf(column) === 'number';
  }

  protected statusOf(cell: DocTableCell | undefined): DocTableStatus | null {
    return cell !== null && typeof cell === 'object' ? cell : null;
  }

  protected textOf(cell: DocTableCell | undefined): string {
    return cell === null || cell === undefined || typeof cell === 'object' ? '' : String(cell);
  }
}
