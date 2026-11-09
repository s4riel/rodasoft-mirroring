import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import {
  Decimal,
  needsReturnApproval,
  returnTotals,
  RETURN_REFERENCE_MAX,
  type RefundMethod,
  type ReturnableLine,
  type ReturnableSale,
  type ReturnCondition,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  FilterChipComponent,
  InputDirective,
  NoteComponent,
  PageHeaderComponent,
  QtyStepperComponent,
  SelectComponent,
  SkeletonComponent,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { formatBs, formatDateTime } from '../cash/cash-format';
import { newIdempotencyKey } from '../pos/idempotency-key';
import { ReturnsApi } from './returns-api.service';
import { CONDITION_LABELS, REFUND_LABELS, REFUND_METHODS_ORDER, RETURN_REASON_OPTIONS } from './returns-format';

type LookupState = 'idle' | 'loading' | 'found' | 'notFound' | 'error';

interface LineChoice {
  quantity: number;
  /** Nothing is chosen until the cashier says where the pieces go. */
  condition: ReturnCondition | null;
}

/**
 * VP-10 · New return (HU-VEN-21): find the sale, choose what comes back and where it goes (stock or scrap), choose how the
 * customer is refunded. The amount is previewed with the same rules the server applies; the server decides in the end.
 */
@Component({
  selector: 'rs-return-form-page',
  imports: [
    ButtonComponent,
    FieldComponent,
    FilterChipComponent,
    InputDirective,
    NoteComponent,
    PageHeaderComponent,
    QtyStepperComponent,
    SelectComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './return-form.page.html',
  styleUrl: './return-form.page.scss',
})
export class ReturnFormPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(ReturnsApi);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Devoluciones', link: '/sales/returns' },
    { label: 'Nueva devolución' },
  ];
  protected readonly reasonOptions = RETURN_REASON_OPTIONS;
  protected readonly refundMethods = REFUND_METHODS_ORDER;
  protected readonly refundLabels = REFUND_LABELS;
  protected readonly conditionLabels = CONDITION_LABELS;
  protected readonly referenceMax = RETURN_REFERENCE_MAX;

  protected readonly query = signal('');
  protected readonly lookup = signal<LookupState>('idle');
  protected readonly lookupError = signal('');
  protected readonly sale = signal<ReturnableSale | null>(null);
  protected readonly reason = signal<string | null>(null);
  protected readonly choices = signal<Record<string, LineChoice>>({});
  protected readonly method = signal<RefundMethod>('CASH');
  protected readonly reference = signal('');
  protected readonly submitting = signal(false);
  protected readonly submitError = signal('');
  /** One key per form: a repeated click or a retry registers the return once. */
  private idempotencyKey = newIdempotencyKey();

  protected readonly lines = computed(() => this.sale()?.lines ?? []);
  protected readonly pieces = computed(() => Object.values(this.choices()).reduce((acc, choice) => acc + choice.quantity, 0));
  private readonly preview = computed(() => {
    const sale = this.sale();
    if (!sale) return Decimal.zero();
    const picked = sale.lines.filter((line) => (this.choices()[line.saleItemId]?.quantity ?? 0) > 0);
    const completes = sale.lines.every((line) => line.returnable - (this.choices()[line.saleItemId]?.quantity ?? 0) === 0);
    return returnTotals({
      sale: { subtotal: Decimal.of(sale.subtotal), total: Decimal.of(sale.total) },
      previousRefunded: Decimal.of(sale.refunded),
      lines: picked.map((line) => ({ unitPrice: line.unitPrice, quantity: this.choices()[line.saleItemId].quantity })),
      completesSale: completes && picked.length > 0,
    }).total;
  });
  protected readonly amount = computed(() => formatBs(this.preview().toString()));
  protected readonly needsApproval = computed(() => needsReturnApproval(this.preview(), this.sale()?.approvalLimit ?? null));
  protected readonly invoiceText = computed(() => {
    const number = this.sale()?.invoiceNumber;
    return number ? `la factura N.º ${number}` : 'la factura de la venta';
  });
  protected readonly customerText = computed(() => {
    const s = this.sale();
    if (!s) return '';
    const who = s.customerName ?? 'Consumidor final';
    return `${who} · ${formatDateTime(s.soldAt)} · ${formatBs(s.total)}`;
  });
  protected readonly referenceMissing = computed(() => this.method() === 'TRANSFER' && this.reference().trim() === '');
  /** Every line with pieces says where they go. */
  private readonly destinationsChosen = computed(() => Object.values(this.choices()).every((choice) => choice.quantity === 0 || choice.condition !== null));
  protected readonly canSubmit = computed(
    () => this.sale() !== null && this.reason() !== null && this.pieces() > 0 && this.destinationsChosen() && !this.referenceMissing() && !this.submitting(),
  );
  protected readonly submitLabel = computed(() => (this.needsApproval() ? 'Enviar a aprobación' : 'Emitir nota y devolver'));

  ngOnInit() {
    const preset = this.route.snapshot.queryParamMap.get('sale');
    if (preset) {
      this.query.set(preset);
      this.search();
    }
  }

  protected setQuery(value: string) {
    this.query.set(value);
  }

  protected search() {
    const q = this.query().trim();
    if (q === '') return;
    this.lookup.set('loading');
    this.sale.set(null);
    this.choices.set({});
    this.submitError.set('');
    this.api
      .lookup(q)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (sale) => {
          this.sale.set(sale);
          this.lookup.set('found');
          // a customer-less sale cannot give store credit
          if (this.method() === 'STORE_CREDIT' && !sale.hasCustomer) this.method.set('CASH');
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.lookupError.set(problem.message);
          this.lookup.set(problem.code === 'SALE_NOT_FOUND' ? 'notFound' : 'error');
        },
      });
  }

  protected choiceOf(line: ReturnableLine): LineChoice {
    return this.choices()[line.saleItemId] ?? { quantity: 0, condition: null };
  }

  protected setQuantity(line: ReturnableLine, quantity: number) {
    const current = this.choiceOf(line);
    this.choices.update((all) => ({ ...all, [line.saleItemId]: { ...current, quantity: Math.max(0, Math.min(quantity, line.returnable)) } }));
  }

  /** Choosing a chip picks the destination; clicking the chosen one again clears it. */
  protected setCondition(line: ReturnableLine, condition: ReturnCondition, selected: boolean) {
    const current = this.choiceOf(line);
    this.choices.update((all) => ({ ...all, [line.saleItemId]: { ...current, condition: selected ? condition : null } }));
  }

  protected setMethod(method: RefundMethod, selected: boolean) {
    if (selected) this.method.set(method);
  }

  protected methodDisabled(method: RefundMethod): boolean {
    return method === 'STORE_CREDIT' && !(this.sale()?.hasCustomer ?? false);
  }

  protected cancel() {
    void this.router.navigate(['/sales/returns']);
  }

  protected submit() {
    const sale = this.sale();
    const reason = this.reason();
    if (!sale || !reason || !this.canSubmit()) return;
    this.submitting.set(true);
    this.submitError.set('');
    const items = sale.lines
      .filter((line) => this.choiceOf(line).quantity > 0)
      .map((line) => ({ saleItemId: line.saleItemId, quantity: this.choiceOf(line).quantity, condition: this.choiceOf(line).condition as ReturnCondition }));
    this.api
      .create(
        { saleId: sale.saleId, reason, refundMethod: this.method(), refundReference: this.method() === 'TRANSFER' ? this.reference().trim() : null, items },
        this.idempotencyKey,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.submitting.set(false);
          void this.router.navigate(['/sales/returns', created.id]);
        },
        error: (err: unknown) => {
          this.submitting.set(false);
          const problem = problemOf(err);
          this.submitError.set(problem.message);
          // the pieces moved under us: show what can still come back, and a new key for what the cashier decides next
          if (problem.code === 'RETURN_EXCEEDS_SOLD' || problem.code === 'RETURN_KEY_REUSED') {
            this.idempotencyKey = newIdempotencyKey();
            this.search();
          }
        },
      });
  }
}
