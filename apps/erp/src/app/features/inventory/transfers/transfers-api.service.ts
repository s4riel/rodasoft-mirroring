import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  TransferCloseInput,
  TransferDetail,
  TransferListResponse,
  TransferOpenCountResponse,
  TransferProductSearchResponse,
  TransferReceiptInput,
  TransferResolveResponse,
  TransferSaveInput,
  TransferStatus,
  TransferWarehousesResponse,
} from '@rodasoft/domain';
import type { Observable } from 'rxjs';

/** Query of the transfer list (IN-05); an empty value is left out of the request. */
export interface TransferListQuery {
  status?: TransferStatus;
  originWarehouseId?: string;
  destinationWarehouseId?: string;
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

const BASE = '/api/v1/inventory/transfers';

@Injectable({ providedIn: 'root' })
export class TransfersApi {
  private readonly http = inject(HttpClient);

  /** IN-05 · The transfers of the branches the user operates, filtered and paginated by the server. */
  list(query: TransferListQuery): Observable<TransferListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<TransferListResponse>(BASE, { params });
  }

  /** IN-24a · Transfers on their way to a branch the user operates (in transit or partially received). */
  incoming(query: TransferListQuery): Observable<TransferListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<TransferListResponse>(`${BASE}/incoming`, { params });
  }

  /** The count on the Transferencias tab: transfers still open that the user can see. */
  openCount(): Observable<TransferOpenCountResponse> {
    return this.http.get<TransferOpenCountResponse>(`${BASE}/open-count`);
  }

  get(id: string): Observable<TransferDetail> {
    return this.http.get<TransferDetail>(`${BASE}/${id}`);
  }

  /** Every active warehouse, flagged with whether the user may send from it. */
  warehouses(): Observable<TransferWarehousesResponse> {
    return this.http.get<TransferWarehousesResponse>(`${BASE}/warehouses`);
  }

  /** IN-06a · Products matching the text, with the stock at the origin. */
  productSearch(warehouseId: string, q: string): Observable<TransferProductSearchResponse> {
    return this.http.get<TransferProductSearchResponse>(`${BASE}/product-search`, { params: { warehouseId, q } });
  }

  /** IN-06b · Reads a pasted `code, quantity` list; nothing is saved. */
  resolveText(warehouseId: string, text: string): Observable<TransferResolveResponse> {
    return this.http.post<TransferResolveResponse>(`${BASE}/resolve-lines`, { warehouseId, text });
  }

  /** IN-06c · Reads an uploaded .xlsx or .csv with the same columns; nothing is saved. */
  resolveFile(warehouseId: string, file: File): Observable<TransferResolveResponse> {
    const body = new FormData();
    body.append('warehouseId', warehouseId);
    body.append('file', file, file.name);
    return this.http.post<TransferResolveResponse>(`${BASE}/resolve-lines`, body);
  }

  create(body: TransferSaveInput): Observable<TransferDetail> {
    return this.http.post<TransferDetail>(BASE, body);
  }

  update(id: string, body: TransferSaveInput): Observable<TransferDetail> {
    return this.http.put<TransferDetail>(`${BASE}/${id}`, body);
  }

  send(id: string, expectedUpdatedAt: string): Observable<TransferDetail> {
    return this.http.post<TransferDetail>(`${BASE}/${id}/send`, { expectedUpdatedAt });
  }

  /** Cancels a draft, or a sent transfer nothing has reached yet (its pieces go back to the origin). */
  cancel(id: string, body: { expectedUpdatedAt?: string; reason?: string } = {}): Observable<TransferDetail> {
    return this.http.post<TransferDetail>(`${BASE}/${id}/cancel`, body);
  }

  /** IN-24b · One receiving session: the pieces counted now, per product. */
  receive(id: string, body: TransferReceiptInput): Observable<TransferDetail> {
    return this.http.post<TransferDetail>(`${BASE}/${id}/receipts`, body);
  }

  /** IN-07 · Finishes the receipt, with the surplus; the differences become a pending adjustment. */
  close(id: string, body: TransferCloseInput): Observable<TransferDetail> {
    return this.http.post<TransferDetail>(`${BASE}/${id}/close`, body);
  }
}
