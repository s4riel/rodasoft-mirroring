import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import type { SalesOrderDetail } from '@rodasoft/domain';
import { ButtonComponent, EmptyStateIllustratedComponent, ReceiptComponent, SkeletonComponent } from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { dispatchOrderDocument } from './order-format';
import { OrdersApi } from './orders-api.service';

type LoadState = 'loading' | 'ready' | 'forbidden' | 'error';

/**
 * The dispatch order of an order (HU-VEN-20 "Imprimir orden de despacho"), opened in its own tab: the pieces still pending, on
 * letter paper with `rs-receipt`, and the print dialog. Outside the ERP shell, like the printed quote.
 */
@Component({
  selector: 'rs-order-print-page',
  imports: [ButtonComponent, EmptyStateIllustratedComponent, ReceiptComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './order-print.page.html',
  styleUrl: './order-print.page.scss',
})
export class OrderPrintPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(OrdersApi);
  private readonly doc = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<LoadState>('loading');
  protected readonly order = signal<SalesOrderDetail | null>(null);
  protected readonly errorText = signal('');
  protected readonly document = computed(() => {
    const order = this.order();
    return order ? dispatchOrderDocument(order) : null;
  });

  ngOnInit() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .detail(this.route.snapshot.paramMap.get('id') ?? '')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          this.order.set(order);
          this.state.set('ready');
          // the order is drawn before the print dialog opens
          setTimeout(() => this.print());
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.errorText.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  protected print() {
    this.doc.defaultView?.print();
  }
}
