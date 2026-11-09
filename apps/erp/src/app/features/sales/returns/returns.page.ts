import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import type { SaleReturnList, SaleReturnStatus, SaleReturnSummary } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  IconComponent,
  KpiCardComponent,
  PageHeaderComponent,
  PaginationComponent,
  SelectComponent,
  SkeletonComponent,
  ToastOutletComponent,
} from '@rodasoft/ui';
import { formatBs } from '../cash/cash-format';
import { DocumentListBase } from '../quotes/document-list.base';
import { DOCUMENTS_PAGE_SIZE, type DocumentUrlFilters } from '../quotes/quote-format';
import { parseReturnStatus, RETURN_STATUS_OPTIONS, toReturnRow } from './returns-format';
import { ReturnsApi, type ReturnListQuery } from './returns-api.service';

/** The columns of the Figma table of VP-20, in its order. */
const COLUMNS: DocTableColumn[] = [
  { key: 'number', label: 'N.º', type: 'custom', width: '8rem' },
  { key: 'customer', label: 'Cliente', type: 'text' },
  { key: 'sale', label: 'Venta', type: 'code', width: '8rem' },
  { key: 'items', label: 'Ítems', type: 'text', width: '8rem' },
  { key: 'total', label: 'Total', type: 'number', width: '9rem' },
  { key: 'status', label: 'Estado', type: 'status', width: '11rem' },
];

/** VP-20 · Returns: the four KPIs, the list, and the loading, empty, error and no-permission states. */
@Component({
  selector: 'rs-returns-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    IconComponent,
    KpiCardComponent,
    PageHeaderComponent,
    PaginationComponent,
    RouterLink,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './returns.page.html',
  styleUrl: './returns.page.scss',
})
export class ReturnsPage extends DocumentListBase<SaleReturnStatus, SaleReturnSummary, ReturnListQuery, SaleReturnList> {
  private readonly api = inject(ReturnsApi);
  private readonly navigation = inject(Router);

  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Ventas y POS', link: '/sales' }, { label: 'Devoluciones' }];
  protected readonly columns = COLUMNS;
  protected readonly statusOptions = RETURN_STATUS_OPTIONS;
  protected readonly documentNames = ['devolución', 'devoluciones'] as const;
  protected readonly rows = computed(() => this.items().map(toReturnRow));
  protected readonly kpis = computed(() => {
    const k = this.data()?.kpis;
    return {
      month: String(k?.monthCount ?? 0),
      amount: formatBs(k?.monthAmount ?? '0'),
      pending: String(k?.pendingCount ?? 0),
      scrap: String(k?.scrapPieces ?? 0),
    };
  });
  protected readonly totals = computed(() => ({ total: formatBs(this.data()?.totalAmount ?? '0') }));

  protected parseStatus(raw: string | null) {
    return parseReturnStatus(raw);
  }

  protected toQuery(filters: DocumentUrlFilters<SaleReturnStatus>): ReturnListQuery {
    return { status: filters.status ?? undefined, page: filters.page, pageSize: DOCUMENTS_PAGE_SIZE };
  }

  protected fetchList(query: ReturnListQuery) {
    return this.api.list(query);
  }

  protected newReturn() {
    void this.navigation.navigate(['/sales/returns/new']);
  }
}
