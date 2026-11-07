import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CancellationDecisionInput,
  CancellationRequestInput,
  CancellationReview,
  ReprintReceiptResponse,
  SaleCancellationResponse,
  SaleDetail,
  SaleListQuery,
  SaleListResponse,
} from '@rodasoft/domain';
import type { Observable } from 'rxjs';

const BASE = '/api/v1/sales/sales';

/** The sales history (VP-01) and a sale's detail (VP-02). */
@Injectable({ providedIn: 'root' })
export class SalesHistoryApi {
  private readonly http = inject(HttpClient);

  /** The sales the user may see, filtered and paginated by the server. An empty value is left out of the request. */
  list(query: SaleListQuery): Observable<SaleListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<SaleListResponse>(BASE, { params });
  }

  detail(saleId: string): Observable<SaleDetail> {
    return this.http.get<SaleDetail>(`${BASE}/${saleId}`);
  }

  /** Records a reprint of the receipt in the sale's history. */
  reprint(saleId: string): Observable<ReprintReceiptResponse> {
    return this.http.post<ReprintReceiptResponse>(`${BASE}/${saleId}/receipt/reprint`, {});
  }

  /** Asks Management to cancel the sale (HU-VEN-14); the sale waits as "anulación pendiente". */
  requestCancellation(saleId: string, body: CancellationRequestInput): Observable<SaleCancellationResponse> {
    return this.http.post<SaleCancellationResponse>(`${BASE}/${saleId}/cancellation-request`, body);
  }

  /** The open request with what an approval will do, for Management (HU-VEN-15). */
  cancellationReview(saleId: string): Observable<CancellationReview> {
    return this.http.get<CancellationReview>(`${BASE}/${saleId}/cancellation-request`);
  }

  /** Approves the request: the sale is cancelled, the stock goes back and the cash is refunded. */
  approveCancellation(saleId: string, body: CancellationDecisionInput): Observable<SaleCancellationResponse> {
    return this.http.post<SaleCancellationResponse>(`${BASE}/${saleId}/cancellation-request/approve`, body);
  }

  /** Rejects the request; the reply is for the cashier who asked. */
  rejectCancellation(saleId: string, body: CancellationDecisionInput): Observable<SaleCancellationResponse> {
    return this.http.post<SaleCancellationResponse>(`${BASE}/${saleId}/cancellation-request/reject`, body);
  }

  /** Takes the open cancellation request back. */
  withdrawCancellation(saleId: string): Observable<SaleCancellationResponse> {
    return this.http.post<SaleCancellationResponse>(`${BASE}/${saleId}/cancellation-request/withdraw`, {});
  }
}
