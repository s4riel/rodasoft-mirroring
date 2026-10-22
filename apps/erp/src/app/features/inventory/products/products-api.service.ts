import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  DuplicateProductRequest,
  DuplicateProductResponse,
  ProductDetail,
  ProductEquivalentsResponse,
  ProductFilterOptions,
  ProductListQuery,
  ProductListResponse,
} from '@rodasoft/domain';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ProductsApi {
  private readonly http = inject(HttpClient);

  list(query: ProductListQuery): Observable<ProductListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<ProductListResponse>('/api/v1/inventory/products', { params });
  }

  filterOptions(): Observable<ProductFilterOptions> {
    return this.http.get<ProductFilterOptions>('/api/v1/inventory/filter-options');
  }

  detail(id: string): Observable<ProductDetail> {
    return this.http.get<ProductDetail>(`/api/v1/inventory/products/${id}`);
  }

  equivalents(id: string, query: { page?: number; pageSize?: number } = {}): Observable<ProductEquivalentsResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params = params.set(key, String(value));
    return this.http.get<ProductEquivalentsResponse>(`/api/v1/inventory/products/${id}/equivalents`, { params });
  }

  duplicate(id: string, body: DuplicateProductRequest): Observable<DuplicateProductResponse> {
    return this.http.post<DuplicateProductResponse>(`/api/v1/inventory/products/${id}/duplicate`, body);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/inventory/products/${id}`);
  }
}
