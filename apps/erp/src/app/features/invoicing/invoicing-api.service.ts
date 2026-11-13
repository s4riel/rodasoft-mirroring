import { HttpClient, HttpParams, type HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { InvoiceBulkResult, InvoiceCancellationsResponse, InvoiceDeliveryChannel, InvoiceDetail, InvoiceListQuery, InvoiceListResponse, InvoicingStatus } from '@rodasoft/domain';
import type { Observable } from 'rxjs';

const BASE = '/api/v1/invoicing';

/** The SIAT invoices: status, list, detail and issuing by hand (HU-FAC-01…04, HU-FAC-07). */
@Injectable({ providedIn: 'root' })
export class InvoicingApi {
  private readonly http = inject(HttpClient);

  status(): Observable<InvoicingStatus> {
    return this.http.get<InvoicingStatus>(`${BASE}/status`);
  }

  /** The invoices the user may see, filtered and paginated by the server. An empty value is left out of the request. */
  list(query: InvoiceListQuery): Observable<InvoiceListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<InvoiceListResponse>(`${BASE}/invoices`, { params });
  }

  detail(id: string): Observable<InvoiceDetail> {
    return this.http.get<InvoiceDetail>(`${BASE}/invoices/${id}`);
  }

  /** Issues one invoice by hand; the SIAT answer arrives a moment later, in the worker. */
  issue(id: string): Observable<void> {
    return this.http.post<void>(`${BASE}/invoices/${id}/issue`, {});
  }

  issueMany(ids: readonly string[]): Observable<{ results: InvoiceBulkResult[] }> {
    return this.http.post<{ results: InvoiceBulkResult[] }>(`${BASE}/invoices/issue`, { ids });
  }

  /** Asks Management to cancel the invoice and its sale; the invoice stays valid until the approval. */
  requestCancellation(id: string, body: { reasonCode: number; comment: string }): Observable<{ saleId: string; status: string }> {
    return this.http.post<{ saleId: string; status: string }>(`${BASE}/invoices/${id}/cancellation-request`, body);
  }

  /** The requester takes the cancellation request back (the sales endpoint: the request belongs to the sale). */
  withdrawCancellation(saleId: string): Observable<{ saleId: string; status: string }> {
    return this.http.post<{ saleId: string; status: string }>(`/api/v1/sales/sales/${saleId}/cancellation-request/withdraw`, {});
  }

  /** The cancellations waiting for Management. */
  cancellations(): Observable<InvoiceCancellationsResponse> {
    return this.http.get<InvoiceCancellationsResponse>(`${BASE}/cancellations`);
  }

  /** Fixes the customer of an invoice that was not accepted (the NIT must be verified again). */
  updateCustomer(id: string, body: { name: string; documentType: number; documentNumber: string; complement?: string }): Observable<void> {
    return this.http.patch<void>(`${BASE}/invoices/${id}/customer`, body);
  }

  /** Asks the SIN whether it knows the NIT of the invoice. */
  verifyNit(id: string): Observable<{ valid: boolean; messages: { code: number; description: string }[] }> {
    return this.http.post<{ valid: boolean; messages: { code: number; description: string }[] }>(`${BASE}/invoices/${id}/verify-nit`, {});
  }

  /** Sends a rejected invoice again (needs a verified NIT or an approved exception). */
  resend(id: string): Observable<void> {
    return this.http.post<void>(`${BASE}/invoices/${id}/resend`, {});
  }

  requestNitException(id: string, reason: string): Observable<void> {
    return this.http.post<void>(`${BASE}/invoices/${id}/nit-exception`, { reason });
  }

  approveNitException(id: string, body: { comment?: string }): Observable<void> {
    return this.http.post<void>(`${BASE}/invoices/${id}/nit-exception/approve`, body);
  }

  rejectNitException(id: string, body: { comment?: string }): Observable<void> {
    return this.http.post<void>(`${BASE}/invoices/${id}/nit-exception/reject`, body);
  }

  /** The printed invoice, for the preview and the download. */
  pdf(id: string): Observable<Blob> {
    return this.http.get(`${BASE}/invoices/${id}/pdf`, { responseType: 'blob' });
  }

  xml(id: string): Observable<Blob> {
    return this.http.get(`${BASE}/invoices/${id}/xml`, { responseType: 'blob' });
  }

  /** A ZIP of the issued invoices among `ids`; the headers `X-Invoices-Included` and `X-Invoices-Skipped` say which went in. */
  download(ids: readonly string[], format: 'PDF' | 'XML'): Observable<HttpResponse<Blob>> {
    return this.http.post(`${BASE}/invoices/download`, { ids, format }, { responseType: 'blob', observe: 'response' });
  }

  /** E-mails the invoice, or builds the WhatsApp link (`url`) the user opens. */
  deliver(id: string, channel: InvoiceDeliveryChannel, recipient: string): Observable<{ channel: InvoiceDeliveryChannel; url: string | null }> {
    return this.http.post<{ channel: InvoiceDeliveryChannel; url: string | null }>(`${BASE}/invoices/${id}/deliveries`, { channel, recipient });
  }

  /** E-mails several invoices to the e-mail of their customers. */
  deliverMany(ids: readonly string[]): Observable<{ results: InvoiceBulkResult[] }> {
    return this.http.post<{ results: InvoiceBulkResult[] }>(`${BASE}/invoices/deliveries`, { ids });
  }
}
