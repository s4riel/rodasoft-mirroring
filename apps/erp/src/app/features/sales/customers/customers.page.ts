import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { CustomerListResponse, CustomerSummary, SaveCustomerInput } from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableCellDirective,
  DocTableComponent,
  EmptyStateIllustratedComponent,
  FilterBarProductsComponent,
  IconComponent,
  ModalComponent,
  PageHeaderComponent,
  PaginationComponent,
  RowActionComponent,
  SelectComponent,
  SkeletonComponent,
  StatusPillComponent,
  ToastOutletComponent,
  ToastService,
  type DocTableColumn,
  type DocTableRow,
  type RowMenuItem,
  type SelectOption,
} from '@rodasoft/ui';
import { catchError, debounceTime, of, Subject, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { CustomerForm } from './customer-form';
import { discountText, documentText } from './customer-format';
import { CustomersApi } from './customers-api.service';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type StatusFilter = 'ACTIVE' | 'INACTIVE' | 'ALL';

export const CUSTOMERS_PAGE_SIZE = 25;
export const CUSTOMERS_SEARCH_DEBOUNCE_MS = 250;

const COLUMNS: DocTableColumn[] = [
  { key: 'name', label: 'Cliente', type: 'custom' },
  { key: 'document', label: 'Documento', type: 'code', width: '12rem' },
  { key: 'contact', label: 'Contacto', type: 'text' },
  { key: 'credit', label: 'Crédito', type: 'text', width: '7rem' },
  { key: 'discount', label: 'Descuento', type: 'text', width: '14rem' },
  { key: 'status', label: 'Estado', type: 'custom', width: '8rem' },
  { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' },
];

const STATUS_OPTIONS: SelectOption<StatusFilter>[] = [
  { value: 'ACTIVE', label: 'Activos' },
  { value: 'INACTIVE', label: 'Inactivos' },
  { value: 'ALL', label: 'Todos' },
];

const ROW_MENU: RowMenuItem[] = [{ key: 'edit', label: 'Editar cliente', icon: 'edit' }];

/**
 * HU-VEN-37 · Customers of Management: the list and the form with the NIT, the credit flag and the discount (percent, fixed
 * Bs per sale, or none) that the POS applies automatically. Needs `sales.customers.manage`. Every change is audited by the
 * API with its user and date. There is no Figma frame yet: the screen is built from existing `libs/ui` parts.
 */
@Component({
  selector: 'rs-customers-page',
  imports: [
    ButtonComponent,
    CustomerForm,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FilterBarProductsComponent,
    IconComponent,
    ModalComponent,
    PageHeaderComponent,
    PaginationComponent,
    RowActionComponent,
    SelectComponent,
    SkeletonComponent,
    StatusPillComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './customers.page.html',
  styleUrl: './customers.page.scss',
})
export class CustomersPage implements OnInit {
  private readonly api = inject(CustomersApi);
  private readonly ctx = inject(ContextStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly loads = new Subject<void>();
  /** Typing in the search box: the list is asked again once the typing pauses. */
  private readonly typing = new Subject<void>();

  protected readonly columns = COLUMNS;
  protected readonly statusOptions = STATUS_OPTIONS;
  protected readonly rowMenu = ROW_MENU;
  protected readonly skeletonRows = [1, 2, 3, 4, 5];
  protected readonly breadcrumbs = [{ label: 'Inicio', link: '/' }, { label: 'Ventas y POS', link: '/sales' }, { label: 'Clientes' }];

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  protected readonly data = signal<CustomerListResponse | null>(null);
  protected readonly searchText = signal('');
  protected readonly status = signal<StatusFilter>('ACTIVE');
  protected readonly page = signal(1);

  protected readonly formOpen = signal(false);
  protected readonly editing = signal<CustomerSummary | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly items = computed(() => this.data()?.items ?? []);
  protected readonly rows = computed<DocTableRow[]>(() =>
    this.items().map((c) => ({
      id: c.id,
      label: c.name,
      cells: {
        name: c.name,
        document: documentText(c),
        contact: [c.email, c.phone].filter(Boolean).join(' · ') || '—',
        credit: c.creditEnabled ? 'Sí' : 'No',
        discount: discountText(c.discount),
        status: c.status,
        actions: null,
      },
    })),
  );
  protected readonly pageCount = computed(() => {
    const d = this.data();
    return d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  });
  protected readonly hasFilters = computed(() => this.searchText().trim() !== '' || this.status() !== 'ACTIVE');
  protected readonly showEmpty = computed(() => !this.hasFilters() && (this.data()?.total ?? 0) === 0);
  protected readonly showNoResults = computed(() => this.hasFilters() && (this.data()?.total ?? 0) === 0);
  protected readonly range = computed(() => {
    const d = this.data();
    if (!d || d.total === 0) return '';
    const from = (d.page - 1) * d.pageSize + 1;
    return `Mostrando ${from}–${from + d.items.length - 1} de ${d.total}`;
  });

  ngOnInit() {
    if (!this.ctx.can('sales.customers.manage')) {
      this.state.set('forbidden');
      return;
    }
    this.loads
      .pipe(
        tap(() => {
          if (this.data() === null) this.state.set('loading');
        }),
        switchMap(() =>
          this.api.list({ q: this.searchText().trim() || undefined, status: this.status(), page: this.page(), pageSize: CUSTOMERS_PAGE_SIZE }).pipe(
            catchError((err: unknown) => {
              const problem = problemOf(err);
              if (problem.status === 403) this.state.set('forbidden');
              else {
                this.errorMessage.set(problem.message);
                this.state.set('error');
              }
              return of(null);
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        if (!res) return;
        this.data.set(res);
        this.state.set('ready');
      });
    this.typing.pipe(debounceTime(CUSTOMERS_SEARCH_DEBOUNCE_MS), takeUntilDestroyed(this.destroyRef)).subscribe(() => this.reload());
    this.reload();
  }

  protected reload() {
    this.data.set(this.state() === 'error' ? null : this.data());
    this.loads.next();
  }

  protected retry() {
    this.data.set(null);
    this.reload();
  }

  protected onSearch(text: string) {
    this.searchText.set(text);
    this.page.set(1);
    this.typing.next();
  }

  protected setStatus(value: unknown) {
    this.status.set((value as StatusFilter | null) ?? 'ACTIVE');
    this.page.set(1);
    this.reload();
  }

  protected clearAll() {
    this.searchText.set('');
    this.status.set('ACTIVE');
    this.page.set(1);
    this.reload();
  }

  protected goToPage(page: number) {
    this.page.set(page);
    this.reload();
  }

  protected itemOf(id: string): CustomerSummary | undefined {
    return this.items().find((c) => c.id === id);
  }

  // --- the form ---

  protected openNew() {
    this.editing.set(null);
    this.saveError.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(customer: CustomerSummary) {
    this.editing.set(customer);
    this.saveError.set(null);
    this.formOpen.set(true);
  }

  protected save(input: SaveCustomerInput) {
    if (this.saving()) return;
    const current = this.editing();
    this.saving.set(true);
    this.saveError.set(null);
    const request = current ? this.api.update(current.id, input) : this.api.create(input);
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (saved) => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.toast.success(current ? `Cliente actualizado: ${saved.name}.` : `Cliente creado: ${saved.name}.`);
        this.reload();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.saveError.set(problemOf(err).message);
      },
    });
  }
}
