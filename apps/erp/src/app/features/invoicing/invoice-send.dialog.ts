import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { type InvoiceDeliveryChannel, validateInvoiceDelivery } from '@rodasoft/domain';
import { ButtonComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent, ToastService } from '@rodasoft/ui';
import { catchError, forkJoin, map, of } from 'rxjs';
import { problemOf } from '../../core/api-error';
import { invoiceNumberLabel } from './invoice-format';
import { InvoicingApi } from './invoicing-api.service';

interface Outcome {
  channel: InvoiceDeliveryChannel;
  url?: string;
  error?: string;
}

/**
 * FS-16 · Enviar la factura: a correo and a WhatsApp number in one dialog; each one filled is sent. E-mail attaches the PDF and the
 * XML and is delivered by the worker; WhatsApp has no provider, so the API returns a link that opens the chat with the message
 * written, and the send is recorded when the link is requested. Each send is audited by the API.
 */
@Component({
  selector: 'rs-invoice-send-dialog',
  imports: [ButtonComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './invoice-send.dialog.html',
  styleUrl: './invoice-send.dialog.scss',
})
export class InvoiceSendDialog {
  private readonly api = inject(InvoicingApi);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly invoiceId = input.required<string>();
  readonly invoiceNumber = input<number | null>(null);
  /** The invoice was sent (or its WhatsApp link opened) by this channel. */
  readonly sent = output<InvoiceDeliveryChannel>();

  protected readonly email = signal('');
  protected readonly phone = signal('');
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly emailFilled = computed(() => this.email().trim() !== '');
  private readonly phoneFilled = computed(() => this.phone().trim() !== '');
  protected readonly emailError = computed(() =>
    this.touched() && this.emailFilled() && validateInvoiceDelivery({ channel: 'EMAIL', recipient: this.email() }).length > 0
      ? 'Escribe un correo válido, por ejemplo cliente@correo.com'
      : null,
  );
  protected readonly phoneError = computed(() =>
    this.touched() && this.phoneFilled() && validateInvoiceDelivery({ channel: 'WHATSAPP', recipient: this.phone() }).length > 0
      ? 'Escribe un celular boliviano de 8 dígitos que empiece con 6 o 7'
      : null,
  );
  /** At least one channel, and every channel filled must be valid. */
  protected readonly canSend = computed(() => {
    if (this.saving() || (!this.emailFilled() && !this.phoneFilled())) return false;
    if (this.emailFilled() && validateInvoiceDelivery({ channel: 'EMAIL', recipient: this.email() }).length > 0) return false;
    if (this.phoneFilled() && validateInvoiceDelivery({ channel: 'WHATSAPP', recipient: this.phone() }).length > 0) return false;
    return true;
  });
  protected readonly heading = computed(() => (this.invoiceNumber() === null ? 'Enviar la factura' : `Enviar la factura ${invoiceNumberLabel(this.invoiceNumber())}`));

  constructor() {
    // every time the dialog opens it starts empty
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.email.set('');
        this.phone.set('');
        this.touched.set(false);
        this.saving.set(false);
        this.error.set(null);
      });
    });
  }

  protected send() {
    this.touched.set(true);
    if (!this.canSend()) return;
    this.saving.set(true);
    this.error.set(null);
    const channels: { channel: InvoiceDeliveryChannel; recipient: string }[] = [];
    if (this.emailFilled()) channels.push({ channel: 'EMAIL', recipient: this.email().trim() });
    if (this.phoneFilled()) channels.push({ channel: 'WHATSAPP', recipient: this.phone().trim() });
    // WhatsApp opens in a tab: it is opened now, inside the click, because a popup opened after the answer would be blocked
    const tab = this.phoneFilled() ? window.open('', '_blank') : null;
    if (tab) tab.opener = null;

    forkJoin(
      channels.map(({ channel, recipient }) =>
        this.api.deliver(this.invoiceId(), channel, recipient).pipe(
          map((answer): Outcome => ({ channel, url: answer.url ?? undefined })),
          catchError((err) => of<Outcome>({ channel, error: problemOf(err).message })),
        ),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((outcomes) => {
        this.saving.set(false);
        const whatsapp = outcomes.find((o) => o.channel === 'WHATSAPP');
        if (tab) {
          if (whatsapp?.url) tab.location.href = whatsapp.url;
          else tab.close();
        }
        for (const ok of outcomes.filter((o) => !o.error)) {
          this.toast.success(ok.channel === 'EMAIL' ? 'Factura enviada por correo' : 'Abrimos WhatsApp con el mensaje listo');
          this.sent.emit(ok.channel);
        }
        const failed = outcomes.find((o) => o.error);
        if (failed) {
          // the channel that went stays sent; the dialog stays open to correct the other one
          this.error.set(failed.error ?? null);
        } else {
          this.open.set(false);
        }
      });
  }
}
