import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  AdjustmentDetail,
  AdjustmentKind,
  AdjustmentListResponse,
  AdjustmentProductSearchResponse,
  AdjustmentReason,
  AdjustmentResolveResponse,
  CreateAdjustmentResponse,
  StockAdjustmentDocumentStatus,
} from '@rodasoft/domain';
import type { Observable } from 'rxjs';

/** Query of the adjustment list (IN-27); an empty value is left out of the request. */
export interface AdjustmentListQuery {
  status?: StockAdjustmentDocumentStatus;
  warehouseId?: string;
  reason?: AdjustmentReason;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

/** Body of the new adjustment (IN-08). */
export interface AdjustmentCreateInput {
  warehouseId: string;
  reason: AdjustmentReason | null;
  note?: string;
  lines: { productId: string; kind: AdjustmentKind; quantity: number; expectedBalance?: number }[];
}

const BASE = '/api/v1/inventory/adjustments';

@Injectable({ providedIn: 'root' })
export class AdjustmentsApi {
  private readonly http = inject(HttpClient);

  /** IN-27 · The adjustments of the branches the user operates, filtered and paginated by the server. */
  list(query: AdjustmentListQuery): Observable<AdjustmentListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<AdjustmentListResponse>(BASE, { params });
  }

  get(id: string): Observable<AdjustmentDetail> {
    return this.http.get<AdjustmentDetail>(`${BASE}/${id}`);
  }

  /** IN-08 · Active products matching the text, with their stock in the warehouse being adjusted. */
  productSearch(warehouseId: string, q: string): Observable<AdjustmentProductSearchResponse> {
    return this.http.get<AdjustmentProductSearchResponse>(`${BASE}/product-search`, { params: { warehouseId, q } });
  }

  /** IN-08 · Reads a pasted `code, quantity[, kind]` list; nothing is saved. */
  resolveText(warehouseId: string, text: string): Observable<AdjustmentResolveResponse> {
    return this.http.post<AdjustmentResolveResponse>(`${BASE}/resolve-lines`, { warehouseId, text });
  }

  /** IN-08 · Reads an uploaded .xlsx or .csv with the same columns; nothing is saved. */
  resolveFile(warehouseId: string, file: File): Observable<AdjustmentResolveResponse> {
    const body = new FormData();
    body.append('warehouseId', warehouseId);
    body.append('file', file, file.name);
    return this.http.post<AdjustmentResolveResponse>(`${BASE}/resolve-lines`, body);
  }

  /** IN-08 · Records the adjustment; the stock changes at once. */
  create(body: AdjustmentCreateInput): Observable<CreateAdjustmentResponse> {
    return this.http.post<CreateAdjustmentResponse>(BASE, body);
  }
}
