import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Paper of the receipt (decision #9): the 80 mm roll, or a letter-size page. */
export type ReceiptPaper = 'ticket-80mm' | 'letter';

/** A "label … value" line of the header data, the totals or the payment. */
export interface ReceiptRow {
  label: string;
  value: string;
  /** Totals that stand out (the sale total). */
  strong?: boolean;
}

/** One sold line: description, "2 × Bs 245,00" and the line total. */
export interface ReceiptItem {
  description: string;
  detail: string;
  total: string;
  /** An optional line under the description, for example the measures of a product (HU-VEN-36). */
  note?: string;
}

/**
 * The printed sale receipt (HU-VEN-11) in two papers. **Not in the Figma Design System**: the Figma "Ticket" component is the
 * POS sale panel, not a printed receipt, so this one is estimated (monospaced, bordered by dashes like a till roll) and must
 * be reviewed against the client's template when decision #9 is answered. Every text comes from the app; nothing is fetched.
 *   <rs-receipt paper="ticket-80mm" title="Rodalaser" [headerLines]="…" [metaRows]="…" [items]="…" [totalRows]="…" />
 */
@Component({
  selector: 'rs-receipt',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-paper]': 'paper()' },
  templateUrl: './receipt.component.html',
  styleUrl: './receipt.component.scss',
})
export class ReceiptComponent {
  readonly paper = input<ReceiptPaper>('ticket-80mm');
  /** The company's trade name. */
  readonly title = input.required<string>();
  /** Legal name, NIT, branch… one line each, under the title. */
  readonly headerLines = input<string[]>([]);
  /** Number, date, cashier, customer… */
  readonly metaRows = input<ReceiptRow[]>([]);
  readonly items = input<ReceiptItem[]>([]);
  /** Subtotal, discount, rounding, total, received, change. */
  readonly totalRows = input<ReceiptRow[]>([]);
  /** The notes at the end ("Factura pendiente de emisión", thanks…). */
  readonly footerLines = input<string[]>([]);
}
