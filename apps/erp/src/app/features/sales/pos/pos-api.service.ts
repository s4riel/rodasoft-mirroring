import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AddPosCheckoutItemInput,
  CompletePosCheckoutInput,
  CompletePosCheckoutResponse,
  ConfirmPosCardInput,
  CreatePosCustomerInput,
  CustomerSearchResponse,
  CustomerSummary,
  PosInvoiceDataResponse,
  PosCategoryListResponse,
  PosActiveCardResponse,
  PosActiveQrResponse,
  PosCardPaymentResponse,
  PosCheckoutResponse,
  PosPayResponse,
  PosQrOutcome,
  PosQrPaymentResponse,
  PosEquivalentsResponse,
  PosProductSearchQuery,
  PosProductSearchResponse,
  PosProductSheet,
  SaleReceipt,
  SendReceiptEmailResponse,
  StartPosCardInput,
  StartPosQrInput,
} from '@rodasoft/domain';
import type { Observable } from 'rxjs';

const BASE = '/api/v1/sales/pos';

/** VP-03 · POS search and server-side cart (HU-VEN-02). */
@Injectable({ providedIn: 'root' })
export class PosApi {
  private readonly http = inject(HttpClient);

  categories(): Observable<PosCategoryListResponse> {
    return this.http.get<PosCategoryListResponse>(`${BASE}/categories`);
  }

  search(query: PosProductSearchQuery): Observable<PosProductSearchResponse> {
    let params = new HttpParams().set('q', query.q);
    if (query.categoryId) params = params.set('categoryId', query.categoryId);
    return this.http.get<PosProductSearchResponse>(`${BASE}/product-search`, { params });
  }

  /** VP-03b (HU-VEN-03): in-stock equivalents of a product and the original's stock in other branches. */
  equivalents(productId: string): Observable<PosEquivalentsResponse> {
    return this.http.get<PosEquivalentsResponse>(`${BASE}/products/${productId}/equivalents`);
  }

  /** VP-03e (HU-VEN-04): the technical sheet of a product, without costs. */
  sheet(productId: string): Observable<PosProductSheet> {
    return this.http.get<PosProductSheet>(`${BASE}/products/${productId}/sheet`);
  }

  /** The bytes of a stored photo, fetched with the session. Keys are `company/kind/name`. */
  file(key: string): Observable<Blob> {
    const [, kind, name] = key.split('/');
    return this.http.get(`/api/v1/inventory/files/${kind}/${name}`, { responseType: 'blob' });
  }

  /** VP-03c (HU-VEN-05): searches customers by name or document. */
  customers(q: string): Observable<CustomerSearchResponse> {
    return this.http.get<CustomerSearchResponse>(`${BASE}/customers`, { params: new HttpParams().set('q', q) });
  }

  /** VP-03c: quick creation of a customer (no discount, no credit). */
  createCustomer(body: CreatePosCustomerInput): Observable<CustomerSummary> {
    return this.http.post<CustomerSummary>(`${BASE}/customers`, body);
  }

  /** Sets the customer of the cart, or `null` to invoice a final consumer. */
  setCustomer(customerId: string | null): Observable<PosCheckoutResponse> {
    return this.http.put<PosCheckoutResponse>(`${BASE}/checkout/customer`, { customerId });
  }

  /** The tax data the invoice will carry; refuses a customer whose document is not valid. */
  invoiceData(): Observable<PosInvoiceDataResponse> {
    return this.http.get<PosInvoiceDataResponse>(`${BASE}/checkout/invoice-data`);
  }

  checkout(): Observable<PosCheckoutResponse> {
    return this.http.get<PosCheckoutResponse>(`${BASE}/checkout`);
  }

  addItem(body: AddPosCheckoutItemInput): Observable<PosCheckoutResponse> {
    return this.http.post<PosCheckoutResponse>(`${BASE}/checkout/items`, body);
  }

  updateItem(id: string, quantity: number): Observable<PosCheckoutResponse> {
    return this.http.patch<PosCheckoutResponse>(`${BASE}/checkout/items/${id}`, { quantity });
  }

  /** HU-VEN-33: every line of the cart in the order the cashier wants. */
  reorderItems(itemIds: string[]): Observable<PosCheckoutResponse> {
    return this.http.put<PosCheckoutResponse>(`${BASE}/checkout/items/order`, { itemIds });
  }

