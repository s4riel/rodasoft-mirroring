import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { EquivalenceComparisonResponse, EquivalenceFilters, EquivalenceListResponse } from '@rodasoft/domain';
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

  /** IN-13 · The products side by side, in the order given; the first one is the reference. */
  compare(ids: readonly string[]): Observable<EquivalenceComparisonResponse> {
    return this.http.get<EquivalenceComparisonResponse>('/api/v1/inventory/equivalences/compare', {
      params: new HttpParams().set('ids', ids.join(',')),
    });
  }
}
