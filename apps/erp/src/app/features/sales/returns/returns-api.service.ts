import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { CreateSaleReturnInput, ReturnableSale, ReturnDecisionInput, SaleReturnDetail, SaleReturnList, SaleReturnStatus } from '@rodasoft/domain';
import type { Observable } from 'rxjs';

const BASE = '/api/v1/sales/returns';

export interface ReturnListQuery {
  status?: SaleReturnStatus;
  page?: number;
  pageSize?: number;
}

/** The returns (VP-20), the form of a new one (VP-10) and the detail with its decision (VP-21). */
@Injectable({ providedIn: 'root' })
export class ReturnsApi {
  private readonly http = inject(HttpClient);

  list(query: ReturnListQuery): Observable<SaleReturnList> {
    let params = new HttpParams();
    if (query.status) params = params.set('status', query.status);
    if (query.page) params = params.set('page', String(query.page));
    if (query.pageSize) params = params.set('pageSize', String(query.pageSize));
    return this.http.get<SaleReturnList>(BASE, { params });
  }

  /** The sale found by number or customer document, with what of it can still come back. */
  lookup(q: string): Observable<ReturnableSale> {
    return this.http.get<ReturnableSale>(`${BASE}/sale-lookup`, { params: new HttpParams().set('q', q) });
  }

  /** The key makes a repeated request return the first return. */
  create(body: CreateSaleReturnInput, idempotencyKey: string): Observable<SaleReturnDetail> {
    return this.http.post<SaleReturnDetail>(BASE, body, { headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }) });
  }

  detail(id: string): Observable<SaleReturnDetail> {
    return this.http.get<SaleReturnDetail>(`${BASE}/${id}`);
  }

  approve(id: string, body: ReturnDecisionInput): Observable<SaleReturnDetail> {
    return this.http.post<SaleReturnDetail>(`${BASE}/${id}/approve`, body);
  }

  reject(id: string, body: ReturnDecisionInput): Observable<SaleReturnDetail> {
    return this.http.post<SaleReturnDetail>(`${BASE}/${id}/reject`, body);
  }
}
