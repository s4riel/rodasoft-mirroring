import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CustomerSummary, SaveCustomerInput } from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  ModalComponent,
  NoteComponent,
  SkeletonComponent,
} from '@rodasoft/ui';
import { catchError, debounceTime, map, of, Subject, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { CustomerForm } from '../customers/customer-form';
import { customerDetail } from '../customers/customer-format';
import { PosApi } from './pos-api.service';

type SearchState = 'loading' | 'ready' | 'error';
type Mode = 'search' | 'create';

/** The search waits this long after the last key before it asks. */
export const POS_CUSTOMER_SEARCH_DEBOUNCE_MS = 250;

/**
 * VP-03c · Customer and invoice data (HU-VEN-05). Search by NIT, CI or name, pick the customer the sale invoices to (or a
 * final consumer), or create one quickly. The page decides what choosing does (it sets the cart's customer and closes the
 * dialog once the server accepted it); a quick creation is also chosen right away.
 */
@Component({
  selector: 'rs-pos-customer-dialog',
  imports: [ButtonComponent, CustomerForm, FieldComponent, IconComponent, InputDirective, InputGroupComponent, ModalComponent, NoteComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos-customer.dialog.html',
  styleUrl: './pos-customer.dialog.scss',
})
export class PosCustomerDialog {
  private readonly api = inject(PosApi);
  private readonly destroyRef = inject(DestroyRef);
  private readonly queries = new Subject<string>();

  readonly open = model(false);
  /** The customer the sale has now; `null` is a final consumer. */
  readonly current = input<CustomerSummary | null>(null);
  /** The page is setting the customer: the buttons wait for the answer. */
  readonly saving = input(false);

  /** The customer to invoice, or `null` for a final consumer. */
  readonly choose = output<CustomerSummary | null>();
  /** A request failed; the page checks whether the cash shift was lost. */
  readonly failed = output<unknown>();

  protected readonly mode = signal<Mode>('search');
  protected readonly query = signal('');
  protected readonly state = signal<SearchState>('loading');
  protected readonly results = signal<CustomerSummary[]>([]);
  protected readonly selected = signal<CustomerSummary | null>(null);
  /** The text the shown results answer (for "Sin clientes para «…»"). */
  protected readonly resultsQuery = signal('');
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);
  /** A quick creation hit an existing document: the customer that already has it. */
  protected readonly existing = signal<CustomerSummary | null>(null);

  protected readonly detail = customerDetail;

  constructor() {
    this.queries
      .pipe(
        tap(() => this.state.set('loading')),
        debounceTime(POS_CUSTOMER_SEARCH_DEBOUNCE_MS),
        switchMap((q) =>
          this.api.customers(q).pipe(
            map((res) => ({ q, items: res.items })),
            catchError((err: unknown) => {
              this.failed.emit(err);
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        if (!res) {
          this.state.set('error');
          return;
        }
        this.results.set(res.items);
        this.resultsQuery.set(res.q);
        this.state.set('ready');
      });

    // every time the dialog opens it starts from a clean search
    effect(() => {
      if (!this.open()) return;
      untracked(() => this.reset());
    });
  }

  private reset(): void {
    this.mode.set('search');
    this.query.set('');
    this.selected.set(null);
    this.existing.set(null);
    this.createError.set(null);
    this.results.set([]);
    this.search('');
  }

  protected onQuery(value: string): void {
    this.query.set(value);
    this.search(value.trim());
  }

  protected retry(): void {
    this.search(this.query().trim());
  }

  private search(q: string): void {
    this.queries.next(q);
  }

  protected pick(customer: CustomerSummary): void {
    this.selected.set(customer);
  }

  protected use(): void {
    const customer = this.selected();
    if (customer && !this.saving()) this.choose.emit(customer);
  }

  protected useFinalConsumer(): void {
    if (!this.saving()) this.choose.emit(null);
  }

  protected newCustomer(): void {
    this.createError.set(null);
    this.mode.set('create');
  }

  protected backToSearch(): void {
    this.mode.set('search');
  }

  protected create(input: SaveCustomerInput): void {
    if (this.creating()) return;
    this.creating.set(true);
    this.createError.set(null);
    this.api
      .createCustomer({
        name: input.name,
        documentType: input.documentType,
        documentNumber: input.documentNumber,
        complement: input.complement,
        email: input.email,
        phone: input.phone,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (customer) => {
          this.creating.set(false);
          // a customer just created is the one the cashier wants for this sale
          this.choose.emit(customer);
        },
        error: (err: unknown) => {
          this.creating.set(false);
          this.failed.emit(err);
          const problem = problemOf(err);
          const found = (problem.details as { customer?: CustomerSummary } | undefined)?.customer;
          if (problem.code === 'CUSTOMER_DOCUMENT_DUPLICATED' && found) {
            // the customer exists: offer it instead of the form
            this.existing.set(found);
            this.results.set([found]);
            this.resultsQuery.set(found.documentNumber);
            this.selected.set(found);
            this.state.set('ready');
            this.mode.set('search');
            return;
          }
          this.createError.set(problem.message);
        },
      });
  }
}
