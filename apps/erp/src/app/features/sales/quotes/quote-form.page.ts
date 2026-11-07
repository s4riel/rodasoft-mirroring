import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { CustomerSummary, QuoteEditorContext, QuoteProductResult } from '@rodasoft/domain';
import {
  ButtonComponent,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  FieldComponent,
  InputDirective,
  EmptyStateIllustratedComponent,
  NoteComponent,
  PageHeaderComponent,
  QtyStepperComponent,
  SelectComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { catchError, of } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { formatBs } from '../cash/cash-format';
import { editorTotals, formatDay, isZero, stockHint, type EditorLine } from './quote-format';
import { QuotesApi } from './quotes-api.service';

const SEARCH_DELAY_MS = 300;
const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'text', width: '10rem' },
  { key: 'name', label: 'Producto', type: 'text' },
  { key: 'stock', label: 'Stock', type: 'custom', width: '9rem' },
  { key: 'price', label: 'Precio', type: 'number', width: '8rem' },
  { key: 'quantity', label: 'Cantidad', type: 'custom', width: '10rem' },
  { key: 'total', label: 'Importe', type: 'number', width: '8rem' },
  { key: 'remove', label: '', type: 'custom', align: 'end', width: '6rem' },
];

/** VP-08 · New quote: customer, product search with the branch stock, quantities, validity and the totals preview. */
@Component({
  selector: 'rs-quote-form-page',
  imports: [
    ButtonComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    InputDirective,
    NoteComponent,
    PageHeaderComponent,
    QtyStepperComponent,
    SelectComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-form.page.html',
  styleUrl: './quote-form.page.scss',
})
export class QuoteFormPage {
  private readonly api = inject(QuotesApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Ventas y POS', link: '/sales' },
    { label: 'Cotizaciones', link: '/sales/quotes' },
    { label: 'Nueva cotización' },
  ];
  protected readonly columns = COLUMNS;

  protected readonly context = signal<QuoteEditorContext | null>(null);
  protected readonly loadFailed = signal('');
  protected readonly forbidden = signal(false);
  protected readonly warehouseId = signal<string | null>(null);
  protected readonly validUntil = signal('');

  protected readonly customer = signal<CustomerSummary | null>(null);
  protected readonly customerText = signal('');
  protected readonly customerResults = signal<CustomerSummary[]>([]);

  protected readonly productText = signal('');
  protected readonly productResults = signal<QuoteProductResult[]>([]);
  protected readonly searching = signal(false);

  protected readonly lines = signal<EditorLine[]>([]);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);

  protected readonly warehouseOptions = computed(() => (this.context()?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name })));
  protected readonly totals = computed(() => {
    const discount = this.customer()?.discount ?? null;
    return editorTotals(this.lines(), discount, this.context()?.roundingMode ?? 'NONE');
  });
  protected readonly rows = computed(() =>
    this.lines().map((line) => ({
      id: line.productId,
      label: line.code,
      cells: {
        code: line.code,
        name: line.name,
        stock: null,
        price: formatBs(line.unitPrice),
        quantity: null,
        total: formatBs(editorTotals([line], null, 'NONE').total),
        remove: null,
      },
    })),
  );
  protected readonly hasDiscount = computed(() => !isZero(this.totals().discount));
  protected readonly hasRounding = computed(() => !isZero(this.totals().rounding));
  protected readonly customerError = computed(() => this.submitted() && !this.customer());
  protected readonly linesError = computed(() => this.submitted() && this.lines().length === 0);
  protected readonly validityLabel = computed(() => (this.validUntil() ? formatDay(this.validUntil()) : ''));
  protected readonly formatBs = formatBs;

  private customerTimer: ReturnType<typeof setTimeout> | undefined;
  private productTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.customerTimer);
      clearTimeout(this.productTimer);
    });
    this.load();
  }

  protected load() {
    this.loadFailed.set('');
    this.forbidden.set(false);
    this.api.context().subscribe({
      next: (context) => {
        this.context.set(context);
        this.warehouseId.set(context.warehouses[0]?.id ?? null);
        this.validUntil.set(context.defaultValidUntil);
      },
      error: (err) => {
        const problem = problemOf(err);
        if (problem.status === 403) this.forbidden.set(true);
        else this.loadFailed.set(problem.message);
      },
    });
  }

  // --- customer ---

  protected onCustomerText(text: string) {
    this.customerText.set(text);
    clearTimeout(this.customerTimer);
    if (!text.trim()) {
      this.customerResults.set([]);
      return;
    }
    this.customerTimer = setTimeout(() => {
      this.api
        .searchCustomers(text.trim())
        .pipe(catchError(() => of({ items: [] })))
        .subscribe((res) => this.customerResults.set(res.items));
    }, SEARCH_DELAY_MS);
  }

  protected pickCustomer(customer: CustomerSummary) {
    this.customer.set(customer);
    this.customerResults.set([]);
    this.customerText.set('');
  }

  protected changeCustomer() {
    this.customer.set(null);
  }

  // --- products ---

  protected onProductText(text: string) {
    this.productText.set(text);
    this.scheduleProductSearch();
  }

  protected setWarehouse(value: unknown) {
    this.warehouseId.set(value ? String(value) : null);
    this.scheduleProductSearch();
    this.refreshStock();
  }

  private scheduleProductSearch() {
    clearTimeout(this.productTimer);
    const warehouseId = this.warehouseId();
    const text = this.productText().trim();
    if (!text || !warehouseId) {
      this.productResults.set([]);
      return;
    }
    this.searching.set(true);
    this.productTimer = setTimeout(() => {
      this.api
        .searchProducts(text, warehouseId)
        .pipe(catchError(() => of({ items: [] })))
        .subscribe((res) => {
          this.productResults.set(res.items);
          this.searching.set(false);
        });
    }, SEARCH_DELAY_MS);
  }

  /** Enter adds the first result, as at the POS. */
  protected addFirst() {
    const first = this.productResults()[0];
    if (first) this.addProduct(first);
  }

  protected addProduct(product: QuoteProductResult) {
    this.lines.update((lines) => {
      const existing = lines.find((l) => l.productId === product.id);
      if (existing) return lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      return [
        ...lines,
        {
          productId: product.id,
          sku: product.sku,
          code: product.code,
          name: product.name,
          brandName: product.brandName,
          unitPrice: product.salePrice,
          quantity: 1,
          available: product.available,
        },
      ];
    });
    this.productText.set('');
    this.productResults.set([]);
  }

  /** The stock of the lines follows the warehouse chosen; products are searched again by id-less code. */
  private refreshStock() {
    const warehouseId = this.warehouseId();
    if (!warehouseId) return;
    for (const line of this.lines()) {
      this.api
        .searchProducts(line.code, warehouseId)
        .pipe(catchError(() => of({ items: [] })))
        .subscribe((res) => {
          const found = res.items.find((p) => p.id === line.productId);
          if (found) this.lines.update((all) => all.map((l) => (l.productId === line.productId ? { ...l, available: found.available } : l)));
        });
    }
  }

  protected setQuantity(productId: string, quantity: number) {
    this.lines.update((lines) => lines.map((l) => (l.productId === productId ? { ...l, quantity } : l)));
  }

  protected remove(productId: string) {
    this.lines.update((lines) => lines.filter((l) => l.productId !== productId));
  }

  protected lineOf(rowId: string): EditorLine | null {
    return this.lines().find((l) => l.productId === rowId) ?? null;
  }

  protected hintOf(line: EditorLine) {
    return stockHint(line.available, line.quantity);
  }

  protected stockText(product: QuoteProductResult): string {
    return product.available > 0 ? `Disponible ${product.available}` : 'Sin existencia';
  }

  protected onValidUntil(value: string) {
    this.validUntil.set(value);
  }

  // --- save ---

  protected save() {
    this.submitted.set(true);
    const customer = this.customer();
    if (!customer || this.lines().length === 0 || this.saving()) return;
    this.saving.set(true);
    this.api
      .create({
        customerId: customer.id,
        validUntil: this.validUntil() || undefined,
        lines: this.lines().map((l) => ({ productId: l.productId, quantity: l.quantity })),
      })
      .subscribe({
        next: (quote) => {
          this.toast.success(`Cotización ${quote.number} creada`);
          void this.router.navigate(['/sales/quotes', quote.id]);
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.danger(problemOf(err).message);
        },
      });
  }

  protected cancel() {
    void this.router.navigate(['/sales/quotes']);
  }
}
