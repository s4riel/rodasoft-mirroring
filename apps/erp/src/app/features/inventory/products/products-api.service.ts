import { HttpClient, HttpEventType, HttpParams, HttpXhrBackend } from '@angular/common/http';
import { EnvironmentInjector, inject, Injectable, runInInjectionContext } from '@angular/core';
import { authInterceptor } from '../../../core/auth/auth.interceptor';
import type {
  AttributeDefinitionItem,
  CategoryAttributeDefinitionsResponse,
  CodeAvailabilityResponse,
  DuplicateProductRequest,
  DuplicateProductResponse,
  ProductDetail,
  ProductEquivalentsResponse,
  ProductFilterOptions,
  ProductListQuery,
  ProductListResponse,
  ProductMovementsResponse,
  ProductWarehouseStockResponse,
  EquivalenceLinkResponse,
  EquivalenceSuggestionsResponse,
  ProductWriteRequest,
  ProductWriteResponse,
} from '@rodasoft/domain';
import { filter, map, type Observable } from 'rxjs';

/** Measures and fields typed so far, to look for equivalents of a product that is not saved yet. */
export interface EquivalenceCandidatesRequest {
  categoryId: string;
  innerDiameter: string;
  outerDiameter: string;
  width: string;
  attributes?: Record<string, unknown>;
}

/** What an upload reports: its progress while the bytes go up, then the stored file. */
export type UploadEvent = { type: 'progress'; percent: number } | { type: 'done'; response: UploadedFileResponse };

export interface UploadedFileResponse {
  key: string;
  kind: 'photo' | 'datasheet';
  contentType: string;
  size: number;
}

@Injectable({ providedIn: 'root' })
export class ProductsApi {
  private readonly http = inject(HttpClient);
  /**
   * The app talks through `fetch` (`withFetch()`), which cannot report upload progress. Uploads go through this client
   * instead: the same interceptors (company, token, renewal on 401) over the XHR backend, which does report it.
   */
  private readonly uploadHttp = ((): HttpClient => {
    const xhr = inject(HttpXhrBackend);
    const injector = inject(EnvironmentInjector);
    return new HttpClient({ handle: (req) => runInInjectionContext(injector, () => authInterceptor(req, (r) => xhr.handle(r))) });
  })();

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

  movements(id: string, query: { page?: number; pageSize?: number } = {}): Observable<ProductMovementsResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined) params = params.set(key, String(value));
    return this.http.get<ProductMovementsResponse>(`/api/v1/inventory/products/${id}/movements`, { params });
  }

  stockByWarehouse(id: string): Observable<ProductWarehouseStockResponse> {
    return this.http.get<ProductWarehouseStockResponse>(`/api/v1/inventory/products/${id}/stock`);
  }

  duplicate(id: string, body: DuplicateProductRequest): Observable<DuplicateProductResponse> {
    return this.http.post<DuplicateProductResponse>(`/api/v1/inventory/products/${id}/duplicate`, body);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/inventory/products/${id}`);
  }

  attributeDefinitions(categoryId: string): Observable<AttributeDefinitionItem[]> {
    return this.http
      .get<CategoryAttributeDefinitionsResponse>(`/api/v1/inventory/categories/${categoryId}/attribute-definitions`)
      .pipe(map((response) => response.items));
  }

  codeAvailability(brandId: string, code: string): Observable<CodeAvailabilityResponse> {
    const params = new HttpParams().set('brandId', brandId).set('code', code);
    return this.http.get<CodeAvailabilityResponse>('/api/v1/inventory/products/code-availability', { params });
  }

  create(body: ProductWriteRequest): Observable<ProductWriteResponse> {
    return this.http.post<ProductWriteResponse>('/api/v1/inventory/products', body);
  }

  candidates(body: EquivalenceCandidatesRequest): Observable<EquivalenceSuggestionsResponse> {
    return this.http.post<EquivalenceSuggestionsResponse>('/api/v1/inventory/equivalence-candidates', body);
  }

  /** The bytes of an uploaded file, fetched with the session so a photo can be previewed. Keys are company/kind/name. */
  file(key: string): Observable<Blob> {
    const [, kind, name] = key.split('/');
    return this.http.get(`/api/v1/inventory/files/${kind}/${name}`, { responseType: 'blob' });
  }

  /** Uploads a photo or a datasheet; the returned key is saved with the product (HU-INV-06 step 4). */
  upload(file: File, kind: 'photo' | 'datasheet', code: string): Observable<UploadEvent> {
    const body = new FormData();
    body.append('file', file);
    body.append('kind', kind);
    body.append('code', code);
    return this.uploadHttp.post<UploadedFileResponse>('/api/v1/inventory/uploads', body, { observe: 'events', reportProgress: true }).pipe(
      map((event): UploadEvent | null => {
        if (event.type === HttpEventType.UploadProgress) {
          return { type: 'progress', percent: event.total ? Math.round((event.loaded / event.total) * 100) : 0 };
        }
        return event.type === HttpEventType.Response && event.body ? { type: 'done', response: event.body } : null;
      }),
      filter((event): event is UploadEvent => event !== null),
    );
  }

  saveDraft(id: string, body: ProductWriteRequest): Observable<ProductWriteResponse> {
    return this.http.patch<ProductWriteResponse>(`/api/v1/inventory/products/${id}/draft`, body);
  }

  equivalenceSuggestions(id: string): Observable<EquivalenceSuggestionsResponse> {
    return this.http.get<EquivalenceSuggestionsResponse>(`/api/v1/inventory/products/${id}/equivalence-suggestions`);
  }

  linkEquivalence(productAId: string, productBId: string): Observable<EquivalenceLinkResponse> {
    return this.http.post<EquivalenceLinkResponse>('/api/v1/inventory/equivalences', { productAId, productBId });
  }
}
