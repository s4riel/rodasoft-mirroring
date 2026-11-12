import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  BulkPriceApplyInput,
  BulkPriceInput,
  BulkPricePreview,
  BulkPriceResult,
  EditPriceInput,
  PriceDetail,
  PriceListQuery,
  PriceListResponse,
} from '@rodasoft/domain';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class PricesApi {
  private readonly http = inject(HttpClient);

  /** VP-11 · Products with their price, the stock of the branch and the last price change. */
  list(query: PriceListQuery): Observable<PriceListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<PriceListResponse>('/api/v1/sales/prices', { params });
  }

  /** VP-11b · The product with its current price and, for who may see costs, its cost and margin. */
  detail(productId: string): Observable<PriceDetail> {
    return this.http.get<PriceDetail>(`/api/v1/sales/prices/${productId}`);
  }

  /** VP-11b · Changes the price. `expectedPrice` is the one the dialog showed: a different stored price is refused. */
  edit(productId: string, body: EditPriceInput): Observable<PriceDetail> {
    return this.http.patch<PriceDetail>(`/api/v1/sales/prices/${productId}`, body);
  }

  /** VP-11c · What a bulk update would do, page by page, with the hash `bulkApply` asks for. Writes nothing. */
  bulkPreview(body: BulkPriceInput): Observable<BulkPricePreview> {
    return this.http.post<BulkPricePreview>('/api/v1/sales/prices/bulk/preview', body);
  }

  /** VP-11c · Applies the update that was previewed; a hash that no longer matches is refused (`BULK_PREVIEW_STALE`). */
  bulkApply(body: BulkPriceApplyInput): Observable<BulkPriceResult> {
    return this.http.post<BulkPriceResult>('/api/v1/sales/prices/bulk/apply', body);
  }
}
