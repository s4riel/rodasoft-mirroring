import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import type { CurrentCashShift } from '@rodasoft/domain';
import { ButtonComponent, EmptyStateIllustratedComponent, PageHeaderComponent, SkeletonComponent } from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { CashApi } from './cash-api.service';
import { formatBs, formatDateTime } from './cash-format';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/**
 * `Caja` tab. Without a shift it goes to the opening form (VP-05); with one it shows a minimal "Turno abierto" summary
 * until HU-VEN-22 replaces it with the cash register screen (VP-22).
 */
@Component({
  selector: 'rs-cash-register-page',
  imports: [ButtonComponent, EmptyStateIllustratedComponent, PageHeaderComponent, RouterLink, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cash-register.page.html',
  styleUrl: './cash-register.page.scss',
})
export class CashRegisterPage implements OnInit {
  private readonly api = inject(CashApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<LoadState>('loading');
  protected readonly shift = signal<CurrentCashShift | null>(null);
  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Ventas y POS', link: '/sales' }, { label: 'Caja' }];
  protected readonly formatBs = formatBs;
  protected readonly formatDateTime = formatDateTime;

  ngOnInit() {
    if (!this.ctx.can('sales.cash-register.open')) {
      this.state.set('forbidden');
      return;
    }
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .current()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ shift }) => {
          if (!shift) {
            void this.router.navigate(['/sales/cash-register/open'], { replaceUrl: true });
            return;
          }
          this.shift.set(shift);
          this.state.set('ready');
        },
        error: (err: unknown) => this.state.set(problemOf(err).status === 403 ? 'forbidden' : 'error'),
      });
  }
}
