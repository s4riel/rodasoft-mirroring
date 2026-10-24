import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { EquivalenceFilters, EquivalenceListResponse } from '@rodasoft/domain';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class EquivalencesApi {
  private readonly http = inject(HttpClient);

  /** IN-15a · The company-wide table of links, filtered and paginated by the server. */
  list(query: EquivalenceFilters): Observable<EquivalenceListResponse> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<EquivalenceListResponse>('/api/v1/inventory/equivalences', { params });
  }
}
