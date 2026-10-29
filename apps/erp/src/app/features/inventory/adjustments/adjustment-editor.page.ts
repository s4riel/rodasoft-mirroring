import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import type { AdjustmentKind, AdjustmentProductSearchItem, AdjustmentReason, WarehouseListItem } from '@rodasoft/domain';
import {
  ALL_BRANCHES,
  ButtonComponent,
  CanDirective,
  CheckboxComponent,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  EmptyStateIllustratedComponent,
  FieldComponent,
  IconButtonComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  ModalComponent,
  NoteComponent,
  NumericInputDirective,
  PageHeaderComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  TextareaDirective,
  ToastOutletComponent,
  ToastService,
  TooltipDirective,
} from '@rodasoft/ui';
import { catchError, map, Observable, of } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { formatMoney } from '../products/sheet/product-sheet.mapper';
import { WarehousesApi } from '../warehouses/warehouses-api.service';
import { AdjustmentListDialog, AdjustmentListMode } from './adjustment-list.dialog';
import { AdjustmentAddition, AdjustmentLine, LINE_KINDS, lineDelta, lineError, lineValue, newLine, resultingStock, summarize } from './adjustment-lines';
import type { ConfirmsLeave } from '../transfers/unsaved-transfer.guard';
import { AdjustmentsApi } from './adjustments-api.service';
import { adjustmentErrorMessage, REASON_OPTIONS } from './adjustments.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const SEARCH_DELAY_MS = 250;

/** The columns of the lines table of IN-08. The value column is added for those who may see costs. */
const BASE_COLUMNS: DocTableColumn[] = [
  { key: 'product', label: 'Producto', type: 'custom' },
  { key: 'kind', label: 'Tipo', type: 'custom', width: '10rem' },
  { key: 'quantity', label: 'Cantidad', type: 'custom', align: 'end', width: '10rem' },
  { key: 'available', label: 'Stock actual', type: 'number', width: '8rem' },
  { key: 'result', label: 'Stock resultante', type: 'number', width: '9rem' },
];
const VALUE_COLUMN: DocTableColumn = { key: 'value', label: 'Valor', type: 'number', width: '8rem' };
const ACTIONS_COLUMN: DocTableColumn = { key: 'actions', label: '', type: 'custom', align: 'end', width: '3.5rem' };

