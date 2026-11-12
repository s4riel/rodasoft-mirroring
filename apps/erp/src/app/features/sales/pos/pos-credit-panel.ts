import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { creditDueDate, Decimal, formatDayShort, laPazToday, validateCreditTerm, type PosCreditInfo } from '@rodasoft/domain';
import { FieldComponent, FilterChipComponent, InputDirective, InputGroupComponent, NumericInputDirective } from '@rodasoft/ui';

/** The term the cashier picked: one of the company's terms, or "Otro" with the days typed. */
type TermChoice = number | 'other' | null;

/**
 * VP-04d · Cobrar a crédito (HU-VEN-34, decision #53). The whole sale goes to the customer's account: the cashier picks the
 * term (the company's terms and "Otro" with a typed number of days) and sees the due date and the balance. Credit is a flag on
 * the customer record with no amount limit; this panel only runs when the server said the cart's customer qualifies. The dialog
 * drives the footer button ("Confirmar venta a crédito") through `canSubmit()` and `submit()`; Enter submits too.
 */
@Component({
  selector: 'rs-pos-credit-panel',
  imports: [FieldComponent, FilterChipComponent, InputDirective, InputGroupComponent, NumericInputDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.enter)': 'onEnter($event)' },
  templateUrl: './pos-credit-panel.html',
  styleUrl: './pos-credit-panel.scss',
})
export class PosCreditPanel {
  /** The total the server froze (`pay`), a decimal string. */
  readonly total = input.required<string>();
  /** The terms to offer (`sales.creditTermDays`), from the `pay` answer. */
  readonly info = input.required<PosCreditInfo>();
  readonly customerName = input.required<string>();
  /** The sale is being saved. */
  readonly busy = input(false);

  /** The cashier confirmed the term: the page completes the sale on credit. */
  readonly confirmed = output<number>();

  protected readonly choice = signal<TermChoice>(null);
  protected readonly otherText = signal('');

  /** The term in days, or `null` while none is picked or the typed one is not valid. */
  readonly termDays = computed<number | null>(() => {
    const choice = this.choice();
    if (typeof choice === 'number') return choice;
    if (choice !== 'other') return null;
    const text = this.otherText().trim();
    const days = /^\d{1,4}$/.test(text) ? Number(text) : NaN;
    return validateCreditTerm(days) ? days : null;
  });

  protected readonly otherError = computed(() =>
    this.choice() === 'other' && this.otherText().trim() !== '' && this.termDays() === null ? 'Escribe de 1 a 365 días.' : null,
  );

  /** "21/11/2026", the La Paz day plus the term; a dash while there is no term. */
  protected readonly dueText = computed(() => {
    const days = this.termDays();
    return days === null ? '—' : formatDayShort(creditDueDate(laPazToday(new Date()), days));
  });
  protected readonly balanceText = computed(() => Decimal.of(this.total()).format());

  readonly canSubmit = computed(() => this.termDays() !== null && !this.busy());

  /** A term chip: choosing the selected one again keeps it (the term is not optional). */
  protected pick(value: Exclude<TermChoice, null>, selected: boolean, chip: { selected: { set(value: boolean): void } }) {
    if (!selected) {
      chip.selected.set(true);
      return;
    }
    this.choice.set(value);
  }

  protected onOther(event: Event) {
    this.otherText.set((event.target as HTMLInputElement).value);
  }

  submit() {
    const days = this.termDays();
    if (days === null || this.busy()) return;
    this.confirmed.emit(days);
  }

  protected onEnter(event: Event) {
    // Enter on a chip or another button presses it; only Enter in the days field (or elsewhere in the panel) confirms
    if (event.target instanceof HTMLElement && event.target.closest('button')) return;
    event.preventDefault();
    this.submit();
  }
}
