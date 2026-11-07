import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  isValidEmail,
  normalizeWhatsappNumber,
  QUOTE_MESSAGE_MAX,
  quoteShareText,
  type QuoteDetail,
  type QuoteSendChannel,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  FilterChipComponent,
  InputDirective,
  ModalComponent,
  NoteComponent,
  ReceiptComponent,
  TextareaDirective,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { QUOTE_CHANNEL_OPTIONS, quoteDocument, quoteShareDocument, whatsappUrl } from './quote-tracking-format';
import { QuotesApi } from './quotes-api.service';

/** The printable copy of a quote, opened in the window the "PDF" channel reserves. */
const printPath = (quoteId: string): string => `/sales/quotes/${quoteId}/print`;

/**
 * VP-08b · Vista previa y envío (HU-VEN-17). Shows the quote as the customer receives it, lets the salesperson pick the
 * channel (WhatsApp, e-mail or a printed/PDF copy) and records the sending. WhatsApp has no server integration yet: the
 * sending is recorded and WhatsApp opens with the message written, as the Figma note says.
 */
@Component({
  selector: 'rs-quote-send-dialog',
  imports: [ButtonComponent, FieldComponent, FilterChipComponent, InputDirective, ModalComponent, NoteComponent, ReceiptComponent, TextareaDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-send.dialog.html',
  styleUrl: './quote-send.dialog.scss',
})
export class QuoteSendDialog {
  private readonly api = inject(QuotesApi);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly quote = input.required<QuoteDetail>();
  /** The quote was sent: the detail with its new status and log. */
  readonly sent = output<QuoteDetail>();

  protected readonly channels = QUOTE_CHANNEL_OPTIONS;
  protected readonly messageMax = QUOTE_MESSAGE_MAX;
  protected readonly channel = signal<QuoteSendChannel>('WHATSAPP');
  protected readonly to = signal('');
  protected readonly message = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly document = computed(() => quoteDocument(this.quote()));
  protected readonly subtitle = computed(() => `${this.quote().number} · ${this.quote().customer.name}`);
  protected readonly defaultMessage = computed(() => `Hola, te enviamos la cotización ${this.quote().number} de ${this.quote().company}. Quedamos atentos.`);
  protected readonly recipientLabel = computed(() => (this.channel() === 'EMAIL' ? 'Correo del cliente' : 'WhatsApp del cliente'));
  protected readonly needsRecipient = computed(() => this.channel() !== 'PDF');
  protected readonly recipientOk = computed(() => {
    switch (this.channel()) {
      case 'EMAIL':
        return isValidEmail(this.to());
      case 'WHATSAPP':
        return normalizeWhatsappNumber(this.to()) !== null;
      default:
        return true;
    }
  });
  protected readonly canSend = computed(() => !this.saving() && this.recipientOk());
  protected readonly sendLabel = computed(() => {
    switch (this.channel()) {
      case 'EMAIL':
        return 'Enviar por correo';
      case 'WHATSAPP':
        return 'Enviar por WhatsApp';
      default:
        return 'Abrir para imprimir';
    }
  });

  constructor() {
    // every time the dialog opens it starts on WhatsApp with the customer's number and the default greeting
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.channel.set('WHATSAPP');
        this.to.set(this.quote().customerPhone ?? '');
        this.message.set(this.defaultMessage());
        this.error.set(null);
        this.saving.set(false);
      });
    });
  }

  /** One channel at a time; choosing another prefills its recipient from the customer. */
  protected choose(channel: QuoteSendChannel, selected: boolean): void {
    if (!selected || this.channel() === channel) return;
    this.channel.set(channel);
    this.to.set(this.customerRecipient(channel));
    this.error.set(null);
  }

  /** The customer's address for the channel; the printed copy has no recipient. */
  private customerRecipient(channel: QuoteSendChannel): string {
    switch (channel) {
      case 'EMAIL':
        return this.quote().customerEmail ?? '';
      case 'WHATSAPP':
        return this.quote().customerPhone ?? '';
      default:
        return '';
    }
  }

  protected send(): void {
    if (!this.canSend()) return;
    const channel = this.channel();
    const quote = this.quote();
    this.saving.set(true);
    this.error.set(null);
    // the window opens now, inside the click: after the request the browser would take it for a popup and block it
    const popup = channel === 'EMAIL' ? null : window.open('', '_blank');
    if (popup) popup.opener = null;
    this.api
      .send(quote.id, { channel, to: this.needsRecipient() ? this.to().trim() : undefined, message: this.message().trim() || undefined })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.saving.set(false);
          this.open.set(false);
          this.deliver(channel, detail, popup);
          this.sent.emit(detail);
        },
        error: (err: unknown) => {
          popup?.close();
          this.saving.set(false);
          this.error.set(problemOf(err).message);
        },
      });
  }

  /** The part only the browser can do: open WhatsApp with the text, or the printable copy. E-mail goes out from the worker. */
  private deliver(channel: QuoteSendChannel, quote: QuoteDetail, popup: Window | null): void {
    let url: string | null = null;
    if (channel === 'WHATSAPP') {
      const phone = normalizeWhatsappNumber(this.to());
      if (phone) url = whatsappUrl(phone, quoteShareText(quoteShareDocument(quote), this.message()));
    } else if (channel === 'PDF') {
      url = printPath(quote.id);
    }
    if (!popup) return;
    if (url) popup.location.href = url;
    else popup.close();
  }
}
