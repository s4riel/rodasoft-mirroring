import { HttpClient, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CashMovementDecisionInput,
  CashMovementDetail,
  CashRegisterListResponse,
  CashShiftDetail,
  CloseCashShiftInput,
  CloseCashShiftResponse,
  CreateCashMovementInput,
  CurrentCashShiftResponse,
  OpenCashShiftInput,
  OpenCashShiftResponse,
} from '@rodasoft/domain';
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

  /** VP-22 and VP-06 · The shift with its sales per payment method, the cash it should hold and its movements. */
  shift(id: string): Observable<CashShiftDetail> {
    return this.http.get<CashShiftDetail>(`/api/v1/sales/cash-shifts/${id}`);
  }

  /** VP-22b · Registers an income or an expense, with an optional receipt. The key makes a repeated request harmless. */
  createMovement(shiftId: string, body: CreateCashMovementInput, receipt: File | null, idempotencyKey: string): Observable<CashMovementDetail> {
    const form = new FormData();
    form.set('type', body.type);
    form.set('amount', body.amount);
    form.set('concept', body.concept);
    if (body.detail) form.set('detail', body.detail);
    if (receipt) form.set('receipt', receipt, receipt.name);
    return this.http.post<CashMovementDetail>(`/api/v1/sales/cash-shifts/${shiftId}/movements`, form, {
      headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey }),
    });
  }

  /** VP-06 · Closes the shift with the count and the declared QR, card and transfer. */
  close(shiftId: string, body: CloseCashShiftInput): Observable<CloseCashShiftResponse> {
    return this.http.post<CloseCashShiftResponse>(`/api/v1/sales/cash-shifts/${shiftId}/close`, body);
  }

  movement(id: string): Observable<CashMovementDetail> {
    return this.http.get<CashMovementDetail>(`/api/v1/sales/cash-movements/${id}`);
  }

  /** The receipt file, to open in a new tab (the request carries the session, so a plain link would not). */
  receipt(id: string): Observable<Blob> {
    return this.http.get(`/api/v1/sales/cash-movements/${id}/receipt`, { responseType: 'blob' });
  }

  approve(id: string, body: CashMovementDecisionInput): Observable<CashMovementDetail> {
    return this.http.post<CashMovementDetail>(`/api/v1/sales/cash-movements/${id}/approve`, body);
  }

  reject(id: string, body: CashMovementDecisionInput): Observable<CashMovementDetail> {
    return this.http.post<CashMovementDetail>(`/api/v1/sales/cash-movements/${id}/reject`, body);
  }

  withdraw(id: string): Observable<CashMovementDetail> {
    return this.http.post<CashMovementDetail>(`/api/v1/sales/cash-movements/${id}/withdraw`, {});
  }
}
