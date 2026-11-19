import { HttpClient, HttpParams, type HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CatalogEntriesResponse,
  CatalogSummary,
  CreatePointOfSaleInput,
  CreateCreditNoteInput,
  CreditableInvoice,
  CreditNoteDetail,
  CreditNoteListQuery,
  CreditNoteListResponse,
  FiscalSettingsSummary,
  HomologationImportPreview,
  HomologationImportResult,
  HomologationListQuery,
  HomologationResponse,
  HomologationRow,
  HomologationUpdateInput,
  InvoiceBulkResult,
  InvoiceCancellationsResponse,
  InvoiceDeliveryChannel,
  InvoiceDetail,
  InvoiceListQuery,
  InvoiceListResponse,
  InvoicingStatus,
  PointOfSaleListItem,
  PointOfSaleListResponse,
  PurchaseBookRow,
  PurchasesBookResponse,
  SalesBookResponse,
  SaveActivityInput,
  SaveCredentialsInput,
  SiatConnectionStatus,
  SiatPointOfSaleStatus,
  SiatSystemStatus,
  VatBook,
  VatBookExportFormat,
  VatPeriodBlockers,
  VatPeriodRow,
  VatPeriodsResponse,
} from '@rodasoft/domain';
import type { Observable } from 'rxjs';

const BASE = '/api/v1/invoicing';

/** Query parameters of a request: an empty value is left out. */
function toParams(query: object): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
  }
  return params;
}

