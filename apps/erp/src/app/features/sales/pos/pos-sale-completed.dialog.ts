import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, input, output, signal, untracked, viewChild } from '@angular/core';
import { Decimal, formatReceiptDate, type CompletedSale } from '@rodasoft/domain';
import { ButtonComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent } from '@rodasoft/ui';

const money = (value: string) => Decimal.of(value).format();

/**
 * VP-16a · Venta completada (HU-VEN-11). Shows the sale that was just saved with what the customer paid, received and got
 * back, and the receipt options: print the ticket, share it by WhatsApp or send it by e-mail. Until the SIAT epic issues the
 * invoice it says so (the invoice record is `PENDING`). Enter, Esc and the close button all start a new sale. The page does the
 * work of each button; this dialog only collects the e-mail address.
 */
@Component({
  selector: 'rs-pos-sale-completed-dialog',
  imports: [ButtonComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onKey($event)' },
  templateUrl: './pos-sale-completed.dialog.html',
  styleUrl: './pos-sale-completed.dialog.scss',
})
export class PosSaleCompletedDialog {
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');

  readonly open = input(false);
  readonly sale = input<CompletedSale | null>(null);
  /** "Caja 1", named in the note. */
  readonly registerName = input('');
  /** The page is queueing the e-mail. */
  readonly emailSending = input(false);

  readonly print = output<void>();
  readonly whatsapp = output<void>();
  readonly sendEmail = output<string>();
  /** "Nueva venta", Enter, Esc or the close button. */
  readonly newSale = output<void>();

  protected readonly emailOpen = signal(false);
  protected readonly email = signal('');

  protected readonly subtitle = computed(() => {
    const sale = this.sale();
    return sale ? `${sale.number} · ${sale.customerName} · ${formatReceiptDate(sale.createdAt)}` : '';
  });
  protected readonly totalText = computed(() => money(this.sale()?.total ?? '0'));
  protected readonly receivedText = computed(() => money(this.sale()?.received ?? '0'));
  protected readonly changeText = computed(() => money(this.sale()?.change ?? '0'));
  protected readonly canSend = computed(() => this.email().trim() !== '' && !this.emailSending());

  constructor() {
    // the field takes the focus when it opens
    effect(() => this.emailInput()?.nativeElement.focus());
    // every sale starts with the e-mail field closed and the customer's address ready in it
    effect(() => {
      const sale = this.sale();
      if (!this.open()) return;
      untracked(() => {
        this.emailOpen.set(false);
        this.email.set(sale?.customerEmail ?? '');
      });
    });
  }

  protected toggleEmail() {
    this.emailOpen.update((open) => !open);
  }

  protected submitEmail() {
    if (this.canSend()) this.sendEmail.emit(this.email().trim());
  }

  protected onOpenChange(open: boolean) {
    if (!open) this.newSale.emit();
  }

  /** Enter starts the next sale, unless it is pressed in the e-mail field (it sends) or on a button (it presses it). */
  protected onKey(event: KeyboardEvent) {
    if (!this.open() || event.repeat || event.key !== 'Enter') return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('button, a')) return;
    event.preventDefault();
    if (target instanceof HTMLInputElement) this.submitEmail();
    else this.newSale.emit();
  }
}
