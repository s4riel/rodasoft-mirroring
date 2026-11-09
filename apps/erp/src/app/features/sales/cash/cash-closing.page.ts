import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  CASH_DENOMINATIONS,
  CLOSING_COMMENT_MAX,
  closingDifferences,
  countedTotal,
  DECLARED_METHODS,
  Decimal,
  planClosing,
  validateOpeningFloat,
  type CashShiftDetail,
  type DeclaredMethod,
  type MethodDifference,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableCellDirective,
  DocTableComponent,
  type DocTableColumn,
  type DocTableRow,
  EmptyStateIllustratedComponent,
  FieldComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  NoteComponent,
  NumericInputDirective,
  PageHeaderComponent,
  QtyStepperComponent,
  SkeletonComponent,
  TextareaDirective,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { messageFor, problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { CashApi } from './cash-api.service';
import { formatBs, formatOpenedAt, formatTime, METHOD_LABELS, registerPlace } from './cash-format';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'blocked';

const COUNT_COLUMNS: DocTableColumn[] = [
  { key: 'denomination', label: 'Denominación' },
  { key: 'quantity', label: 'Cantidad', type: 'custom', width: '12rem' },
  { key: 'subtotal', label: 'Subtotal', type: 'number' },
];

const COMPARE_COLUMNS: DocTableColumn[] = [
  { key: 'method', label: 'Forma de pago' },
  { key: 'system', label: 'Sistema', type: 'number' },
  { key: 'declared', label: 'Contado', type: 'custom', align: 'end', width: '12rem' },
  { key: 'difference', label: 'Diferencia', type: 'number' },
];

/** The most pieces of one denomination a stepper accepts, the same limit as the server. */
const COUNT_MAX = 100_000;

const isBill = (denomination: string) => Decimal.of(denomination).cmp(Decimal.of('10')) >= 0;

/**
 * VP-06 · Cierre y arqueo de caja. The cashier counts the cash by denomination, types what the terminals and the bank say for QR,
 * card and transfer, and chooses the cash that stays in the register. The server recomputes what the system holds; here the same
 * domain rules only preview the differences, so the justification field appears when it will be required.
 */
@Component({
  selector: 'rs-cash-closing-page',
  imports: [
    ButtonComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    NoteComponent,
    NumericInputDirective,
    PageHeaderComponent,
    QtyStepperComponent,
    SkeletonComponent,
    TextareaDirective,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cash-closing.page.html',
  styleUrl: './cash-closing.page.scss',
})
export class CashClosingPage implements OnInit {
  private readonly api = inject(CashApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<LoadState>('loading');
  protected readonly shift = signal<CashShiftDetail | null>(null);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly submitError = signal<string | null>(null);

  protected readonly quantities = signal<Record<string, number>>({});
  protected readonly declared = signal<Record<DeclaredMethod, string>>({ QR: '', CARD: '', TRANSFER: '' });
  protected readonly closingFloat = signal('');
  protected readonly comment = signal('');

  protected readonly countColumns = COUNT_COLUMNS;
  protected readonly compareColumns = COMPARE_COLUMNS;
  protected readonly countMax = COUNT_MAX;
  protected readonly commentMax = CLOSING_COMMENT_MAX;
  protected readonly skeletonRows = Array.from({ length: 4 }, (_, i) => i);
  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Caja', link: '/sales/cash-register' },
    { label: 'Cierre de caja' },
  ];

  protected readonly description = computed(() => {
    const s = this.shift();
    if (!s) return '';
    return `${registerPlace({ name: s.register.name, branch: s.branch })} · turno de ${s.openedBy.name} · ${formatTime(s.openedAt)} a ahora · cuenta el efectivo por denominación`;
  });
  protected readonly openedText = computed(() => {
    const s = this.shift();
    return s ? `Abierta ${formatOpenedAt(s.openedAt)}` : '';
  });

  private readonly counts = computed(() => CASH_DENOMINATIONS.map((denomination) => ({ denomination, quantity: this.quantities()[denomination] ?? 0 })));
  protected readonly counted = computed(() => countedTotal(this.counts()));

  protected readonly countRows = computed<DocTableRow[]>(() =>
    this.counts().map(({ denomination, quantity }) => ({
      id: denomination,
      label: this.denominationLabel(denomination),
      cells: {
        denomination: this.denominationLabel(denomination),
        quantity: null,
        subtotal: formatBs(Decimal.of(denomination).mul(Decimal.of(String(quantity), 0), 2).toString()),
      },
    })),
  );
  protected readonly countTotals = computed(() => ({ denomination: 'Efectivo contado', quantity: null, subtotal: formatBs(this.counted().toString()) }));

  /** What the system holds for each declared method. */
  private readonly system = computed(() => {
    const s = this.shift();
    const amountOf = (method: DeclaredMethod) => s?.methods.find((m) => m.method === method)?.amount ?? '0.00';
    return { expectedCash: s?.cash.expected ?? '0.00', methods: { QR: amountOf('QR'), CARD: amountOf('CARD'), TRANSFER: amountOf('TRANSFER') } };
  });

  /** The amounts typed for QR, card and transfer; `null` while one is not a valid amount. */
  private readonly declaredAmounts = computed(() => {
    const parsed = {} as Record<DeclaredMethod, Decimal>;
    for (const method of DECLARED_METHODS) {
      const result = validateOpeningFloat(this.declared()[method]);
      if (!result.ok) return null;
      parsed[method] = result.value;
    }
    return parsed;
  });

  /** The differences per method, cash first; `null` while a declared amount is not valid. */
  protected readonly differences = computed<{ rows: MethodDifference[]; needsReview: boolean } | null>(() => {
    const declared = this.declaredAmounts();
    const s = this.shift();
    if (!declared || !s) return null;
    const result = closingDifferences(this.system(), { cash: this.counted(), ...declared }, s.differenceTolerance);
    return { rows: result.differences, needsReview: result.needsReview };
  });
  protected readonly needsReview = computed(() => this.differences()?.needsReview ?? false);

  protected readonly compareRows = computed<DocTableRow[]>(() =>
    (this.differences()?.rows ?? this.fallbackRows()).map((row) => ({
      id: row.method,
      label: METHOD_LABELS[row.method],
      cells: {
        method: METHOD_LABELS[row.method],
        system: formatBs(row.system),
        declared: row.method === 'CASH' ? formatBs(row.declared) : null,
        difference: this.signedDifference(row.difference),
      },
    })),
  );

  /** "Diferencia de −Bs 20,00 en Efectivo": the methods that differ beyond the tolerance. */
  protected readonly warningText = computed(() => {
    const result = this.differences();
    const s = this.shift();
    if (!result || !s) return '';
    const limit = Decimal.of(s.differenceTolerance);
    return result.rows
      .filter((row) => Decimal.of(row.difference).cmp(limit) > 0 || Decimal.of(row.difference).cmp(limit.neg()) < 0)
      .map((row) => `Diferencia de ${this.signedDifference(row.difference)} en ${METHOD_LABELS[row.method].toLowerCase()}`)
      .join(' · ');
  });

  protected readonly declaredMessage = computed(() => (this.submitted() && !this.declaredAmounts() ? 'Ingresa montos válidos para QR, tarjeta y transferencia.' : null));
  protected readonly floatMessage = computed(() => {
    if (!this.submitted()) return null;
    const parsed = validateOpeningFloat(this.closingFloat());
    if (!parsed.ok) return 'Ingresa un monto válido, por ejemplo 500,00.';
    return parsed.value.cmp(this.counted()) > 0 ? messageFor('CLOSING_FLOAT_EXCEEDS_COUNTED') : null;
  });
  protected readonly commentMessage = computed(() => (this.submitted() && this.needsReview() && this.comment().trim() === '' ? messageFor('CLOSING_COMMENT_REQUIRED') : null));
  protected readonly submitLabel = computed(() => (this.needsReview() ? 'Cerrar caja y enviar a revisión' : 'Cerrar caja'));

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
          this.api
            .shift(shift.id)
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
              next: (detail) => {
                this.shift.set(detail);
                this.recount();
                this.state.set(detail.pendingExpenses > 0 ? 'blocked' : 'ready');
              },
              error: (err: unknown) => this.state.set(problemOf(err).status === 403 ? 'forbidden' : 'error'),
            });
        },
        error: (err: unknown) => this.state.set(problemOf(err).status === 403 ? 'forbidden' : 'error'),
      });
  }

  /** "Recontar": every count back to zero, the declared amounts back to what the system says, and the float as at the opening. */
  protected recount() {
    const s = this.shift();
    this.quantities.set({});
    this.comment.set('');
    this.submitted.set(false);
    this.submitError.set(null);
    this.declared.set({
      QR: s?.methods.find((m) => m.method === 'QR')?.amount ?? '0.00',
      CARD: s?.methods.find((m) => m.method === 'CARD')?.amount ?? '0.00',
      TRANSFER: s?.methods.find((m) => m.method === 'TRANSFER')?.amount ?? '0.00',
    });
    this.closingFloat.set(s?.openingFloat ?? '');
  }

  protected quantityOf(denomination: string): number {
    return this.quantities()[denomination] ?? 0;
  }

  protected setQuantity(denomination: string, value: number) {
    this.quantities.update((current) => ({ ...current, [denomination]: value }));
    this.submitError.set(null);
  }

  protected setDeclared(method: DeclaredMethod, value: string) {
    this.declared.update((current) => ({ ...current, [method]: value }));
    this.submitError.set(null);
  }

  protected denominationLabel(denomination: string): string {
    return `${isBill(denomination) ? 'Billete' : 'Moneda'} de ${formatBs(denomination)}`;
  }

  protected methodOf(rowId: string): DeclaredMethod | null {
    return (DECLARED_METHODS as readonly string[]).includes(rowId) ? (rowId as DeclaredMethod) : null;
  }

  protected inputId(method: DeclaredMethod): string {
    return `cash-declared-${method.toLowerCase()}`;
  }

  protected methodLabel(method: DeclaredMethod): string {
    return METHOD_LABELS[method];
  }

  protected cancel() {
    void this.router.navigate(['/sales/cash-register']);
  }

  protected submit() {
    this.submitted.set(true);
    this.submitError.set(null);
    const s = this.shift();
    if (!s || this.saving()) return;
    const body = {
      counts: this.counts().filter((c) => c.quantity > 0),
      declared: this.declared(),
      closingFloat: this.closingFloat(),
      comment: this.comment().trim() || null,
    };
    // the same rules as the server: a problem shows on its field, anything else as a message
    const planned = planClosing(body, this.system(), s.differenceTolerance);
    if (!planned.ok) {
      if (planned.error !== 'CLOSING_COMMENT_REQUIRED' && planned.error !== 'CLOSING_FLOAT_EXCEEDS_COUNTED' && planned.error !== 'INVALID_CASH_AMOUNT') {
        this.submitError.set(messageFor(planned.error) ?? 'Revisa los datos del cierre.');
      }
      return;
    }

    this.saving.set(true);
    this.api
      .close(s.id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.toast.success(result.needsReview ? 'Caja cerrada y enviada a revisión' : 'Caja cerrada');
          void this.router.navigate(['/sales/cash-register/open']);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          const problem = problemOf(err);
          this.submitError.set(problem.message);
          // the cash changed under the count (a sale or an expense landed first), or the shift is already closed: read it again
          if (problem.code === 'CASH_SHIFT_NOT_OPEN') void this.router.navigate(['/sales/cash-register/open']);
        },
      });
  }

  private fallbackRows(): MethodDifference[] {
    const system = this.system();
    return [
      { method: 'CASH', system: system.expectedCash, declared: this.counted().toString(), difference: this.counted().sub(Decimal.of(system.expectedCash)).toString() },
      ...DECLARED_METHODS.map((method) => ({ method, system: system.methods[method], declared: system.methods[method], difference: '0.00' })),
    ];
  }

  private signedDifference(amount: string): string {
    const value = Decimal.of(amount);
    return value.isZero() ? formatBs('0.00') : `${value.isNegative() ? '' : '+'}${value.format()}`;
  }
}
