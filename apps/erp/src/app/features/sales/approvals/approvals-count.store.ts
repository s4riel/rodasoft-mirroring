import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ApprovalsApi } from './approvals-api.service';

/**
 * How many requests wait for a decision: the badge of the Aprobaciones tab (HU-VEN-29). It is read when the sales section opens
 * and after every decision made in the inbox; a failure leaves the badge out instead of showing a wrong number.
 */
@Injectable({ providedIn: 'root' })
export class ApprovalsCountStore {
  private readonly api = inject(ApprovalsApi);
  private readonly destroyRef = inject(DestroyRef);

  /** Null until the first answer, and after a failed one. */
  readonly pending = signal<number | null>(null);

  refresh(): void {
    this.api
      .summary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => this.pending.set(summary.pending),
        error: () => this.pending.set(null),
      });
  }

  /** Used by the inbox, which already holds the figure. */
  set(count: number): void {
    this.pending.set(count);
  }
}