  removeItem(id: string): Observable<PosCheckoutResponse> {
    return this.http.delete<PosCheckoutResponse>(`${BASE}/checkout/items/${id}`);
  }

  /** VP-04 (HU-VEN-07): freezes the total and opens the payment; a changed price answers `CHECKOUT_PRICES_CHANGED`. */
  pay(): Observable<PosPayResponse> {
    return this.http.post<PosPayResponse>(`${BASE}/checkout/pay`, {});
  }

  /** "Cancelar" on the payment screen: the cart goes back to `OPEN`. */
  back(): Observable<PosCheckoutResponse> {
    return this.http.post<PosCheckoutResponse>(`${BASE}/checkout/back`, {});
  }

  /** VP-16a (HU-VEN-11): charges and completes the sale. */
  complete(body: CompletePosCheckoutInput): Observable<CompletePosCheckoutResponse> {
    return this.http.post<CompletePosCheckoutResponse>(`${BASE}/checkout/complete`, body);
  }

  /** VP-04b (HU-VEN-08): the QR my cart waits for or already got confirmed, to resume after a refresh. */
  activeQr(): Observable<PosActiveQrResponse> {
    return this.http.get<PosActiveQrResponse>(`${BASE}/checkout/payments/qr`);
  }

  /** Opens a QR for the whole total. The same key returns the same payment. */
  startQr(body: StartPosQrInput): Observable<PosQrPaymentResponse> {
    return this.http.post<PosQrPaymentResponse>(`${BASE}/checkout/payments/qr`, body);
  }

  /** The state of a QR payment; polled while the screen waits for the customer. */
  qrPayment(id: string): Observable<PosQrPaymentResponse> {
    return this.http.get<PosQrPaymentResponse>(`${BASE}/checkout/payments/${id}`);
  }

  /** The cashier reports whether the customer paid (mock provider, decision #6). */
  confirmQr(id: string, outcome: PosQrOutcome): Observable<PosQrPaymentResponse> {
    return this.http.post<PosQrPaymentResponse>(`${BASE}/checkout/payments/${id}/confirm`, { outcome });
  }

  /** "Cambiar método": drops a pending QR. */
  cancelQr(id: string): Observable<PosQrPaymentResponse> {
    return this.http.post<PosQrPaymentResponse>(`${BASE}/checkout/payments/${id}/cancel`, {});
  }

  /** VP-12 (HU-VEN-10): the card attempt my cart waits for, got approved or was declined, to resume after a refresh. */
  activeCard(): Observable<PosActiveCardResponse> {
    return this.http.get<PosActiveCardResponse>(`${BASE}/checkout/payments/card`);
  }

  /** Opens a card attempt for the whole total. The same key returns the same attempt; a retry needs a new key. */
  startCard(body: StartPosCardInput): Observable<PosCardPaymentResponse> {
    return this.http.post<PosCardPaymentResponse>(`${BASE}/checkout/payments/card`, body);
  }

  /** The cashier reports what the terminal said: approved with the voucher's code, or declined with a reason (mock provider, decision #8). */
  confirmCard(id: string, body: ConfirmPosCardInput): Observable<PosCardPaymentResponse> {
    return this.http.post<PosCardPaymentResponse>(`${BASE}/checkout/payments/card/${id}/confirm`, body);
  }

  /** "Cambiar forma de pago": drops a pending card attempt. */
  cancelCard(id: string): Observable<PosCardPaymentResponse> {
    return this.http.post<PosCardPaymentResponse>(`${BASE}/checkout/payments/card/${id}/cancel`, {});
  }

  /** The receipt of a completed sale, for the ticket and the WhatsApp text. */
  receipt(saleId: string): Observable<SaleReceipt> {
    return this.http.get<SaleReceipt>(`/api/v1/sales/sales/${saleId}/receipt`);
  }

  /** Queues the receipt e-mail. */
  sendReceiptEmail(saleId: string, email: string): Observable<SendReceiptEmailResponse> {
    return this.http.post<SendReceiptEmailResponse>(`/api/v1/sales/sales/${saleId}/receipt/email`, { email });
  }
}
