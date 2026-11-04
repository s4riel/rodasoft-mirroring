import { booleanAttribute, ChangeDetectionStrategy, Component, computed, effect, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import {
  customerDiscountInputValid,
  IdentityDocumentType,
  validateInvoiceDocument,
  type CustomerSummary,
  type SaveCustomerInput,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  InputDirective,
  NoteComponent,
  NumericInputDirective,
  SelectComponent,
  SwitchComponent,
  type SelectOption,
} from '@rodasoft/ui';
import { DOCUMENT_TYPE_OPTIONS, documentErrorMessage } from './customer-format';

type DiscountType = 'NONE' | 'PERCENT' | 'AMOUNT';

const DISCOUNT_OPTIONS: SelectOption<DiscountType>[] = [
  { value: 'NONE', label: 'Sin descuento' },
  { value: 'PERCENT', label: 'Porcentaje (%) sobre la venta' },
  { value: 'AMOUNT', label: 'Monto fijo (Bs) por venta' },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let nextId = 0;

/**
 * The customer form (HU-VEN-05, HU-VEN-37). `full` is Management's form: it adds the credit flag, the discount and the
 * active switch (`sales.customers.manage`); without it the form is the cashier's quick creation, which never sets those.
 * Validates the document with the same function as the API (`validateInvoiceDocument`) and emits `save` with the data.
 */
@Component({
  selector: 'rs-customer-form',
  imports: [ButtonComponent, FieldComponent, InputDirective, NoteComponent, NumericInputDirective, ReactiveFormsModule, SelectComponent, SwitchComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customer-form.html',
  styleUrl: './customer-form.scss',
})
export class CustomerForm {
  private readonly uid = `customer-form-${nextId++}`;

  /** The customer being edited; `null` creates one. */
  readonly customer = input<CustomerSummary | null>(null);
  readonly full = input(false, { transform: booleanAttribute });
  readonly saving = input(false);
  /** Message of the last refused save (from the API). */
  readonly serverError = input<string | null>(null);
  readonly submitLabel = input('Guardar cliente');

  readonly save = output<SaveCustomerInput>();
  readonly cancelled = output<void>();

  protected readonly documentTypeOptions = DOCUMENT_TYPE_OPTIONS;
  protected readonly discountOptions = DISCOUNT_OPTIONS;

  protected readonly form = new FormGroup({
    documentType: new FormControl<number>(IdentityDocumentType.NIT, { nonNullable: true }),
    documentNumber: new FormControl('', { nonNullable: true }),
    complement: new FormControl('', { nonNullable: true }),
    name: new FormControl('', { nonNullable: true }),
    email: new FormControl('', { nonNullable: true }),
    phone: new FormControl('', { nonNullable: true }),
    creditEnabled: new FormControl(false, { nonNullable: true }),
    discountType: new FormControl<DiscountType>('NONE', { nonNullable: true }),
    discountValue: new FormControl('', { nonNullable: true }),
    active: new FormControl(true, { nonNullable: true }),
  });

  // the form is not a signal source: this mirrors the values the template reads
  private readonly values = signal(this.form.getRawValue());
  protected readonly submitted = signal(false);

  protected readonly id = (field: string) => `${this.uid}-${field}`;
  protected readonly isCi = computed(() => this.values().documentType === IdentityDocumentType.CI);
  protected readonly hasDiscount = computed(() => this.values().discountType !== 'NONE');
  protected readonly discountPercent = computed(() => this.values().discountType === 'PERCENT');

  protected readonly nameMessage = computed(() => (this.submitted() && !this.values().name.trim() ? 'Ingresa el nombre o la razón social.' : null));

  private readonly document = computed(() => {
    const v = this.values();
    return validateInvoiceDocument(v.documentType, v.documentNumber, this.isCi() ? v.complement : null);
  });
  protected readonly documentMessage = computed(() => {
    const doc = this.document();
    if (doc.valid || !this.submitted()) return null;
    return documentErrorMessage(this.values().documentType, doc.error);
  });
  protected readonly emailMessage = computed(() => {
    const email = this.values().email.trim();
    return this.submitted() && email && !EMAIL.test(email) ? 'Ingresa un correo válido.' : null;
  });
  protected readonly discountMessage = computed(() => {
    const v = this.values();
    if (!this.submitted() || v.discountType === 'NONE') return null;
    return customerDiscountInputValid(v.discountType, normalizeDecimal(v.discountValue))
      ? null
      : v.discountType === 'PERCENT'
        ? 'Ingresa un porcentaje mayor que 0 y hasta 100.'
        : 'Ingresa un monto en Bs mayor que 0.';
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.values.set(this.form.getRawValue()));
    // the form shows the customer being edited, or starts empty
    effect(() => {
      const c = this.customer();
      this.submitted.set(false);
      this.form.reset({
        documentType: c?.documentType ?? IdentityDocumentType.NIT,
        documentNumber: c?.documentNumber ?? '',
        complement: c?.complement ?? '',
        name: c?.name ?? '',
        email: c?.email ?? '',
        phone: c?.phone ?? '',
        creditEnabled: c?.creditEnabled ?? false,
        discountType: c?.discount.type ?? 'NONE',
        discountValue: c && c.discount.type !== 'NONE' ? c.discount.value : '',
        active: c ? c.status === 'ACTIVE' : true,
      });
    });
  }

  protected submit(): void {
    this.submitted.set(true);
    const v = this.values();
    const doc = this.document();
    const discountOk = v.discountType === 'NONE' || customerDiscountInputValid(v.discountType, normalizeDecimal(v.discountValue));
    const emailOk = !v.email.trim() || EMAIL.test(v.email.trim());
    if (this.saving() || !v.name.trim() || !doc.valid || !emailOk || !discountOk) return;

    const base = {
      name: v.name.trim(),
      documentType: v.documentType,
      documentNumber: doc.documentNumber,
      complement: doc.complement,
      email: v.email.trim() || null,
      phone: v.phone.trim() || null,
    };
    if (!this.full()) {
      this.save.emit({ ...base, creditEnabled: false, discountType: 'NONE', discountValue: '0' });
      return;
    }
    this.save.emit({
      ...base,
      creditEnabled: v.creditEnabled,
      discountType: v.discountType,
      discountValue: v.discountType === 'NONE' ? '0' : normalizeDecimal(v.discountValue),
      status: v.active ? 'ACTIVE' : 'INACTIVE',
    });
  }
}

/** "12,5" → "12.5": the API takes decimal strings with a point. */
function normalizeDecimal(text: string): string {
  return text.trim().replace(',', '.');
}
