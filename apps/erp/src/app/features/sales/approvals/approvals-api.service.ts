import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { ApprovalInboxResponse, ApprovalInboxSummary, ApprovalType } from '@rodasoft/domain';
import type { Observable } from 'rxjs';

/**
 * VP-25 · The approvals inbox (HU-VEN-29). It only reads: a request is decided through the endpoint of its own type
 * (`ReturnsApi`, `CashApi`, and the review pages of cancellations and cash differences).
 */
@Injectable({ providedIn: 'root' })
export class ApprovalsApi {
  private readonly http = inject(HttpClient);

  /** Everything that waits for a decision, grouped by type; the types the caller may not decide are not there. */
  list(type?: ApprovalType): Observable<ApprovalInboxResponse> {
    const params = type ? new HttpParams().set('type', type) : new HttpParams();
    return this.http.get<ApprovalInboxResponse>('/api/v1/sales/approvals', { params });
  }

  /** The count behind the badge of the Aprobaciones tab. */
  summary(): Observable<ApprovalInboxSummary> {
    return this.http.get<ApprovalInboxSummary>('/api/v1/sales/approvals/summary');
  }
}
