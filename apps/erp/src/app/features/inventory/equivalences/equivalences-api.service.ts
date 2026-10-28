import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  EquivalenceComparisonResponse,
  EquivalenceFilters,
  EquivalenceLinkResponse,
  EquivalenceListResponse,
  EquivalenceValidationResponse,
  LinkEquivalenceInput,
} from '@rodasoft/domain';
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

  /** IN-15c · What linking the pair would say: already linked, incompatible measures, or the differences. Writes nothing. */
  validate(body: LinkEquivalenceInput): Observable<EquivalenceValidationResponse> {
    return this.http.post<EquivalenceValidationResponse>('/api/v1/inventory/equivalences/validate', body);
  }

  /** IN-15c · Links the pair. An incompatible pair is refused with EQUIVALENCE_INCOMPATIBLE (IN-15e). */
  link(body: LinkEquivalenceInput): Observable<EquivalenceLinkResponse> {
    return this.http.post<EquivalenceLinkResponse>('/api/v1/inventory/equivalences', body);
  }

  /** Approves a pending link (decision #34). */
  approve(id: string): Observable<void> {
    return this.http.post<void>(`/api/v1/inventory/equivalences/${id}/approve`, {});
  }

  unlink(id: string): Observable<void> {
    return this.http.delete<void>(`/api/v1/inventory/equivalences/${id}`);
  }

  /** IN-13 · The products side by side, in the order given; the first one is the reference. */
  compare(ids: readonly string[]): Observable<EquivalenceComparisonResponse> {
    return this.http.get<EquivalenceComparisonResponse>('/api/v1/inventory/equivalences/compare', {
      params: new HttpParams().set('ids', ids.join(',')),
    });
  }
}
