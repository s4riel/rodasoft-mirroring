import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, contentChildren, input } from '@angular/core';
import { IconName } from '../icon/icons';
import { StatusPillComponent, Status } from '../status-pill/status-pill.component';
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
  cells: Record<string, DocTableCell>;
}

export type DocTableSize = 'md' | 'lg';

/**
 * Figma: DocTable (Header, Row, TotalRow, Footer). Generic read-only table with a column definition, typed cells,
 * custom cell templates (`rsDocCell`), an optional total row and a footer slot (`[slot=footer]`) for the range text and
 * the pagination. `size` picks the row height: `lg` is the 72 px of the Figma DocTable, `md` the 52 px of Table/Cell.
 * Labels and texts come from the screen.
 */
@Component({
  selector: 'rs-doc-table',
  imports: [NgTemplateOutlet, StatusPillComponent],
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

  protected readonly templates = contentChildren(DocTableCellDirective);
  private readonly templateByKey = computed(() => new Map(this.templates().map((t) => [t.key(), t.template])));

  protected templateOf(key: string) {
    return this.templateByKey().get(key) ?? null;
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
