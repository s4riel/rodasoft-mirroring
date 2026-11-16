import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { type CreditableInvoice, creditNoteTotal, creditNoteVat, Decimal, validateCreditNote } from '@rodasoft/domain';
import {
  ButtonComponent,
  EmptyStateIllustratedComponent,
  FieldComponent,
  InputDirective,
  NoteComponent,
  PageHeaderComponent,
  SelectComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { firstValueFrom } from 'rxjs';
import { problemOf } from '../../core/api-error';
import { formatBs } from '../sales/cash/cash-format';
import { documentNumberLabel } from './credit-note-format';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'redirecting';

const MONEY = /^\d{1,12}(\.\d{1,2})?$/;

/** A typed amount with a decimal comma or point, as the decimal string the API takes ("12,5" → "12.50"); null when it is not an amount. */
export function parseAmount(raw: string): string | null {
  const text = raw.trim().replace(',', '.');
  if (text === '' || !MONEY.test(text)) return null;
  return Decimal.of(text).toString();
}

/**
 * FS-25 · Emitir nota de crédito y débito (HU-FAC-12): a price-adjustment note over a valid invoice. It only lets credit what was invoiced
 * (each line shows what is left) and shows the VAT to adjust live. When the company does not allow notes without a return, or the user
 * cannot issue notes, it sends them to the return form of the sale, where the note is born from the return.
 */
@Component({
  selector: 'rs-credit-note-page',
  imports: [ButtonComponent, EmptyStateIllustratedComponent, FieldComponent, InputDirective, NoteComponent, PageHeaderComponent, SelectComponent, SkeletonComponent, ToastOutletComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './credit-note.page.html',
  styleUrl: './credit-note.page.scss',
})
export class CreditNotePage {
  private readonly api = inject(InvoicingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  private readonly invoiceId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<CreditableInvoice | null>(null);
  protected readonly reasonCode = signal<number | null>(null);
  /** What the user typed per line (`saleItemId` → text). */
  protected readonly amounts = signal<Record<string, string | undefined>>({});
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly numberText = computed(() => documentNumberLabel(this.data()?.invoiceNumber ?? null));
  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Facturación SIAT' },
    { label: 'Notas de crédito', link: '/invoicing/notes' },
    { label: 'Emitir nota de crédito y débito' },
  ]);
  protected readonly subtitle = computed(() => {
    const d = this.data();
    return d ? `Factura ${this.numberText()} · ${d.customerName} · ${formatBs(d.total)}` : '';
  });
  protected readonly reasonOptions = computed(() => (this.data()?.reasons ?? []).map((r) => ({ value: r.code, label: r.description })));

  /** The lines the user filled, as the API takes them; a line left empty credits nothing. */
  private readonly request = computed(() =>
    (this.data()?.lines ?? [])
      .map((line) => ({ saleItemId: line.saleItemId, quantity: 0, amount: parseAmount(this.amounts()[line.saleItemId] ?? '') }))
      .filter((item): item is { saleItemId: string; quantity: number; amount: string } => item.amount !== null),
  );
  /** A line with something typed that is not an amount. */
  protected readonly invalidLines = computed(() => new Set((this.data()?.lines ?? []).filter((l) => (this.amounts()[l.saleItemId] ?? '').trim() !== '' && parseAmount(this.amounts()[l.saleItemId] ?? '') === null).map((l) => l.saleItemId)));
  /** The lines over what is left to credit, by the same rule the server applies. */
  protected readonly exceeded = computed(() => {
    const d = this.data();
    if (!d) return new Set<string>();
    const lines = d.lines.map((l) => ({ saleItemId: l.saleItemId, invoicedQuantity: l.invoicedQuantity, invoicedAmount: l.invoicedAmount, creditedQuantity: 0, creditedAmount: Decimal.of(l.invoicedAmount).sub(Decimal.of(l.creditableAmount)).toString() }));
    return new Set(validateCreditNote(lines, this.request()).filter((i) => i.code === 'CREDIT_EXCEEDS_INVOICED').map((i) => i.saleItemId as string));
  });
  protected readonly total = computed(() => creditNoteTotal(this.request()));
  protected readonly totalText = computed(() => formatBs(this.total().toString()));
  protected readonly vatText = computed(() => formatBs(creditNoteVat(this.total()).toString()));
  protected readonly canSend = computed(
    () => !this.saving() && this.reasonCode() !== null && this.request().length > 0 && this.invalidLines().size === 0 && this.exceeded().size === 0,
  );
  protected readonly reasonError = computed(() => (this.touched() && this.reasonCode() === null ? 'Elige el motivo de la nota' : null));

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.api
      .creditable(this.invoiceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          // without price adjustments the note is born from a return: the return form of the sale is the way in
          if (!data.priceAdjustmentAllowed) return this.toReturnForm(data.saleId);
          this.data.set(data);
          this.state.set('ready');
        },
        error: (err) => {
          const problem = problemOf(err);
          // who may only register returns cannot read the creditable lines: the return form is theirs too
          if (problem.status === 403) return this.fallbackToSale();
          this.errorMessage.set(problem.message);
          this.state.set('error');
        },
      });
  }

  private toReturnForm(saleId: string) {
    this.state.set('redirecting');
    void this.router.navigate(['/sales/history', saleId], { replaceUrl: true });
  }

  private fallbackToSale() {
    this.state.set('redirecting');
    this.api
      .detail(this.invoiceId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (invoice) => void this.router.navigate(['/sales/history', invoice.saleId], { replaceUrl: true }),
        error: () => void this.router.navigate(['/invoicing'], { replaceUrl: true }),
      });
  }

  protected setAmount(saleItemId: string, value: string) {
    this.amounts.update((current) => ({ ...current, [saleItemId]: value }));
  }

  protected lineError(saleItemId: string, creditable: string): string | null {
    if (this.invalidLines().has(saleItemId)) return 'Escribe un monto válido, por ejemplo 40,00';
    if (this.exceeded().has(saleItemId)) return `Solo quedan ${formatBs(creditable)} por acreditar de esta línea`;
    return null;
  }

  protected money(value: string): string {
    return formatBs(value);
  }

  protected cancel() {
    void this.router.navigate(['/invoicing/invoices', this.invoiceId]);
  }

  protected async send() {
    this.touched.set(true);
    const reasonCode = this.reasonCode();
    if (!this.canSend() || reasonCode === null) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      const { id } = await firstValueFrom(this.api.createNote(this.invoiceId, { reasonCode, items: this.request() }));
      this.toast.success('Nota creada y enviada al SIAT');
      void this.router.navigate(['/invoicing/notes', id]);
    } catch (err) {
      this.error.set(problemOf(err).message);
    } finally {
      this.saving.set(false);
    }
  }
}
