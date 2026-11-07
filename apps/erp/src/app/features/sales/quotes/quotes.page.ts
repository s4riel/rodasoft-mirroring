import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { QuoteListItem, QuoteListQuery, QuoteListResponse, QuoteStatus } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  IconComponent,
  PageHeaderComponent,
  PaginationComponent,
  RowActionComponent,
  RS_PERMISSIONS,
  SelectComponent,
  SkeletonComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import type { RowMenuItem } from '@rodasoft/ui';
import { DocumentListBase } from './document-list.base';
import {
  parseQuoteStatus,
  QUOTE_STATUS_OPTIONS,
  toQuoteQuery,
  toQuoteRow,
  toQuoteTotals,
  type DocumentUrlFilters,
} from './quote-format';
import { QuotesApi } from './quotes-api.service';

/** The columns of the Figma table of VP-07, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'N.º', type: 'custom', width: '8rem' },
  { key: 'customer', label: 'Cliente', type: 'text' },
  { key: 'date', label: 'Fecha', type: 'number', width: '10rem' },
  { key: 'validUntil', label: 'Válida hasta', type: 'number', width: '9rem' },
  { key: 'items', label: 'Ítems', type: 'number', width: '6rem' },
  { key: 'total', label: 'Total', type: 'number', width: '9rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '11rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

const VIEW_ITEM: RowMenuItem = { key: 'view', label: 'Ver cotización', icon: 'eye' };
const CONVERT_ITEM: RowMenuItem = { key: 'convert', label: 'Convertir en pedido', icon: 'arrow' };

/** VP-07 · Quotes: filters, the list with its row menu, and the loading, empty, error and no-permission states. */
@Component({
  selector: 'rs-quotes-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    IconComponent,
    PageHeaderComponent,
    PaginationComponent,
    RouterLink,
    RowActionComponent,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quotes.page.html',
  styleUrl: './quotes.page.scss',
})
export class QuotesPage extends DocumentListBase<QuoteStatus, QuoteListItem, QuoteListQuery, QuoteListResponse> {
  private readonly api = inject(QuotesApi);
  private readonly permissions = inject(RS_PERMISSIONS);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Ventas y POS', link: '/sales' }, { label: 'Cotizaciones' }];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = QUOTE_STATUS_OPTIONS;
  protected readonly documentNames = ['cotización', 'cotizaciones'] as const;
  private readonly mayConvert = computed(() => this.permissions().has('sales.orders.manage'));
  protected readonly rows = computed(() => this.items().map(toQuoteRow));
  protected readonly totals = computed(() => toQuoteTotals(this.items()));

  protected parseStatus(raw: string | null) {
    return parseQuoteStatus(raw);
  }

  protected toQuery(filters: DocumentUrlFilters<QuoteStatus>) {
    return toQuoteQuery(filters);
  }

  protected fetchList(query: QuoteListQuery) {
    return this.api.list(query);
  }

  /** "Convertir en pedido" only for a draft or a sent quote, to who manages orders. */
  protected menuFor(item: QuoteListItem): RowMenuItem[] {
    const convertible = item.status === 'DRAFT' || item.status === 'SENT';
    return convertible && this.mayConvert() ? [VIEW_ITEM, CONVERT_ITEM] : [VIEW_ITEM];
  }

  protected menuLabel(item: QuoteListItem): string {
    return `Acciones de la cotización ${item.number}`;
  }

  protected openNewQuote() {
    void this.router.navigate(['/sales/quotes/new']);
  }

  protected onAction(item: QuoteListItem, key: string) {
    if (key === 'view') void this.router.navigate(['/sales/quotes', item.id]);
    // the detail opens the conversion dialog
    if (key === 'convert') void this.router.navigate(['/sales/quotes', item.id], { queryParams: { convert: 1 } });
  }
}