/** IN-08 · New stock adjustment: a reason, the products with what to do to each, and confirm. It applies at once. */
@Component({
  selector: 'rs-adjustment-editor-page',
  imports: [
    AdjustmentListDialog,
    ButtonComponent,
    CanDirective,
    CheckboxComponent,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    IconButtonComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    ModalComponent,
    NoteComponent,
    NumericInputDirective,
    PageHeaderComponent,
    SelectComponent,
    SkeletonComponent,
    TextareaDirective,
    ToastOutletComponent,
    TooltipDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './adjustment-editor.page.html',
  styleUrl: './adjustment-editor.page.scss',
})
export class AdjustmentEditorPage implements ConfirmsLeave {
  private readonly api = inject(AdjustmentsApi);
  private readonly warehousesApi = inject(WarehousesApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Ajustes', link: '/inventory/adjustments' },
    { label: 'Nuevo ajuste' },
  ];
  protected readonly reasonOptions = REASON_OPTIONS;
  protected readonly kindOptions: SelectOption[] = LINE_KINDS.map((k) => ({ value: k.value, label: k.label }));
  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);

  protected readonly canCreate = computed(() => this.ctx.can('inventory.adjustments.create'));
  protected readonly showValue = computed(() => this.ctx.can('inventory.costs.view'));

  protected readonly state = signal<LoadState>('loading');
  protected readonly errorMessage = signal('');
  private readonly warehouses = signal<readonly WarehouseListItem[]>([]);

  protected readonly warehouseId = signal<string | null>(null);
  protected readonly reason = signal<AdjustmentReason | null>(null);
  protected readonly note = signal('');
  protected readonly lines = signal<readonly AdjustmentLine[]>([]);

  protected readonly searchText = signal('');
  protected readonly results = signal<readonly AdjustmentProductSearchItem[]>([]);
  /** The results ticked so far, by product; they are added together. */
  private readonly picked = signal<ReadonlyMap<string, AdjustmentProductSearchItem>>(new Map());
  protected readonly pickedCount = computed(() => this.picked().size);
  protected readonly allPicked = computed(() => this.results().length > 0 && this.results().every((r) => this.picked().has(r.id)));
  protected readonly searchBusy = signal(false);
  protected readonly listOpen = signal(false);
  protected readonly listMode = signal<AdjustmentListMode>('paste');
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private searchSeq = 0;

  protected readonly busy = signal(false);
  protected readonly confirmOpen = signal(false);
  /** Set by the first "Confirmar ajuste": the field errors only show once the user tried. */
  protected readonly attempted = signal(false);
  protected readonly submitError = signal<string | null>(null);
  protected readonly leaveOpen = signal(false);
  private leaveDecision: ((leave: boolean) => void) | null = null;
  /** Set once the adjustment is applied, so leaving for the list does not ask about the form that was just sent. */
  private applied = false;

  /** Warehouses follow the branch chosen in the header (all of them when the header shows every branch). */
  protected readonly warehouseOptions = computed<SelectOption[]>(() => {
    const branchId = this.ctx.branchId();
    const selected = this.warehouseId();
    return this.warehouses()
      .filter((w) => branchId === ALL_BRANCHES || w.branch.id === branchId || w.id === selected)
      .map((w) => ({ value: w.id, label: `${w.branch.name} · ${w.name}` }));
  });
  /** The stock of every line was read in this warehouse, so it is fixed once there are lines. */
  protected readonly warehouseLocked = computed(() => this.lines().length > 0);
  protected readonly canAdd = computed(() => this.warehouseId() !== null && !this.busy());

  protected readonly summary = computed(() => summarize(this.lines()));

  protected readonly columns = computed<DocTableColumn[]>(() => [...BASE_COLUMNS, ...(this.showValue() ? [VALUE_COLUMN] : []), ACTIONS_COLUMN]);
  protected readonly rows = computed<DocTableRow[]>(() =>
    this.lines().map((l) => ({
      id: l.productId,
      label: l.manufacturerCode,
      cells: {
        product: l.manufacturerCode,
        kind: l.kind,
        quantity: l.quantity ?? '',
        available: l.available,
        result: resultingStock(l) ?? '–',
        value: lineValue(l) === null ? '–' : formatMoney(lineValue(l)),
        actions: '',
      },
    })),
  );

  /** Field errors, shown after the first attempt to confirm. */
  protected readonly reasonError = computed(() => (this.attempted() && !this.reason() ? 'Elige el motivo del ajuste.' : null));
  protected readonly noteError = computed(() =>
    this.attempted() && this.reason() === 'OTHER' && !this.note().trim() ? 'Describe el motivo cuando eliges "Otro".' : null,
  );
  protected readonly linesProblem = computed(() => {
    if (!this.attempted()) return null;
    if (this.lines().length === 0) return 'Agrega al menos un producto al ajuste.';
    if (this.summary().errors > 0) return 'Corrige los productos con error para poder confirmar.';
    if (!this.summary().changesStock) return 'Ninguna línea cambia el stock: los conteos son iguales al stock actual.';
    return null;
  });

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));
    if (!this.canCreate()) {
      this.state.set('forbidden');
      return;
    }
    this.loadWarehouses();

    // the warehouse starts as the main one of the branch in the header, once the list is there
    effect(() => {
      const options = this.warehouses();
      const branchId = this.ctx.branchId();
      untracked(() => {
        if (this.warehouseId() !== null || options.length === 0) return;
        const inBranch = options.filter((w) => branchId === ALL_BRANCHES || w.branch.id === branchId);
        const pick = inBranch.find((w) => w.isMain) ?? inBranch[0] ?? options[0];
        this.warehouseId.set(pick.id);
      });
    });
  }

  protected retry() {
    this.state.set('loading');
    this.loadWarehouses();
  }

  private loadWarehouses() {
    this.warehousesApi
      .list({ status: 'ACTIVE', pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.warehouses.set(r.items);
          this.state.set('ready');
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.errorMessage.set(problem.message);
          this.state.set(problem.status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  // ── Header ─────────────────────────────────────────────────────────────────

  protected setWarehouse(value: unknown) {
    this.warehouseId.set(value ? String(value) : null);
    this.closeResults();
  }

  protected setReason(value: unknown) {
    this.reason.set(value ? (String(value) as AdjustmentReason) : null);
  }

  protected onNote(event: Event) {
    this.note.set((event.target as HTMLTextAreaElement).value);
  }

  // ── Adding products ────────────────────────────────────────────────────────

  protected onSearchInput(event: Event) {
    const text = (event.target as HTMLInputElement).value;
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    if (!text.trim() || !this.canAdd()) {
      // a search still in flight is for text that is gone: its answer must not fill the list
      this.searchSeq += 1;
      this.closeResults();
      return;
    }
    this.searchTimer = setTimeout(() => this.runSearch().subscribe(), SEARCH_DELAY_MS);
  }

  private runSearch(): Observable<readonly AdjustmentProductSearchItem[]> {
    const warehouse = this.warehouseId();
    const text = this.searchText().trim();
    if (!warehouse || !text) return of([]);
    this.searchBusy.set(true);
    // only the latest search may fill the list: a slower, older answer would show results for text no longer in the box
    const seq = ++this.searchSeq;
    return this.api.productSearch(warehouse, text).pipe(
      map((r) => {
        if (seq === this.searchSeq) this.results.set(r.items);
        return r.items;
      }),
      catchError((err: unknown) => {
        this.submitError.set(adjustmentErrorMessage(problemOf(err)));
        return of([]);
      }),
      map((items) => {
        if (seq === this.searchSeq) this.searchBusy.set(false);
        return items;
      }),
    );
  }

  protected onSearchEnter(event: Event) {
    event.preventDefault();
    clearTimeout(this.searchTimer);
    if (!this.canAdd() || !this.searchText().trim()) return;
    this.runSearch().subscribe((items) => {
      if (items[0]) this.add(items[0]);
      else this.submitError.set('No encontramos productos con ese código.');
    });
  }

  protected add(product: AdjustmentProductSearchItem) {
    this.submitError.set(null);
    if (this.lines().some((l) => l.productId === product.id)) {
      this.submitError.set(`${product.manufacturerCode} ya está en el ajuste.`);
    } else {
      this.lines.update((lines) => [...lines, newLine(product)]);
    }
    this.searchText.set('');
    this.closeResults();
  }

  /** Closes the list and forgets what was ticked in it. */
  protected closeResults() {
    this.results.set([]);
    this.picked.set(new Map());
    this.searchBusy.set(false);
  }

  protected isPicked(id: string): boolean {
    return this.picked().has(id);
  }

  protected togglePicked(item: AdjustmentProductSearchItem) {
    this.picked.update((current) => {
      const next = new Map(current);
      if (!next.delete(item.id)) next.set(item.id, item);
      return next;
    });
  }

  /** Ticks every result, or clears the ticks when every result is already ticked. */
  protected togglePickedAll() {
    const everyOne = this.allPicked();
    this.picked.update((current) => {
      const next = new Map(current);
      for (const item of this.results()) {
        if (everyOne) next.delete(item.id);
        else next.set(item.id, item);
      }
      return next;
    });
  }

  /** Adds every ticked product as a new line; the ones already in the adjustment are left as they are and reported. */
  protected addPicked() {
    const items = [...this.picked().values()];
    if (!items.length) return;
    const known = new Set(this.lines().map((l) => l.productId));
    const fresh = items.filter((i) => !known.has(i.id));
    const repeated = items.filter((i) => known.has(i.id));
    this.lines.update((lines) => [...lines, ...fresh.map((item) => newLine(item))]);
    this.submitError.set(
      repeated.length ? `${repeated.map((i) => i.manufacturerCode).join(', ')} ya ${repeated.length === 1 ? 'está' : 'están'} en el ajuste.` : null,
    );
    this.searchText.set('');
    this.closeResults();
  }

  protected openList(mode: AdjustmentListMode) {
    this.listMode.set(mode);
    this.listOpen.set(true);
  }

  /** Adds the lines of a read list with the kind and quantity they came with; a product already in the adjustment keeps its line. */
  protected addFromList(additions: AdjustmentAddition[]) {
    const known = new Set(this.lines().map((l) => l.productId));
    const fresh = additions.filter((a) => !known.has(a.product.id));
    const repeated = additions.filter((a) => known.has(a.product.id));
    this.lines.update((lines) => [...lines, ...fresh.map((a) => newLine(a.product, a.kind, a.quantity))]);
    this.submitError.set(
      repeated.length ? `${repeated.map((a) => a.product.manufacturerCode).join(', ')} ya ${repeated.length === 1 ? 'está' : 'están'} en el ajuste.` : null,
    );
  }

  // ── Lines ──────────────────────────────────────────────────────────────────

  protected nameOf(id: string): string {
    const line = this.lineOf(id);
    return line ? `${line.name} · ${line.brand}` : '';
  }

  protected kindOf(id: string): AdjustmentKind {
    return this.lineOf(id)?.kind ?? 'OUT';
  }

  protected quantityOf(id: string): string {
    const quantity = this.lineOf(id)?.quantity;
    return quantity === null || quantity === undefined ? '' : String(quantity);
  }

  protected errorOf(id: string): string | null {
    const line = this.lineOf(id);
    // an empty box is only an error once the user tried to confirm
    return line && (line.quantity !== null || this.attempted()) ? lineError(line) : null;
  }

  protected deltaOf(id: string): number | null {
    const line = this.lineOf(id);
    return line ? lineDelta(line) : null;
  }

  protected setKind(id: string, value: unknown) {
    this.patch(id, { kind: String(value) as AdjustmentKind });
  }

  protected onQuantity(id: string, event: Event) {
    const raw = (event.target as HTMLInputElement).value.trim();
    this.patch(id, { quantity: raw === '' ? null : Number(raw) });
  }

  protected remove(id: string) {
    this.lines.update((lines) => lines.filter((l) => l.productId !== id));
  }

  private lineOf(id: string): AdjustmentLine | undefined {
    return this.lines().find((l) => l.productId === id);
  }

  private patch(id: string, change: Partial<AdjustmentLine>) {
    this.lines.update((lines) => lines.map((l) => (l.productId === id ? { ...l, ...change } : l)));
  }

  // ── Confirm ────────────────────────────────────────────────────────────────

  /** "Confirmar ajuste": checks the form, then asks once more, because the stock changes at once. */
  protected confirm() {
    this.attempted.set(true);
    this.submitError.set(null);
    if (this.reasonError() || this.noteError() || this.linesProblem()) return;
    this.confirmOpen.set(true);
  }

  protected apply() {
    const warehouseId = this.warehouseId();
    if (!warehouseId || this.busy()) return;
    this.busy.set(true);
    this.api
      .create({
        warehouseId,
        reason: this.reason(),
        note: this.note().trim() || undefined,
        lines: this.lines().map((l) => ({ productId: l.productId, kind: l.kind, quantity: l.quantity ?? 0, expectedBalance: l.available })),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (done) => {
          this.applied = true;
          this.toast.success(`${done.number} aplicado: el stock ya cambió`);
          void this.router.navigate(['/inventory/adjustments']);
        },
        error: (err: unknown) => {
          this.busy.set(false);
          this.confirmOpen.set(false);
          const problem = problemOf(err);
          this.refreshStale(problem);
          this.submitError.set(adjustmentErrorMessage(problem));
        },
      });
  }

  /** A line read against stale stock takes the balance the server found, so the next confirm sends the current one. */
  private refreshStale(problem: { code: string; details?: unknown }) {
    if (problem.code !== 'STOCK_CHANGED') return;
    const { productId, currentBalance } = (problem.details ?? {}) as { productId?: string; currentBalance?: number };
    if (typeof productId === 'string' && typeof currentBalance === 'number') this.patch(productId, { available: currentBalance });
  }

  /** Asked by the route guard: leaving with a reason, a note or lines typed in would lose them. */
  confirmLeave(): boolean | Promise<boolean> {
    if (this.applied || (this.lines().length === 0 && !this.reason() && !this.note().trim())) return true;
    this.leaveOpen.set(true);
    return new Promise<boolean>((resolve) => (this.leaveDecision = resolve));
  }

  protected decideLeave(leave: boolean) {
    this.leaveOpen.set(false);
    this.leaveDecision?.(leave);
    this.leaveDecision = null;
  }

  protected leave() {
    void this.router.navigate(['/inventory/adjustments']);
  }
}
