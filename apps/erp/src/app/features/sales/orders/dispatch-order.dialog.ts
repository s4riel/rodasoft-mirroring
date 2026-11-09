import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Decimal, dispatchableQuantity, dispatchTotals, type SalesOrderDetail, type SalesOrderLineDetail } from '@rodasoft/domain';
import { ButtonComponent, ModalComponent, NoteComponent, QtyStepperComponent } from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs } from '../cash/cash-format';
import { newIdempotencyKey } from '../pos/idempotency-key';
import { piecesLabel } from './order-format';
import { OrdersApi } from './orders-api.service';

/**
 * VP-19b · Despachar y facturar (HU-VEN-20). The salesperson picks how many pieces of each line leave today; each dispatch
 * makes its own invoice for what was delivered and the balance stays pending on the order. With partial dispatch off
 * (`sales.allowPartialDispatch`) the steppers stay at everything that is pending. The total is a preview: the server's wins.
 */
@Component({
  selector: 'rs-dispatch-order-dialog',
  imports: [ButtonComponent, ModalComponent, NoteComponent, QtyStepperComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dispatch-order.dialog.html',
  styleUrl: './dispatch-order.dialog.scss',
})
export class DispatchOrderDialog {
  private readonly api = inject(OrdersApi);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly order = input.required<SalesOrderDetail>();
  /** The dispatch was made: the order as it is now. */
  readonly dispatched = output<SalesOrderDetail>();

  /** Pieces chosen per order line; a line that is not in the map gives everything it can. */
  private readonly chosen = signal<Record<string, number>>({});
  /** One key per set of quantities, so a retry of the same request is harmless and a changed one is a new request. */
  private idempotencyKey = newIdempotencyKey();
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  /** The lines that still have something to give. */
  protected readonly lines = computed(() => this.order().lines.filter((line) => dispatchableQuantity(line) > 0));
  protected readonly locked = computed(() => !this.order().partialDispatchAllowed);

  protected readonly picks = computed(() => this.lines().map((line) => ({ line, quantity: this.quantityOf(line) })));
  protected readonly pieces = computed(() => this.picks().reduce((sum, pick) => sum + pick.quantity, 0));
  protected readonly remaining = computed(
    () => this.order().lines.reduce((sum, line) => sum + line.pendingQuantity, 0) - this.pieces(),
  );
  protected readonly canSend = computed(() => this.pieces() > 0 && !this.saving());

  protected readonly total = computed(() => {
    const order = this.order();
    if (this.pieces() === 0) return Decimal.zero();
    if (this.remaining() === 0) return Decimal.of(order.total).sub(Decimal.of(order.invoicedTotal));
    return dispatchTotals({
      order: {
        subtotal: Decimal.of(order.subtotal),
        discountAmount: Decimal.of(order.discountAmount),
        roundingAmount: Decimal.of(order.roundingAmount),
        total: Decimal.of(order.total),
      },
      previous: [],
      lines: this.picks()
        .filter((pick) => pick.quantity > 0)
        .map((pick) => ({ unitPrice: pick.line.unitPrice, quantity: pick.quantity })),
      completesOrder: false,
      roundingMode: order.roundingMode,
    }).total;
  });
  protected readonly totalText = computed(() => formatBs(this.total().toString()));
  protected readonly piecesText = computed(() => piecesLabel(this.pieces()));
  protected readonly remainingText = computed(() => piecesLabel(this.remaining()));

  protected readonly dispatchableOf = dispatchableQuantity;

  constructor() {
    // every time the dialog opens it starts with everything that is available, as a new request
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.chosen.set({});
        this.error.set(null);
        this.saving.set(false);
        this.idempotencyKey = newIdempotencyKey();
      });
    });
  }

  protected quantityOf(line: SalesOrderLineDetail): number {
    return Math.min(this.chosen()[line.id] ?? dispatchableQuantity(line), dispatchableQuantity(line));
  }

  protected choose(line: SalesOrderLineDetail, quantity: number): void {
    if (this.locked() || quantity === this.quantityOf(line)) return;
    this.chosen.update((map) => ({ ...map, [line.id]: quantity }));
    this.idempotencyKey = newIdempotencyKey();
  }

  protected send(): void {
    if (!this.canSend()) return;
    this.saving.set(true);
    this.error.set(null);
    const items = this.picks().map((pick) => ({ orderItemId: pick.line.id, quantity: pick.quantity }));
    this.api
      .dispatch(this.order().id, { items }, this.idempotencyKey)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          this.saving.set(false);
          this.open.set(false);
          this.dispatched.emit(order);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.error.set(problemOf(err).message);
        },
      });
  }
}
