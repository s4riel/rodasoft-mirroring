import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AddPosCheckoutItemInput,
  PosCategoryListResponse,
  PosCheckoutResponse,
  PosEquivalentsResponse,
  PosProductSearchQuery,
  PosProductSearchResponse,
  PosProductSheet,
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

  checkout(): Observable<PosCheckoutResponse> {
    return this.http.get<PosCheckoutResponse>(`${BASE}/checkout`);
  }

  addItem(body: AddPosCheckoutItemInput): Observable<PosCheckoutResponse> {
    return this.http.post<PosCheckoutResponse>(`${BASE}/checkout/items`, body);
  }

  updateItem(id: string, quantity: number): Observable<PosCheckoutResponse> {
    return this.http.patch<PosCheckoutResponse>(`${BASE}/checkout/items/${id}`, { quantity });
  }

  removeItem(id: string): Observable<PosCheckoutResponse> {
    return this.http.delete<PosCheckoutResponse>(`${BASE}/checkout/items/${id}`);
  }
}
