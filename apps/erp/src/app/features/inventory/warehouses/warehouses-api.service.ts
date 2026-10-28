import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  WarehouseCreateInput,
  WarehouseDetail,
  WarehouseListResponse,
  WarehouseSaveResponse,
  WarehouseStatus,
  WarehouseUpdateInput,
} from '@rodasoft/domain';
import type { Observable } from 'rxjs';

/** Query of the warehouse list (IN-14); an empty value is left out of the request. */
export interface WarehouseListQuery {
  branchId?: string;
  status?: WarehouseStatus;
  q?: string;
  page?: number;
  pageSize?: number;
}

@Injectable({ providedIn: 'root' })
export class WarehousesApi {
  private readonly http = inject(HttpClient);

  /** IN-14 · The warehouses of the branches the user may operate, filtered and paginated by the server. */
  list(query: WarehouseListQuery): Observable<WarehouseListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<WarehouseListResponse>('/api/v1/inventory/warehouses', { params });
  }

  /** IN-30b · The warehouse the edit form loads. */
  get(id: string): Observable<WarehouseDetail> {
    return this.http.get<WarehouseDetail>(`/api/v1/inventory/warehouses/${id}`);
  }

  /** IN-30a · Creates a warehouse. */
  create(body: WarehouseCreateInput): Observable<WarehouseSaveResponse> {
    return this.http.post<WarehouseSaveResponse>('/api/v1/inventory/warehouses', body);
  }

  /** IN-30b · Edits a warehouse; the body carries `expectedUpdatedAt` to detect a concurrent edit. */
  update(id: string, body: WarehouseUpdateInput): Observable<WarehouseSaveResponse> {
    return this.http.patch<WarehouseSaveResponse>(`/api/v1/inventory/warehouses/${id}`, body);
  }
}
