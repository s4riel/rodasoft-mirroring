import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { ProductFilterOptions, ProductListQuery, ProductListResponse } from '@rodasoft/domain';
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
}
