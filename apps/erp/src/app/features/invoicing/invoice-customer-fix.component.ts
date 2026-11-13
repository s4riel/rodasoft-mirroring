import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { canResend, IdentityDocumentType, type InvoiceDetail, validateInvoiceDocument } from '@rodasoft/domain';
import { ButtonComponent, CanDirective, FieldComponent, InputDirective, NoteComponent, SelectComponent, type SelectOption, ToastService } from '@rodasoft/ui';
import { firstValueFrom } from 'rxjs';
import { problemOf } from '../../core/api-error';
import { InvoicingApi } from './invoicing-api.service';
import { NitExceptionDialog } from './nit-exception.dialog';

/** SIN identity document types (catalogue 1 to 5), as the customer form lists them. */
export const DOCUMENT_TYPE_OPTIONS: SelectOption[] = [
  { value: IdentityDocumentType.CI, label: 'CI' },
  { value: IdentityDocumentType.CEX, label: 'Carnet de extranjero' },
  { value: IdentityDocumentType.PAS, label: 'Pasaporte' },
  { value: IdentityDocumentType.OD, label: 'Otro documento' },
  { value: IdentityDocumentType.NIT, label: 'NIT' },
];

/**
 * FS-04 / FS-20 / FS-21 · An invoice the SIAT refused (or still waiting): fix the customer, verify the NIT with the SIN and send the
 * invoice again. Sending again needs a verified NIT or an approved exception; without either, "Pedir excepción de NIT" (FS-22) asks
 * Management. Every step is a separate API call, audited there.
 */
@Component({
  selector: 'rs-invoice-customer-fix',
  imports: [ButtonComponent, CanDirective, FieldComponent, InputDirective, NitExceptionDialog, NoteComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-customer-fix.component.html',
  styleUrl: './invoice-customer-fix.component.scss',
})
export class InvoiceCustomerFixComponent {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly invoice = input.required<InvoiceDetail>();
  /** Something changed on the server: the page reads the invoice again. */
  readonly changed = output<void>();

  protected readonly documentTypes = DOCUMENT_TYPE_OPTIONS;
  protected readonly name = signal('');
  protected readonly documentType = signal<number>(IdentityDocumentType.NIT);
  protected readonly documentNumber = signal('');
  protected readonly complement = signal('');
  protected readonly touched = signal(false);
  protected readonly busy = signal<'save' | 'verify' | 'resend' | null>(null);
  protected readonly error = signal<string | null>(null);
  /** What the SIN said about the last NIT checked here. */
  protected readonly verification = signal<{ valid: boolean; message: string } | null>(null);
  protected readonly exceptionOpen = signal(false);

  protected readonly document = computed(() => validateInvoiceDocument(this.documentType(), this.documentNumber(), this.complement() || null));
  protected readonly dirty = computed(() => {
    const i = this.invoice();
    return (
      this.name().trim() !== i.customerName ||
      this.documentType() !== i.customerDocumentType ||
      this.documentNumber().trim() !== i.customerDocumentNumber ||
      this.complement().trim() !== (i.customerComplement ?? '')
    );
  });
  protected readonly numberError = computed(() => {
    if (!this.touched() || this.document().valid) return null;
    return 'Escribe un documento válido para el tipo elegido';
  });
  protected readonly canSave = computed(() => this.busy() === null && this.dirty() && this.name().trim() !== '' && this.document().valid);
  protected readonly isNitSelected = computed(() => this.documentType() === IdentityDocumentType.NIT);
  protected readonly isNit = computed(() => this.invoice().customerDocumentType === IdentityDocumentType.NIT);
  protected readonly verified = computed(() => this.invoice().nitVerifiedAt !== null);
  protected readonly canVerify = computed(() => this.busy() === null && !this.dirty() && this.isNit());
  protected readonly canSend = computed(() => {
    const i = this.invoice();
    return (
      this.busy() === null &&
      !this.dirty() &&
      !i.pendingNitException &&
      canResend({ status: i.status, documentType: i.customerDocumentType, nitVerifiedAt: i.nitVerifiedAt, nitException: i.nitException })
    );
  });
  /** The exception only makes sense for a NIT the SIN does not know and that nobody has approved yet. */
  protected readonly canAskException = computed(() => {
    const i = this.invoice();
    return i.status === 'REJECTED' && this.isNit() && !i.nitException && !i.pendingNitException && !this.dirty();
  });

  constructor() {
    // the form always starts from what the invoice holds now (after a save, a verification or a reload)
    effect(() => {
      const i = this.invoice();
      untracked(() => {
        this.name.set(i.customerName);
        this.documentType.set(i.customerDocumentType);
        this.documentNumber.set(i.customerDocumentNumber);
        this.complement.set(i.customerComplement ?? '');
        this.touched.set(false);
      });
    });
  }

  protected setDocumentType(value: unknown) {
    this.documentType.set(Number(value) || IdentityDocumentType.NIT);
    this.verification.set(null);
  }

  protected async save() {
    this.touched.set(true);
    if (!this.canSave()) return;
    await this.run('save', async () => {
      await firstValueFrom(
        this.api.updateCustomer(this.invoice().id, {
          name: this.name().trim(),
          documentType: this.documentType(),
          documentNumber: this.documentNumber().trim(),
          complement: this.complement().trim() || undefined,
        }),
      );
      this.verification.set(null);
      this.toast.success('Datos del cliente guardados');
      this.changed.emit();
    });
  }

  protected async verify() {
    await this.run('verify', async () => {
      const result = await firstValueFrom(this.api.verifyNit(this.invoice().id));
      this.verification.set({ valid: result.valid, message: result.valid ? 'El SIN reconoce este NIT.' : (result.messages[0]?.description ?? 'El SIN no reconoce este NIT.') });
      if (result.valid) this.changed.emit();
    });
  }

  protected async resend() {
    await this.run('resend', async () => {
      await firstValueFrom(this.api.resend(this.invoice().id));
      this.toast.success('Factura enviada de nuevo al SIAT');
      this.changed.emit();
    });
  }

  private async run(kind: 'save' | 'verify' | 'resend', action: () => Promise<void>) {
    this.busy.set(kind);
    this.error.set(null);
    try {
      await action();
    } catch (err) {
      this.error.set(problemOf(err).message);
    } finally {
      this.busy.set(null);
    }
  }
}
