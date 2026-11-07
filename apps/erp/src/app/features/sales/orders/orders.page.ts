import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { SalesOrderListItem, SalesOrderListQuery, SalesOrderListResponse, SalesOrderStatus } from '@rodasoft/domain';
import {
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  PageHeaderComponent,
  PaginationComponent,
  SelectComponent,
  SkeletonComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { DocumentListBase } from '../quotes/document-list.base';
import {
  ORDER_STATUS_OPTIONS,
  parseOrderStatus,
  toOrderQuery,
  toOrderRow,
  type DocumentUrlFilters,
} from '../quotes/quote-format';
import { OrdersApi } from './orders-api.service';

/** The columns of the Figma table of VP-09, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'N.º', type: 'custom', width: '8rem' },
  { key: 'customer', label: 'Cliente', type: 'text' },
  { key: 'quote', label: 'Cotización', type: 'text', width: '8rem' },
  { key: 'warehouse', label: 'Almacén', type: 'text', width: '9rem' },
  { key: 'date', label: 'Fecha', type: 'number', width: '10rem' },
  { key: 'total', label: 'Total', type: 'number', width: '9rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '11rem' },
];

/** VP-09 · Orders: filters, the list, and the loading, empty, error and no-permission states. */
@Component({
  selector: 'rs-orders-page',
  imports: [
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    PageHeaderComponent,
    PaginationComponent,
    RouterLink,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './orders.page.html',
  styleUrl: './orders.page.scss',
})
export class OrdersPage extends DocumentListBase<SalesOrderStatus, SalesOrderListItem, SalesOrderListQuery, SalesOrderListResponse> {
  private readonly api = inject(OrdersApi);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Ventas y POS', link: '/sales' }, { label: 'Pedidos' }];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = ORDER_STATUS_OPTIONS;
  protected readonly documentNames = ['pedido', 'pedidos'] as const;
  protected readonly rows = computed(() => this.items().map(toOrderRow));

  protected parseStatus(raw: string | null) {
    return parseOrderStatus(raw);
  }

  protected toQuery(filters: DocumentUrlFilters<SalesOrderStatus>) {
    return toOrderQuery(filters);
  }

  protected fetchList(query: SalesOrderListQuery) {
    return this.api.list(query);
  }
}
