import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ConvertQuoteInput,
  CreateQuoteInput,
  CustomerSearchResponse,
  QuoteDetail,
  QuoteEditorContext,
  QuoteListQuery,
  QuoteListResponse,
  QuoteProductResult,
  SalesOrderDetail,
} from '@rodasoft/domain';
import type { Observable } from 'rxjs';

const BASE = '/api/v1/sales/quotes';

/** Quotes (VP-07, VP-08) and converting one into an order (VP-18). */
@Injectable({ providedIn: 'root' })
export class QuotesApi {
  private readonly http = inject(HttpClient);

  list(query: QuoteListQuery): Observable<QuoteListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<QuoteListResponse>(BASE, { params });
  }

  detail(id: string): Observable<QuoteDetail> {
    return this.http.get<QuoteDetail>(`${BASE}/${id}`);
  }

  create(body: CreateQuoteInput): Observable<QuoteDetail> {
    return this.http.post<QuoteDetail>(BASE, body);
  }

  context(): Observable<QuoteEditorContext> {
    return this.http.get<QuoteEditorContext>(`${BASE}/context`);
  }

  searchCustomers(q: string): Observable<CustomerSearchResponse> {
    return this.http.get<CustomerSearchResponse>(`${BASE}/customers`, { params: { q } });
  }

  searchProducts(q: string, warehouseId: string): Observable<{ items: QuoteProductResult[] }> {
    return this.http.get<{ items: QuoteProductResult[] }>(`${BASE}/product-search`, { params: { q, warehouseId } });
  }

  /** The order born from the quote, with its lines reserved in the warehouse. */
  convert(id: string, body: ConvertQuoteInput): Observable<SalesOrderDetail> {
    return this.http.post<SalesOrderDetail>(`${BASE}/${id}/convert`, body);
  }
}