/** The SIAT invoices, credit notes, system status and VAT books (HU-FAC-01…13, 18…20). */
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

  // ── Credit and debit notes (HU-FAC-11, HU-FAC-12) ──

  notes(query: CreditNoteListQuery): Observable<CreditNoteListResponse> {
    return this.http.get<CreditNoteListResponse>(`${BASE}/notes`, { params: toParams(query) });
  }

  note(id: string): Observable<CreditNoteDetail> {
    return this.http.get<CreditNoteDetail>(`${BASE}/notes/${id}`);
  }

  /** What is still creditable of an invoice, and whether the company allows a price-adjustment note. */
  creditable(invoiceId: string): Observable<CreditableInvoice> {
    return this.http.get<CreditableInvoice>(`${BASE}/invoices/${invoiceId}/creditable`);
  }

  createNote(invoiceId: string, body: CreateCreditNoteInput): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${BASE}/invoices/${invoiceId}/credit-notes`, body);
  }

  issueNote(id: string): Observable<void> {
    return this.http.post<void>(`${BASE}/notes/${id}/issue`, {});
  }

  /** Gives up a note the SIAT never validated. */
  voidNote(id: string): Observable<void> {
    return this.http.post<void>(`${BASE}/notes/${id}/void`, {});
  }

  notePdf(id: string): Observable<Blob> {
    return this.http.get(`${BASE}/notes/${id}/pdf`, { responseType: 'blob' });
  }

  noteXml(id: string): Observable<Blob> {
    return this.http.get(`${BASE}/notes/${id}/xml`, { responseType: 'blob' });
  }

  // ── SIAT system status (HU-FAC-13) ──

  systemStatus(): Observable<SiatSystemStatus> {
    return this.http.get<SiatSystemStatus>(`${BASE}/system-status`);
  }

  renewCufd(pointOfSaleId: string): Observable<SiatPointOfSaleStatus> {
    return this.http.post<SiatPointOfSaleStatus>(`${BASE}/points-of-sale/${pointOfSaleId}/renew-cufd`, {});
  }

  testConnection(): Observable<{ connection: SiatConnectionStatus; checkedAt: string }> {
    return this.http.post<{ connection: SiatConnectionStatus; checkedAt: string }>(`${BASE}/test-connection`, {});
  }

  // ── VAT books (HU-FAC-18, HU-FAC-19, HU-FAC-20) ──

  salesBook(period: string, branchId?: string): Observable<SalesBookResponse> {
    return this.http.get<SalesBookResponse>(`${BASE}/vat-books/sales`, { params: toParams({ period, branchId }) });
  }

  purchasesBook(period: string): Observable<PurchasesBookResponse> {
    return this.http.get<PurchasesBookResponse>(`${BASE}/vat-books/purchases`, { params: toParams({ period }) });
  }

  /** Asks the SIN about the supplier's NIT (a corrected one when given) and validates the purchase when it knows it. */
  verifyPurchaseNit(id: string, supplierNit?: string): Observable<{ valid: boolean; messages: { code: number; description: string }[]; entry: PurchaseBookRow }> {
    return this.http.post<{ valid: boolean; messages: { code: number; description: string }[]; entry: PurchaseBookRow }>(`${BASE}/vat-books/purchases/${id}/verify-nit`, supplierNit ? { supplierNit } : {});
  }

  /** The book as a file; `X-Vat-Book-Draft` says whether the period is still open. */
  exportBook(book: VatBook, period: string, format: VatBookExportFormat): Observable<HttpResponse<Blob>> {
    return this.http.get(`${BASE}/vat-books/export`, { params: toParams({ book, period, format }), responseType: 'blob', observe: 'response' });
  }

  // ── Closing VAT periods (HU-FAC-21) ──

  periods(): Observable<VatPeriodsResponse> {
    return this.http.get<VatPeriodsResponse>(`${BASE}/vat-periods`);
  }

  periodBlockers(period: string): Observable<VatPeriodBlockers> {
    return this.http.get<VatPeriodBlockers>(`${BASE}/vat-periods/${period}/blockers`);
  }

  closePeriod(period: string): Observable<VatPeriodRow> {
    return this.http.post<VatPeriodRow>(`${BASE}/vat-periods/${period}/close`, {});
  }

  filePeriod(period: string): Observable<VatPeriodRow> {
    return this.http.post<VatPeriodRow>(`${BASE}/vat-periods/${period}/file`, {});
  }

  reopenPeriod(period: string, reason: string): Observable<VatPeriodRow> {
    return this.http.post<VatPeriodRow>(`${BASE}/vat-periods/${period}/reopen`, { reason });
  }

  // ── Fiscal configuration (HU-FAC-22…27) ──

  fiscalSettings(): Observable<FiscalSettingsSummary> {
    return this.http.get<FiscalSettingsSummary>(`${BASE}/fiscal-settings`);
  }

  saveSignature(file: File, password: string): Observable<FiscalSettingsSummary['signature']> {
    const body = new FormData();
    body.append('file', file, file.name);
    body.append('password', password);
    return this.http.put<FiscalSettingsSummary['signature']>(`${BASE}/fiscal-settings/signature`, body);
  }

  saveCredentials(input: SaveCredentialsInput): Observable<FiscalSettingsSummary['credentials']> {
    return this.http.put<FiscalSettingsSummary['credentials']>(`${BASE}/fiscal-settings/credentials`, input);
  }

  saveActivity(input: SaveActivityInput): Observable<FiscalSettingsSummary['activity']> {
    return this.http.put<FiscalSettingsSummary['activity']>(`${BASE}/fiscal-settings/activity`, input);
  }

  enableProduction(confirmation: string): Observable<{ environment: 'PRODUCTION'; productionEnabledAt: string }> {
    return this.http.post<{ environment: 'PRODUCTION'; productionEnabledAt: string }>(`${BASE}/fiscal-settings/production`, { confirmation });
  }

  pointsOfSale(): Observable<PointOfSaleListResponse> {
    return this.http.get<PointOfSaleListResponse>(`${BASE}/points-of-sale`);
  }

  createPointOfSale(input: CreatePointOfSaleInput): Observable<PointOfSaleListItem> {
    return this.http.post<PointOfSaleListItem>(`${BASE}/points-of-sale`, input);
  }

  deactivatePointOfSale(id: string): Observable<PointOfSaleListItem> {
    return this.http.post<PointOfSaleListItem>(`${BASE}/points-of-sale/${id}/deactivate`, {});
  }

  catalogSummary(): Observable<CatalogSummary> {
    return this.http.get<CatalogSummary>(`${BASE}/catalogs`);
  }

  catalogEntries(catalog: string, query: { q?: string; page?: number; pageSize?: number }): Observable<CatalogEntriesResponse> {
    return this.http.get<CatalogEntriesResponse>(`${BASE}/catalogs/${catalog}`, { params: toParams(query) });
  }

  syncCatalogs(): Observable<CatalogSummary> {
    return this.http.post<CatalogSummary>(`${BASE}/catalogs/sync`, {});
  }

  /** The reasons of the cancellation and credit-note dialogs, from the synced catalogue. */
  reasons(): Observable<{ cancellation: { code: number; description: string }[]; creditNote: { code: number; description: string }[] }> {
    return this.http.get<{ cancellation: { code: number; description: string }[]; creditNote: { code: number; description: string }[] }>(`${BASE}/reasons`);
  }

  homologation(query: HomologationListQuery): Observable<HomologationResponse> {
    return this.http.get<HomologationResponse>(`${BASE}/homologation`, { params: toParams(query) });
  }

  homologateProduct(id: string, input: HomologationUpdateInput): Observable<HomologationRow> {
    return this.http.put<HomologationRow>(`${BASE}/homologation/products/${id}`, input);
  }

  homologationTemplate(): Observable<HttpResponse<Blob>> {
    return this.http.get(`${BASE}/homologation/template`, { responseType: 'blob', observe: 'response' });
  }

  previewHomologationImport(file: File): Observable<HomologationImportPreview> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<HomologationImportPreview>(`${BASE}/homologation/import/preview`, body);
  }

  importHomologation(file: File): Observable<HomologationImportResult> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http.post<HomologationImportResult>(`${BASE}/homologation/import`, body);
  }
}
