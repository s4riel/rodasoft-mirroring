import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { CancelSalesOrderInput, SalesOrderDetail, SalesOrderListQuery, SalesOrderListResponse } from '@rodasoft/domain';
import type { Observable } from 'rxjs';

const BASE = '/api/v1/sales/orders';

/** The orders (VP-09) and an order's detail. */
@Injectable({ providedIn: 'root' })
export class OrdersApi {
  private readonly http = inject(HttpClient);

  list(query: SalesOrderListQuery): Observable<SalesOrderListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<SalesOrderListResponse>(BASE, { params });
  }

  detail(id: string): Observable<SalesOrderDetail> {
    return this.http.get<SalesOrderDetail>(`${BASE}/${id}`);
  }

  /** Cancels the order; its reserved stock goes back to the available stock. */
  cancel(id: string, body: CancelSalesOrderInput): Observable<SalesOrderDetail> {
    return this.http.post<SalesOrderDetail>(`${BASE}/${id}/cancel`, body);
  }
}
