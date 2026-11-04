import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import {
  cartTotals,
  Decimal,
  lineTotal,
  receiptShareText,
  FINAL_CONSUMER,
  type CashRegisterOption,
  type CompletedSale,
  type CurrentCashShift,
  type CustomerSummary,
  type PosCategory,
  type PosCheckoutLine,
  type PosCheckoutResponse,
  type PosCheckoutView,
  type PosEquivalentItem,
  type PosProductResult,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  ChipMediaComponent,
  EmptyStateComponent,
  EmptyStateIllustratedComponent,
  FilterChipComponent,
  ICON_ALIASES,
  ICONS,
  IconComponent,
  IllustrationComponent,
  InputDirective,
  InputGroupComponent,
  PosCartLineComponent,
  PosCustomerComponent,
  PosResultRowComponent,
  SkeletonComponent,
  ToastOutletComponent,
  ToastService,
  type IconName,
} from '@rodasoft/ui';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap, type Observable } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { CashApi } from '../cash/cash-api.service';
import { customerDetail } from '../customers/customer-format';
import { registerPlace } from '../cash/cash-format';
import { PosApi } from './pos-api.service';
import { PosCustomerDialog } from './pos-customer.dialog';
import { PosEquivalentsPanel } from './pos-equivalents-panel';
import { PosPaymentDialog } from './pos-payment.dialog';
import { PosSaleCompletedDialog } from './pos-sale-completed.dialog';
import { PosProductSheetDialog, type PosSheetAdd } from './pos-product-sheet.dialog';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';
type SearchState = 'idle' | 'loading' | 'ready' | 'error';
type CartState = 'loading' | 'ready' | 'error';

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
/** The search waits this long after the last key before it asks. */
export const POS_SEARCH_DEBOUNCE_MS = 200;
const FALLBACK_CATEGORY_ICON: IconName = 'category';

interface SearchKey {
  q: string;
  categoryId: string | null;
}
const keyOf = (k: SearchKey) => `${k.categoryId ?? ''}|${k.q}`;
const isEmptySearch = (k: SearchKey) => !k.q && !k.categoryId;

const money = (value: string) => Decimal.of(value).format();

/** A key for one payment attempt. `randomUUID` only exists in secure contexts, so there is a fallback with enough entropy. */
function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const bytes = c?.getRandomValues ? c.getRandomValues(new Uint8Array(16)) : Uint8Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * VP-03 · Point of sale, full screen (HU-VEN-02). Left: search by code, measurement or brand, category chips and results
 * with the stock of the register's warehouse. Right: the current sale (server-side cart) with instant totals: quantity and
 * remove changes are optimistic, recalculated with `cartTotals()` on the spot and replaced by the server's answer, or undone
 * with a toast. Without an open shift the HU-VEN-01 "Caja cerrada" card (VP-14) covers the page.
 */
