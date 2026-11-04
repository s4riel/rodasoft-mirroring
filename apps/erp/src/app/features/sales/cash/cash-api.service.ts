import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { CashRegisterListResponse, CurrentCashShiftResponse, OpenCashShiftInput, OpenCashShiftResponse } from '@rodasoft/domain';
import type { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class CashApi {
  private readonly http = inject(HttpClient);

  /** VP-05 · The active registers of the branches the user may operate, with who has them open and their last close. */
  registers(): Observable<CashRegisterListResponse> {
    return this.http.get<CashRegisterListResponse>('/api/v1/sales/cash-registers');
  }

  /** VP-14 · The user's open shift, or `null`. The POS and the Caja tab both use it. */
  current(): Observable<CurrentCashShiftResponse> {
    return this.http.get<CurrentCashShiftResponse>('/api/v1/sales/cash-shifts/current');
  }

  /** VP-05 · Opens the user's shift with the starting float. */
  open(body: OpenCashShiftInput): Observable<OpenCashShiftResponse> {
    return this.http.post<OpenCashShiftResponse>('/api/v1/sales/cash-shifts', body);
  }
}
