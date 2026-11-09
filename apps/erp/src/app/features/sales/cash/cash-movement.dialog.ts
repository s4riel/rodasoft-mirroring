import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import {
  CASH_DETAIL_MAX,
  CASH_MOVEMENT_CONCEPTS,
  Decimal,
  needsExpenseApproval,
  parseCashAmount,
  validateCashMovement,
  type CashMovementDetail,
  type CashShiftDetail,
  type ManualCashMovementType,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  FileDropzoneComponent,
  FileItemComponent,
  FilterChipComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  ModalComponent,
  NoteComponent,
  NumericInputDirective,
  SelectComponent,
  type SelectOption,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { CashApi } from './cash-api.service';
import { newIdempotencyKey } from '../pos/idempotency-key';
import { CONCEPT_LABELS, formatBs } from './cash-format';

/** Receipt limits of the cash movements (HU-VEN-22), the same as `UPLOAD_LIMITS['cash-receipt']` on the server. */
const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

const FIELD_MESSAGES: Record<string, string> = {
  INVALID_CASH_AMOUNT: 'Ingresa un monto mayor que cero, con hasta 2 decimales.',
  INVALID_CASH_CONCEPT: 'Elige un concepto.',
  CASH_DETAIL_REQUIRED: 'Escribe el detalle cuando el concepto es "Otro".',
  CASH_DETAIL_TOO_LONG: 'El detalle es demasiado largo.',
};

/**
 * VP-22b · Registrar movimiento de efectivo. An income or an expense with its amount, concept, detail and an optional receipt.
 * The request carries one `Idempotency-Key` per dialog opening, so a second click or a retry registers it once. An expense above
 * the company limit says it will wait for Management when the user cannot approve it themselves.
 */
@Component({
  selector: 'rs-cash-movement-dialog',
  imports: [
    ButtonComponent,
    FieldComponent,
    FileDropzoneComponent,
    FileItemComponent,
    FilterChipComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    ModalComponent,
    NoteComponent,
    NumericInputDirective,
    SelectComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './cash-movement.dialog.html',
  styleUrl: './cash-movement.dialog.scss',
})
export class CashMovementDialog {
  private readonly api = inject(CashApi);
  private readonly ctx = inject(ContextStore);
  private readonly toast = inject(ToastService);

  readonly open = model(false);
  /** The shift the movement goes to; it gives the expected cash and the expense limit. */
  readonly shift = input<CashShiftDetail | null>(null);
  /** The type the opening button preselects. */
  readonly initialType = input<ManualCashMovementType>('EXPENSE');
  readonly registered = output<CashMovementDetail>();

  protected readonly detailMax = CASH_DETAIL_MAX;
  protected readonly type = signal<ManualCashMovementType>('EXPENSE');
  protected readonly amount = signal('');
  protected readonly concept = signal<string | null>(null);
  protected readonly detail = signal('');
  protected readonly receipt = signal<File | null>(null);
  protected readonly receiptError = signal<string | null>(null);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly submitError = signal<string | null>(null);
  private idempotencyKey = '';

  protected readonly isExpense = computed(() => this.type() === 'EXPENSE');
  protected readonly expectedText = computed(() => {
    const s = this.shift();
    return s ? formatBs(s.cash.expected) : '';
  });
  protected readonly subtitle = computed(() => (this.shift() ? `Efectivo esperado en caja: ${this.expectedText()}` : ''));
  protected readonly conceptOptions = computed<SelectOption[]>(() =>
    CASH_MOVEMENT_CONCEPTS[this.type()].map((code) => ({ value: code, label: CONCEPT_LABELS[this.type()][code] })),
  );
  protected readonly submitLabel = computed(() => (this.isExpense() ? 'Registrar egreso' : 'Registrar ingreso'));

  /** Validation of the form as the server will apply it. */
  private readonly problems = computed(() => {
    const result = validateCashMovement({ type: this.type(), amount: this.amount(), concept: this.concept() ?? '', detail: this.detail() });
    return result.ok ? [] : result.errors;
  });
  protected readonly amountMessage = computed(() => (this.submitted() && this.problems().includes('INVALID_CASH_AMOUNT') ? FIELD_MESSAGES['INVALID_CASH_AMOUNT'] : null));
  protected readonly conceptMessage = computed(() => (this.submitted() && this.problems().includes('INVALID_CASH_CONCEPT') ? FIELD_MESSAGES['INVALID_CASH_CONCEPT'] : null));
  protected readonly detailMessage = computed(() => {
    if (!this.submitted()) return null;
    const code = this.problems().find((p) => p === 'CASH_DETAIL_REQUIRED' || p === 'CASH_DETAIL_TOO_LONG');
    return code ? FIELD_MESSAGES[code] : null;
  });

  /** The text of the note that says the expense waits for Management; `null` when it is posted at once. */
  protected readonly approvalNote = computed(() => {
    const limit = this.shift()?.expenseApprovalLimit ?? null;
    const amount = parseCashAmount(this.amount());
    if (!this.isExpense() || limit === null || !amount || this.ctx.can('sales.cash-expenses.approve')) return null;
    return needsExpenseApproval(amount, limit) ? `Este egreso supera ${formatBs(limit)} y queda pendiente de aprobación de Gerencia.` : null;
  });
  protected readonly exceedsCash = computed(() => {
    const amount = parseCashAmount(this.amount());
    const expected = this.shift()?.cash.expected;
    return this.isExpense() && !!amount && !!expected && amount.cmp(Decimal.of(expected)) > 0;
  });

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const type = this.initialType();
      untracked(() => this.reset(type));
    });
  }

  private reset(type: ManualCashMovementType) {
    this.type.set(type);
    this.amount.set('');
    this.concept.set(null);
    this.detail.set('');
    this.receipt.set(null);
    this.receiptError.set(null);
    this.submitted.set(false);
    this.saving.set(false);
    this.submitError.set(null);
    this.idempotencyKey = newIdempotencyKey();
  }

  /** The chip of the chosen type stays selected: clicking it again must not leave both unselected. */
  protected pickType(type: ManualCashMovementType, chip: { selected: { set(value: boolean): void } }) {
    chip.selected.set(true);
    if (this.type() === type) return;
    this.type.set(type);
    this.concept.set(null);
    this.submitError.set(null);
  }

  protected pickReceipt(files: File[]) {
    const file = files[0];
    if (!file) return;
    if (!RECEIPT_TYPES.includes(file.type)) {
      this.receipt.set(null);
      this.receiptError.set('El comprobante debe ser una foto (JPG, PNG o WebP) o un PDF.');
      return;
    }
    if (file.size > RECEIPT_MAX_BYTES) {
      this.receipt.set(null);
      this.receiptError.set('El comprobante supera el límite de 5 MB.');
      return;
    }
    this.receiptError.set(null);
    this.receipt.set(file);
  }

  protected removeReceipt() {
    this.receipt.set(null);
    this.receiptError.set(null);
  }

  protected fileDetail(file: File): string {
    return file.size >= 1024 * 1024 ? `${(file.size / (1024 * 1024)).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
  }

  protected cancel() {
    if (!this.saving()) this.open.set(false);
  }

  protected submit() {
    this.submitted.set(true);
    this.submitError.set(null);
    const shift = this.shift();
    const valid = validateCashMovement({ type: this.type(), amount: this.amount(), concept: this.concept() ?? '', detail: this.detail() });
    if (!shift || !valid.ok || this.saving() || this.receiptError()) return;

    this.saving.set(true);
    this.api
      .createMovement(
        shift.id,
        { type: valid.value.type, amount: valid.value.amount.toString(), concept: valid.value.concept, detail: valid.value.detail },
        this.receipt(),
        this.idempotencyKey,
      )
      .subscribe({
        next: (movement) => {
          this.saving.set(false);
          this.open.set(false);
          this.toast.success(movement.status === 'PENDING' ? 'Egreso enviado a aprobación' : this.isExpense() ? 'Egreso registrado' : 'Ingreso registrado');
          this.registered.emit(movement);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.submitError.set(problemOf(err).message);
        },
      });
  }
}