@Component({
  selector: 'rs-pos-page',
  imports: [
    ButtonComponent,
    ChipMediaComponent,
    EmptyStateComponent,
    EmptyStateIllustratedComponent,
    FilterChipComponent,
    IconComponent,
    IllustrationComponent,
    InputDirective,
    InputGroupComponent,
    NgTemplateOutlet,
    PosCartLineComponent,
    PosCustomerComponent,
    PosCustomerDialog,
    PosEquivalentsPanel,
    PosPaymentDialog,
    PosProductSheetDialog,
    PosSaleCompletedDialog,
    PosResultRowComponent,
    SkeletonComponent,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown)': 'onShortcut($event)' },
  templateUrl: './pos.page.html',
  styleUrl: './pos.page.scss',
})
export class PosPage implements OnInit {
  private readonly cashApi = inject(CashApi);
  private readonly api = inject(PosApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = viewChild<ElementRef<HTMLElement>>('dialog');
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  private readonly allChip = viewChild('allChip', { read: FilterChipComponent });

  protected readonly state = signal<LoadState>('loading');
  protected readonly shift = signal<CurrentCashShift | null>(null);
  /** The registers of the user's branches, only fetched when the register is closed (to name the one they would open). */
  private readonly registers = signal<CashRegisterOption[]>([]);

  protected readonly closed = computed(() => this.state() === 'ready' && this.shift() === null);
  protected readonly canOpenRegister = computed(() => this.ctx.can('sales.cash-register.open'));

  // --- search ---
  protected readonly categories = signal<PosCategory[]>([]);
  protected readonly categoryId = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly searchState = signal<SearchState>('idle');
  protected readonly results = signal<PosProductResult[]>([]);
  /** The text the shown results answer (for "Sin resultados para «…»"). */
  protected readonly resultsQuery = signal('');
  private readonly resultsKey = signal<string | null>(null);
  /** The out-of-stock result whose equivalents panel is open (VP-03b); only one at a time. */
  protected readonly equivalentsOpenId = signal<string | null>(null);
  /** The technical sheet (VP-03e) is open for this product. */
  protected readonly sheetOpen = signal(false);
  protected readonly sheetProductId = signal<string | null>(null);
  protected readonly sheetAdding = signal(false);
  /** Enter pressed before the results of the current text arrived: add the first one when they do. */
  private pendingEnter: string | null = null;
  private readonly searchKey = computed<SearchKey>(() => ({ q: this.query().trim(), categoryId: this.categoryId() }));

  // --- cart ---
  protected readonly cartState = signal<CartState>('loading');
  /** Last cart the server confirmed. */
  private readonly serverCheckout = signal<PosCheckoutView | null>(null);
  /** What the cashier sees: the server's lines plus the optimistic changes still in flight. */
  protected readonly lines = signal<PosCheckoutLine[]>([]);
  private inFlight = 0;
  /** Order in which cart requests were sent: a slower, older answer must not overwrite a newer one. */
  private requestSeq = 0;
  private appliedSeq = 0;
  protected readonly adding = signal<ReadonlySet<string>>(new Set());

  /** The customer of the sale (VP-03c); `null` invoices a final consumer. */
  protected readonly customer = computed(() => this.serverCheckout()?.customer ?? null);
  protected readonly customerName = computed(() => this.customer()?.name ?? 'Consumidor final');
  protected readonly customerDetail = computed(() => {
    const customer = this.customer();
    return customer ? customerDetail(customer) : `Sin NIT · factura a ${FINAL_CONSUMER.name}`;
  });
  protected readonly customerOpen = signal(false);
  protected readonly customerSaving = signal(false);

  // --- payment (VP-04) and completed sale (VP-16a) ---
  protected readonly paymentOpen = signal(false);
  /** The total the server froze when the cart went to payment. */
  protected readonly payTotal = signal('0.00');
  protected readonly paySuggested = signal<string[]>([]);
  /** `pay` is in flight: a second F9 or click does nothing. */
  protected readonly payStarting = signal(false);
  /** `complete` is in flight: the payment screen waits for the answer. */
  protected readonly paying = signal(false);
  /** Sent with `complete`; the same key on a retry returns the sale instead of selling twice. */
  private paymentKey = '';
  /** The amount of a `complete` that got no answer: the sale may be saved, so cancelling must find out first. */
  private uncertainReceived: string | null = null;
  protected readonly completedOpen = signal(false);
  protected readonly completedSale = signal<CompletedSale | null>(null);
  protected readonly emailSending = signal(false);
  protected readonly canCharge = computed(() => !!this.shift() && this.lines().length > 0 && !this.payStarting());

  protected readonly totals = computed(() => {
    const pricing = this.serverCheckout()?.pricing ?? { roundingMode: 'NONE' as const, discount: null };
    return cartTotals(this.lines(), pricing);
  });
  protected readonly subtotalText = computed(() => this.totals().subtotal.format());
  protected readonly discountText = computed(() => (this.totals().discount.isZero() ? null : `−${this.totals().discount.format()}`));
  protected readonly totalText = computed(() => this.totals().total.format());

  /** The register named in the closed card: the only one of the branch in the ContextBar, when there is exactly one. */
  private readonly onlyRegister = computed(() => {
    const branch = this.ctx.currentBranch();
    const visible = branch ? this.registers().filter((r) => r.branch.id === branch.id) : this.registers();
    return visible.length === 1 ? visible[0] : null;
  });
  protected readonly closedText = computed(() => {
    if (!this.canOpenRegister()) return 'No tienes un turno abierto. Pide a un responsable de caja que abra tu turno.';
    const register = this.onlyRegister();
    return `No tienes un turno abierto${register ? ` en la ${register.name}` : ''}. Abre tu turno para empezar a vender.`;
  });

  /** `Caja 1 · Sucursal · Usuario` (Figma VP-03 header; the SIAT status arrives with the SIAT epic). */
  protected readonly description = computed(() => {
    const s = this.shift();
    if (s) return [registerPlace({ name: s.register.name, branch: s.branch }), s.openedBy.name].join(' · ');
    const register = this.onlyRegister();
    const place = register ? registerPlace(register) : this.ctx.currentBranch()?.name;
    return [place, this.ctx.context()?.user.name].filter(Boolean).join(' · ') || 'Caja cerrada';
  });

  constructor() {
    // focus moves into the card when it appears
    effect(() => this.dialog()?.nativeElement.querySelector<HTMLElement>('[data-autofocus]')?.focus());
    this.watchSearch();
  }

  ngOnInit() {
    if (!this.ctx.can('sales.pos.use')) {
      this.state.set('forbidden');
      return;
    }
    this.load();
  }

  protected load() {
    this.state.set('loading');
    this.cashApi
      .current()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ shift }) => {
          this.shift.set(shift);
          this.state.set('ready');
          if (shift) {
            this.loadCategories();
            this.loadCart();
          } else if (this.canOpenRegister()) {
            this.loadRegisters();
          }
        },
        error: (err: unknown) => this.state.set(problemOf(err).status === 403 ? 'forbidden' : 'error'),
      });
  }

  private loadRegisters() {
    this.cashApi
      .registers()
      .pipe(
        catchError(() => of({ items: [] })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ items }) => this.registers.set(items));
  }

  private loadCategories() {
    this.api
      .categories()
      .pipe(
        catchError(() => of({ items: [] })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ items }) => this.categories.set(items));
  }

  protected loadCart() {
    this.cartState.set('loading');
    this.api
      .checkout()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ checkout }) => {
          this.adopt(checkout);
          this.cartState.set('ready');
          // the payment screen is gone after a refresh: a cart still waiting for payment goes back to the cart
          if (checkout?.status === 'PAYING') this.returnToCart();
        },
        error: (err: unknown) => (this.handleShiftLost(err) ? undefined : this.cartState.set('error')),
      });
  }

  // --- payment ---

  /** F9 or "Cobrar": freezes the total on the server and opens the payment screen. */
  protected startPayment() {
    if (!this.canCharge() || this.inFlight > 0) return;
    this.payStarting.set(true);
    this.api
      .pay()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.payStarting.set(false);
          this.payTotal.set(res.total);
          this.paySuggested.set(res.suggestedAmounts);
          this.paymentKey = newIdempotencyKey();
          this.paymentOpen.set(true);
        },
        error: (err: unknown) => {
          this.payStarting.set(false);
          if (this.handleShiftLost(err)) return;
          this.toast.danger(this.errorMessage(err));
          // a changed price or a stale cart: show the cart as the server has it now
          this.loadCart();
        },
      });
  }

  /** "Cancelar", Esc or the close button of the payment screen: the cart goes back to `OPEN`. */
  protected cancelPayment() {
    // once the sale is being saved there is nothing to cancel: the answer decides what happens next
    if (this.paying()) return;
    this.paymentOpen.set(false);
    if (this.uncertainReceived !== null) {
      this.cancelAfterNoAnswer(this.uncertainReceived);
      return;
    }
    this.returnToCart();
  }

  /**
   * A `complete` got no answer and the cashier cancels. If the cart is still waiting for payment the sale was not saved and
   * it goes back to the cart. If it is gone the sale was saved: asking again with the same key returns it.
   */
  private cancelAfterNoAnswer(received: string) {
    this.uncertainReceived = null;
    this.api
      .back()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.adopt(res.checkout),
        error: (err: unknown) => {
          if (problemOf(err).code === 'CHECKOUT_NOT_FOUND') {
            this.confirmPayment(received);
            return;
          }
          if (!this.handleShiftLost(err)) this.loadCart();
        },
      });
  }

  /** `PAYING → OPEN`, then shows the cart the server answers with. */
  private returnToCart() {
    this.api
      .back()
      .pipe(
        catchError((err: unknown) => {
          if (!this.handleShiftLost(err)) this.loadCart();
          return of(null);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        if (res) this.adopt(res.checkout);
      });
  }

  /** "Confirmar cobro": the server writes the whole sale; the dialog closes only once it is saved. */
  protected confirmPayment(received: string) {
    if (this.paying()) return;
    this.paying.set(true);
    this.uncertainReceived = null;
    this.api
      .complete({ payments: [{ method: 'CASH', received }], expectedTotal: this.payTotal(), idempotencyKey: this.paymentKey })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ sale }) => {
          this.paying.set(false);
          this.paymentOpen.set(false);
          this.completedSale.set(sale);
          this.completedOpen.set(true);
          // the sale is saved: the cart is empty
          this.serverCheckout.set(null);
          this.lines.set([]);
        },
        error: (err: unknown) => {
          this.paying.set(false);
          const problem = problemOf(err);
          if (problem.status === 0) {
            // no answer: the sale may or may not be saved. Retrying with the same key never sells twice.
            this.uncertainReceived = received;
            this.toast.danger('No pudimos confirmar el cobro. Revisa tu conexión y vuelve a confirmar.');
            return;
          }
          this.paymentOpen.set(false);
          if (this.handleShiftLost(err)) return;
          this.toast.danger(this.errorMessage(err));
          // the sale was not saved: back to the cart, as the server has it
          this.returnToCart();
        },
      });
  }

  /** "Nueva venta": the cart is already empty; the cashier goes back to searching. */
  protected newSale() {
    this.completedOpen.set(false);
    this.completedSale.set(null);
    this.searchBox()?.nativeElement.focus();
  }

  protected printReceipt() {
    const sale = this.completedSale();
    if (!sale) return;
    const url = this.router.serializeUrl(this.router.createUrlTree(['/sales', 'receipts', sale.saleId, 'print']));
    window.open(url, '_blank', 'noopener');
  }

  protected shareWhatsapp() {
    const sale = this.completedSale();
    if (!sale) return;
    // the tab opens on the click (a popup opened after the request would be blocked) and goes to WhatsApp when the text is ready
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    this.api
      .receipt(sale.saleId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (receipt) => {
          const url = `https://wa.me/?text=${encodeURIComponent(receiptShareText(receipt))}`;
          if (tab) tab.location.href = url;
          else window.open(url, '_blank', 'noopener');
        },
        error: (err: unknown) => {
          tab?.close();
          this.toast.danger(this.errorMessage(err));
        },
      });
  }

  protected emailReceipt(email: string) {
    const sale = this.completedSale();
    if (!sale || this.emailSending()) return;
    this.emailSending.set(true);
    this.api
      .sendReceiptEmail(sale.saleId, email)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.emailSending.set(false);
          this.toast.success(`Enviamos el comprobante a ${email}.`);
        },
        error: (err: unknown) => {
          this.emailSending.set(false);
          this.toast.danger(this.errorMessage(err));
        },
      });
  }

  // --- search ---

  private watchSearch() {
    toObservable(this.searchKey)
      .pipe(
        distinctUntilChanged((a, b) => keyOf(a) === keyOf(b)),
        tap((key) => {
          // the panel belongs to the results of the previous search
          this.equivalentsOpenId.set(null);
          if (isEmptySearch(key)) {
            this.searchState.set('idle');
            this.resetResults();
          } else {
            this.searchState.set('loading');
          }
        }),
        debounceTime(POS_SEARCH_DEBOUNCE_MS),
        switchMap((key) => {
          if (isEmptySearch(key)) return of(null);
          return this.api.search({ q: key.q, categoryId: key.categoryId ?? undefined }).pipe(
            map((res) => ({ key, items: res.items })),
            catchError((err: unknown) => {
              this.handleShiftLost(err);
              return of({ key, failed: true as const });
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        if (!res) return;
        if ('failed' in res) {
          this.searchState.set('error');
          this.resetResults();
          return;
        }
        this.results.set(res.items);
        this.resultsQuery.set(res.key.q);
        this.resultsKey.set(keyOf(res.key));
        this.searchState.set('ready');
        if (this.pendingEnter === keyOf(res.key)) {
          this.pendingEnter = null;
          this.addFirst();
        }
      });
  }

  private resetResults() {
    this.results.set([]);
    this.resultsKey.set(null);
  }

  protected onQuery(value: string) {
    this.query.set(value);
  }

  protected selectCategory(id: string, selected: boolean) {
    this.categoryId.set(selected ? id : null);
  }

  /** "Todos" cannot be switched off by clicking it: it is the absence of a category. */
  protected selectAll(selected: boolean) {
    if (selected) this.categoryId.set(null);
    else this.allChip()?.selected.set(true);
  }

  protected categoryIcon(icon: string): IconName {
    return icon in ICONS || icon in ICON_ALIASES ? (icon as IconName) : FALLBACK_CATEGORY_ICON;
  }

  /** Enter: adds the first result of the current text (waiting for it when the search is still running). */
  protected addFirst() {
    if (isEmptySearch(this.searchKey())) return;
    const key = keyOf(this.searchKey());
    if (this.resultsKey() !== key || this.searchState() !== 'ready') {
      this.pendingEnter = key;
      return;
    }
    const first = this.results()[0];
    if (!first) return;
    // an out-of-stock product cannot be added: Enter offers its equivalents instead
    if (first.stockStatus === 'out') this.equivalentsOpenId.set(first.id);
    else this.add(first);
  }

  /** "Equivalentes" of an out-of-stock row: opens its panel, or closes it when it is already open. */
  protected toggleEquivalents(product: PosProductResult) {
    this.equivalentsOpenId.update((open) => (open === product.id ? null : product.id));
  }

  /** The eye button of a row, or Space: opens the technical sheet of a product. */
  protected openSheet(productId: string) {
    this.sheetProductId.set(productId);
    this.sheetOpen.set(true);
  }

  /** "Agregar a la venta" of the sheet: adds the quantity and closes the sheet once the server accepted it. */
  protected addFromSheet({ productId, quantity }: PosSheetAdd) {
    if (this.sheetAdding()) return;
    this.sheetAdding.set(true);
    this.mutate(
      this.api.addItem({ productId, quantity }),
      () => this.sheetAdding.set(false),
      () => this.sheetOpen.set(false),
    );
  }

  protected equivalentsFailed(err: unknown) {
    this.handleShiftLost(err);
  }

  protected clearSearch() {
    this.pendingEnter = null;
    this.query.set('');
  }

  protected stockLabel(p: PosProductResult): string {
    return p.stockStatus === 'out' ? 'Agotado aquí' : `${p.available} en ${p.warehouse.name}`;
  }

  protected price(value: string): string {
    return money(value);
  }

  protected isAdding(productId: string): boolean {
    return this.adding().has(productId);
  }

  // --- cart ---

  protected add(product: PosProductResult) {
    this.addById(product.id);
  }

  /** Agregar of an equivalent in the panel of an out-of-stock product. */
  protected addEquivalent(item: PosEquivalentItem) {
    this.addById(item.productId);
  }

  private addById(productId: string) {
    if (this.isAdding(productId)) return;
    this.adding.update((s) => new Set(s).add(productId));
    this.mutate(this.api.addItem({ productId, quantity: 1 }), () => {
      this.adding.update((s) => {
        const next = new Set(s);
        next.delete(productId);
        return next;
      });
    });
  }

  // --- customer (VP-03c) ---

  protected openCustomer() {
    if (this.shift()) this.customerOpen.set(true);
  }

  /** "Usar" in the dialog: sets the customer of the cart (or a final consumer) and closes the dialog once the server accepted it. */
  protected chooseCustomer(customer: CustomerSummary | null) {
    if (this.customerSaving()) return;
    this.customerSaving.set(true);
    this.mutate(
      this.api.setCustomer(customer?.id ?? null),
      () => this.customerSaving.set(false),
      () => this.customerOpen.set(false),
    );
  }

  protected changeQuantity(line: PosCheckoutLine, quantity: number) {
    if (quantity === line.quantity) return;
    this.lines.update((lines) =>
      lines.map((l) => (l.id === line.id ? { ...l, quantity, lineTotal: lineTotal(l.unitPrice, quantity).toString() } : l)),
    );
    this.mutate(this.api.updateItem(line.id, quantity));
  }

  protected remove(line: PosCheckoutLine) {
    this.lines.update((lines) => lines.filter((l) => l.id !== line.id));
    this.mutate(this.api.removeItem(line.id));
  }

  protected lineUnit(line: PosCheckoutLine): string {
    return `${money(line.unitPrice)} c/u`;
  }

  protected lineTotalText(line: PosCheckoutLine): string {
    return money(line.lineTotal);
  }

  /**
   * Sends a cart change. While changes are in flight the screen keeps its optimistic lines; once the last one settles it
   * shows the server's cart, which leaves out any change the server refused.
   */
  private mutate(request: Observable<PosCheckoutResponse>, done: () => void = () => undefined, succeeded: () => void = () => undefined) {
    this.inFlight += 1;
    const seq = ++this.requestSeq;
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ checkout }) => {
        if (seq > this.appliedSeq) {
          this.appliedSeq = seq;
          this.serverCheckout.set(checkout);
        }
        this.settle();
        done();
        succeeded();
      },
      error: (err: unknown) => {
        if (!this.handleShiftLost(err)) this.toast.danger(this.errorMessage(err));
        const code = problemOf(err).code;
        this.settle();
        done();
        if (code === 'CHECKOUT_ITEM_NOT_FOUND' || code === 'CHECKOUT_NOT_EDITABLE') this.loadCart();
      },
    });
  }

  private settle() {
    this.inFlight -= 1;
    if (this.inFlight === 0) this.lines.set(this.serverCheckout()?.lines ?? []);
  }

  private adopt(checkout: PosCheckoutView | null) {
    this.serverCheckout.set(checkout);
    if (this.inFlight === 0) this.lines.set(checkout?.lines ?? []);
  }

  private errorMessage(err: unknown): string {
    const problem = problemOf(err);
    if (problem.code === 'INSUFFICIENT_STOCK') {
      const available = (problem.details as { available?: number } | undefined)?.available;
      const warehouse = this.shift()?.warehouse.name;
      if (available !== undefined && warehouse) return `Solo hay ${available} disponibles en ${warehouse}.`;
    }
    return problem.message;
  }

  /** The shift was closed elsewhere: the "Caja cerrada" card takes over. */
  private handleShiftLost(err: unknown): boolean {
    if (problemOf(err).code !== 'CASH_SHIFT_NOT_OPEN') return false;
    this.shift.set(null);
    if (this.canOpenRegister()) this.loadRegisters();
    return true;
  }

  // --- keyboard ---

  /** F2 focuses the search from anywhere in the POS. */
  protected onShortcut(event: KeyboardEvent) {
    if (this.paymentOpen() || this.completedOpen()) return;
    if (event.key === ' ') return this.onSpace(event);
    if (!this.shift()) return;
    if (event.key === 'F9') {
      event.preventDefault();
      this.startPayment();
      return;
    }
    if (event.key === 'F4') {
      event.preventDefault();
      this.openCustomer();
      return;
    }
    if (event.key !== 'F2') return;
    event.preventDefault();
    this.searchBox()?.nativeElement.focus();
  }

  /**
   * Space opens the sheet of the highlighted result (the first one, which Enter would add). It only acts when the focus is not
   * on something that uses Space itself (the search box, a button, a link), so typing and pressing buttons are untouched.
   */
  private onSpace(event: KeyboardEvent) {
    if (!this.shift() || this.sheetOpen() || this.searchState() !== 'ready') return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input, textarea, select, button, a, [contenteditable], [role="dialog"]')) return;
    const first = this.results()[0];
    if (!first) return;
    event.preventDefault();
    this.openSheet(first.id);
  }

  /** Keeps Tab inside the card, and ignores Escape: the card is left only through its buttons. */
  protected onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = Array.from(this.dialog()?.nativeElement.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected leave() {
    void this.router.navigate(['/']);
  }

  protected openRegister() {
    void this.router.navigate(['/sales/cash-register/open']);
  }
}
