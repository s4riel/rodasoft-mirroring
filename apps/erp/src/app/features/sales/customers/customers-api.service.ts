import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { CustomerListQuery, CustomerListResponse, CustomerSummary, SaveCustomerInput, UpdateCustomerInput } from '@rodasoft/domain';
import type { Observable } from 'rxjs';

const BASE = '/api/v1/sales/customers';

/** HU-VEN-37 · The customer list and form of Management (`sales.customers.manage`). */
@Injectable({ providedIn: 'root' })
export class CustomersApi {
  private readonly http = inject(HttpClient);

  list(query: CustomerListQuery): Observable<CustomerListResponse> {
    let params = new HttpParams();
    if (query.q) params = params.set('q', query.q);
    if (query.status) params = params.set('status', query.status);
    if (query.page) params = params.set('page', query.page);
    if (query.pageSize) params = params.set('pageSize', query.pageSize);
    return this.http.get<CustomerListResponse>(BASE, { params });
  }

  create(body: SaveCustomerInput): Observable<CustomerSummary> {
    return this.http.post<CustomerSummary>(BASE, body);
  }

  update(id: string, body: UpdateCustomerInput): Observable<CustomerSummary> {
    return this.http.patch<CustomerSummary>(`${BASE}/${id}`, body);
  }
}
