import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { fiscalDebit, isNitFormatValid, isVatBookPeriod, normalizeNit, type PurchaseBookRow } from '@rodasoft/domain';
import {
  ButtonComponent,
  EmptyStateIllustratedComponent,
  FieldComponent,
  InputDirective,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { firstValueFrom } from 'rxjs';
import { problemOf } from '../../core/api-error';
import { formatBs } from '../sales/cash/cash-format';
import { bookDate } from './credit-note-format';
import { InvoicingApi } from './invoicing-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden' | 'not-found';

/**
 * FS-38 · Compra observada (HU-FAC-19): the SIN does not know the supplier's NIT, so the purchase adds no tax credit. The user checks the
 * NIT again or types a corrected one; when the SIN recognises it the purchase becomes valid and adds its 13 % credit. If the SIAT does not
 * answer nothing changes. The purchase is read from its period's book (`?period=`), there is no endpoint for a single entry.
 */
@Component({
  selector: 'rs-purchase-entry-page',
  imports: [ButtonComponent, EmptyStateIllustratedComponent, FieldComponent, InputDirective, NoteComponent, PageHeaderComponent, SkeletonComponent, ToastOutletComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './purchase-entry.page.html',
  styleUrl: './purchase-entry.page.scss',
})
export class PurchaseEntryPage {
  private readonly api = inject(InvoicingApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  private readonly id = this.route.snapshot.paramMap.get('id') ?? '';
  private readonly requestedPeriod = this.route.snapshot.queryParamMap.get('period');
  protected readonly period = isVatBookPeriod(this.requestedPeriod) ? this.requestedPeriod : null;

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly entry = signal<PurchaseBookRow | null>(null);
  protected readonly nit = signal('');
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  /** What the SIN answered the last time, when it did not know the NIT. */
  protected readonly refusal = signal<string | null>(null);
  protected readonly verified = signal(false);

  protected readonly observed = computed(() => this.entry()?.status === 'OBSERVED');
  protected readonly title = computed(() => (this.entry() ? `Compra ${this.entry()?.invoiceNumber}${this.observed() ? ' · observada' : ''}` : 'Compra'));
  protected readonly subtitle = computed(() => {
    const e = this.entry();
    return e ? `${e.supplierName} · ${bookDate(e.date)} · ${formatBs(e.total)}` : '';
  });
  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Facturación SIAT' },
    { label: 'Libro de compras', link: '/invoicing/books' },
    { label: this.entry() ? `Compra ${this.entry()?.invoiceNumber}` : 'Compra' },
  ]);
  protected readonly totalText = computed(() => formatBs(this.entry()?.total ?? '0.00'));
  protected readonly creditIfValid = computed(() => formatBs(fiscalDebit(this.entry()?.total ?? '0.00').toString()));
  protected readonly dateText = computed(() => bookDate(this.entry()?.date ?? '0000-00-00'));
  protected readonly creditNow = computed(() => (this.observed() ? '—' : formatBs(this.entry()?.vatCredit ?? '0.00')));
  protected readonly nitError = computed(() => (this.touched() && !isNitFormatValid(this.nit()) ? 'Escribe un NIT válido, solo números' : this.refusal()));
  protected readonly canVerify = computed(() => !this.saving() && isNitFormatValid(this.nit()));

  constructor() {
    this.load();
  }

  protected load() {
    this.state.set('loading');
    if (!this.period) {
      this.state.set('not-found');
      return;
    }
    this.api
      .purchasesBook(this.period)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (book) => {
          const found = book.rows.find((r) => r.id === this.id) ?? null;
          this.entry.set(found);
          if (found) this.nit.set(found.supplierNit);
          this.state.set(found ? 'ready' : 'not-found');
        },
        error: (err) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  protected back() {
    void this.router.navigate(['/invoicing/books'], { queryParams: { book: 'purchases', ...(this.period ? { period: this.period } : {}) } });
  }

  /** "Verificar NIT": asks the SIN; a recognised NIT validates the purchase. Returns whether it did. */
  protected async verify(): Promise<boolean> {
    this.touched.set(true);
    if (!this.canVerify()) return false;
    this.saving.set(true);
    this.error.set(null);
    this.refusal.set(null);
    const nit = normalizeNit(this.nit());
    try {
      const result = await firstValueFrom(this.api.verifyPurchaseNit(this.id, nit === this.entry()?.supplierNit ? undefined : nit));
      if (!result.valid) {
        this.refusal.set('El SIAT no reconoce este NIT. Revisa los dígitos.');
        return false;
      }
      this.entry.set(result.entry);
      this.verified.set(true);
      this.toast.success('NIT verificado: la compra suma crédito fiscal');
      return true;
    } catch (err) {
      this.error.set(problemOf(err).message);
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** "Guardar y validar": verifies and, once the purchase is valid, goes back to the book. */
  protected async saveAndValidate() {
    if (this.entry()?.status === 'VALID' || (await this.verify())) this.back();
  }
}
