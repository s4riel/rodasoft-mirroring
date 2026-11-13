import { HttpClient } from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { InvoicingStatus } from '@rodasoft/domain';
import { ToastService } from '@rodasoft/ui';

export const INVOICING_STATUS_POLL_MS = 60_000;

/**
 * SIAT link status for the shell (sidebar pill, "Facturación" badge, "back online" toast).
 * Polls `/invoicing/status` once a minute. A user without invoicing permission gets a 403:
 * the pill then stays "Sin configurar" and nothing else shows.
 */
@Injectable({ providedIn: 'root' })
export class InvoicingStatusStore {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private timer: ReturnType<typeof setInterval> | null = null;

  private readonly state = signal<InvoicingStatus | null>(null);
  readonly status = this.state.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Starts the polling (idempotent) and loads once right away. */
  start(): void {
    if (this.timer !== null) return;
    this.refresh();
    this.timer = setInterval(() => this.refresh(), INVOICING_STATUS_POLL_MS);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  refresh(): void {
    this.http.get<InvoicingStatus>('/api/v1/invoicing/status').subscribe({
      next: (next) => this.apply(next),
      // a transient failure keeps the last known state; only "no access" or "not available" clears it
      error: (err: { status?: number }) => {
        if (err.status === 403 || err.status === 404) {
          this.state.set(null);
          // no access to invoicing: asking again every minute only adds noise
          this.stop();
        }
      },
    });
  }

  private apply(next: InvoicingStatus): void {
    const before = this.state();
    this.state.set(next);
    if (before?.connection === 'OFFLINE' && next.connection === 'ONLINE') {
      const n = next.notIssued;
      this.toast.success(
        n > 0 ? `El SIAT volvió a estar en línea · ${n} ${n === 1 ? 'factura sin emitir' : 'facturas sin emitir'}. Revísalas en Facturación.` : 'El SIAT volvió a estar en línea.',
        { duration: 0 },
      );
    }
  }
}
