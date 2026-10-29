import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { KardexLedgerResponse, KardexResponse, StockMovementType } from '@rodasoft/domain';
import type { Observable } from 'rxjs';

/**
 * Query of the kardex (IN-09). With `productId` the API answers the kardex of that product; without it, the ledger of every
 * movement (where `type` and `q` apply). An empty value is left out of the request.
 */
export interface KardexQuery {
  productId?: string;
  warehouseId?: string;
  branchId?: string;
  type?: StockMovementType;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

const BASE = '/api/v1/inventory/kardex';

function paramsOf(query: KardexQuery): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class KardexApi {
  private readonly http = inject(HttpClient);

  /** IN-09 · The movements of one product with the balance, filtered by warehouse and dates. */
  get(query: KardexQuery & { productId: string }): Observable<KardexResponse> {
    return this.http.get<KardexResponse>(BASE, { params: paramsOf(query) });
  }

  /** IN-09 · The movements of every product, newest first. */
  ledger(query: Omit<KardexQuery, 'productId'>): Observable<KardexLedgerResponse> {
    return this.http.get<KardexLedgerResponse>(BASE, { params: paramsOf(query) });
  }

  /** IN-09 · The same kardex or ledger as an .xlsx, the whole range. */
  export(query: Omit<KardexQuery, 'page' | 'pageSize'>): Observable<Blob> {
    return this.http.get(`${BASE}/export`, { params: paramsOf(query), responseType: 'blob' });
  }
}
