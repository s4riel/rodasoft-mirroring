import { Location } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import type { TransferDetail, TransferProductSearchItem, TransferSaveInput, TransferWarehouseOption } from '@rodasoft/domain';
import {
  ButtonComponent,
  CanDirective,
  DocTableCellDirective,
  DocTableColumn,
  DocTableComponent,
  DocTableRow,
  EmptyStateIllustratedComponent,
  FieldComponent,
  FilterChipComponent,
  IconButtonComponent,
  IconComponent,
  InputDirective,
  ModalComponent,
  NoteComponent,
  NumericInputDirective,
  PageHeaderComponent,
  PaginationComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  TextareaDirective,
  ToastOutletComponent,
  ToastService,
  TooltipDirective,
} from '@rodasoft/ui';
import { catchError, finalize, map, Observable, of, switchMap, throwError } from 'rxjs';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { formatMoney } from '../products/sheet/product-sheet.mapper';
import {
  addProduct,
  EditorLine,
  errorOf,
  fromDetail,
  LINE_ERROR_LABELS,
  LINE_FILTERS,
  LineFilter,
  pageCountOf,
  pageOf,
  removeLine,
  sameLines,
  setQuantity,
  summarize,
  toSaveLines,
  visibleLines,
} from './transfer-lines';
import { TransferListAddition, TransferListDialog, TransferListMode } from './transfer-list.dialog';
import { TransfersApi } from './transfers-api.service';
import { transferErrorMessage } from './transfers.mapper';
import type { ConfirmsLeave } from './unsaved-transfer.guard';

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

const COLUMNS: DocTableColumn[] = [
  { key: 'code', label: 'Código', type: 'code' },
  { key: 'product', label: 'Producto', type: 'text' },
  { key: 'available', label: 'Stock en origen', type: 'number' },
  { key: 'quantity', label: 'Cantidad', type: 'custom', align: 'end' },
  { key: 'status', label: 'Estado', type: 'status' },
  { key: 'actions', label: 'Acciones', type: 'custom', align: 'end' },
];

const SEARCH_DELAY_MS = 250;

/**
 * IN-06 · Creates or edits a transfer draft: origin and destination, four ways to add products (search, paste, Excel,
 * restock below minimum, the last one for HU-INV-27), and a paginated list of lines whose edits survive page changes.
 * Sending is blocked while any line has an error (decision #35); over the company's limit the button asks for approval.
 */
@Component({
  selector: 'rs-transfer-editor-page',
  imports: [
    ButtonComponent,
    CanDirective,
    DocTableCellDirective,
    DocTableComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    FilterChipComponent,
    IconButtonComponent,
    IconComponent,
    InputDirective,
    ModalComponent,
    NoteComponent,
    NumericInputDirective,
    PageHeaderComponent,
    PaginationComponent,
    SelectComponent,
    SkeletonComponent,
    TextareaDirective,
    ToastOutletComponent,
    TooltipDirective,
    TransferListDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transfer-editor.page.html',
  styleUrl: './transfer-editor.page.scss',
})
export class TransferEditorPage implements ConfirmsLeave {
  private readonly api = inject(TransfersApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');

  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');

  protected readonly columns = COLUMNS;
  protected readonly filters = LINE_FILTERS;
  protected readonly skeletonRows = Array.from({ length: 3 }, (_, i) => i);
  protected readonly canCreate = computed(() => this.ctx.can('inventory.transfers.create'));

  protected readonly state = signal<LoadState>(this.id ? 'loading' : 'ready');
  protected readonly errorMessage = signal('');
  private readonly warehouses = signal<readonly TransferWarehouseOption[]>([]);
  /** The last version the server returned; `null` until the first save. */
  protected readonly saved = signal<TransferDetail | null>(null);

  // the form state; the lines live in one list so edits survive page changes
  protected readonly originId = signal<string | null>(null);
  protected readonly destinationId = signal<string | null>(null);
  protected readonly note = signal('');
  protected readonly lines = signal<readonly EditorLine[]>([]);

  protected readonly filter = signal<LineFilter>('all');
  protected readonly lineSearch = signal('');
  private readonly requestedPage = signal(1);

  protected readonly searchText = signal('');
  protected readonly results = signal<readonly TransferProductSearchItem[]>([]);
  protected readonly searchBusy = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private searchSeq = 0;

  protected readonly busy = signal<'save' | 'send' | 'cancel' | null>(null);
  protected readonly submitError = signal<string | null>(null);

  protected readonly listMode = signal<TransferListMode>('paste');
  protected readonly listOpen = signal(false);
  protected readonly cancelOpen = signal(false);
  protected readonly leaveOpen = signal(false);
  private leaveDecision: ((leave: boolean) => void) | null = null;

  protected readonly title = computed(() => this.saved()?.number ?? 'Nueva transferencia');
  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Transferencias', link: '/inventory/transfers' },
    { label: this.title() },
  ]);

  protected readonly originOptions = computed<SelectOption[]>(() =>
    this.warehouses()
      .filter((w) => w.canSendFrom)
      .map((w) => ({ value: w.id, label: `${w.branch.name} · ${w.name}` })),
  );
  protected readonly destinationOptions = computed<SelectOption[]>(() =>
    this.warehouses()
      .filter((w) => w.id !== this.originId())
      .map((w) => ({ value: w.id, label: `${w.branch.name} · ${w.name}` })),
  );
  /** The origin fixes the stock every line was checked against, so it is locked while there are lines. */
  protected readonly originLocked = computed(() => this.lines().length > 0);
  protected readonly canAdd = computed(() => this.originId() !== null && this.busy() === null);

  protected readonly summary = computed(() => summarize(this.lines()));
  protected readonly valueLabel = computed(() => formatMoney(this.summary().value));
  protected readonly showValue = computed(() => this.summary().value !== null);

  private readonly shown = computed(() => visibleLines(this.lines(), this.filter(), this.lineSearch()));
  protected readonly pageCount = computed(() => pageCountOf(this.shown().length));
  protected readonly page = computed(() => Math.min(this.requestedPage(), this.pageCount()));
  private readonly pageLines = computed(() => pageOf(this.shown(), this.page()));
  protected readonly rows = computed<DocTableRow[]>(() =>
    this.pageLines().map((l) => {
      const error = errorOf(l);
      return {
        id: l.productId,
        label: l.manufacturerCode,
        cells: {
          code: l.manufacturerCode,
          product: `${l.name} · ${l.brand}`,
          available: l.available,
          status: error ? { label: LINE_ERROR_LABELS[error], status: 'danger' as const, icon: 'alert' as const } : null,
        },
      };
    }),
  );
  protected readonly noMatches = computed(() => this.lines().length > 0 && this.shown().length === 0);

  /** The draft has changes the server does not have: the header, the note or any line. */
  protected readonly dirty = computed(() => {
    const saved = this.saved();
    if (!saved) return this.lines().length > 0 || this.note().trim() !== '' || this.destinationId() !== null;
    return (
      saved.origin.id !== this.originId() ||
      saved.destination.id !== this.destinationId() ||
      (saved.note ?? '') !== this.note().trim() ||
      !sameLines(fromDetail(saved), this.lines())
    );
  });

  protected readonly needsApproval = computed(() => this.saved()?.needsApproval === true);
  protected readonly sendLabel = computed(() => (this.needsApproval() ? 'Enviar para aprobación' : 'Enviar'));
  protected readonly canSave = computed(() => this.originId() !== null && this.destinationId() !== null && this.busy() === null && this.dirty());
  protected readonly canSend = computed(
    () => this.originId() !== null && this.destinationId() !== null && this.lines().length > 0 && this.summary().errors === 0 && this.busy() === null,
  );

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.searchTimer));
    if (!this.canCreate()) {
      this.state.set('forbidden');
      return;
    }
    this.api
      .warehouses()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (r) => {
          this.warehouses.set(r.items);
          // a single warehouse to send from needs no choice
          const origins = r.items.filter((w) => w.canSendFrom);
          if (!this.id && origins.length === 1) this.originId.set(origins[0].id);
        },
        error: (err: unknown) => this.fail(err),
      });
    if (this.id) this.load(this.id);
  }

  /** A browser close or reload with unsaved changes asks too. */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent) {
    if (this.dirty()) event.preventDefault();
  }

  /** Used by the route guard: resolves to whether the user may leave. */
  confirmLeave(): boolean | Promise<boolean> {
    if (!this.dirty()) return true;
    this.leaveOpen.set(true);
    return new Promise<boolean>((resolve) => (this.leaveDecision = resolve));
  }

  protected decideLeave(leave: boolean) {
    this.leaveOpen.set(false);
    this.leaveDecision?.(leave);
    this.leaveDecision = null;
  }

  protected retry() {
    if (this.id) this.load(this.id);
  }

  private load(id: string) {
    this.state.set('loading');
    this.api
      .get(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          if (detail.status !== 'DRAFT') {
            void this.router.navigate(['/inventory/transfers', id], { replaceUrl: true });
            return;
          }
          this.apply(detail);
          this.state.set('ready');
        },
        error: (err: unknown) => this.fail(err),
      });
  }

  private fail(err: unknown) {
    const problem = problemOf(err);
    this.errorMessage.set(transferErrorMessage(problem));
    this.state.set(problem.status === 403 ? 'forbidden' : 'error');
  }

  /** Takes a version from the server as the new baseline of the editor. */
  private apply(detail: TransferDetail) {
    this.saved.set(detail);
    this.originId.set(detail.origin.id);
    this.destinationId.set(detail.destination.id);
    this.note.set(detail.note ?? '');
    this.lines.set(fromDetail(detail));
  }

  private messageOf(err: unknown): string {
    return transferErrorMessage(problemOf(err));
  }

  // ── Header ─────────────────────────────────────────────────────────────────

  protected setOrigin(value: unknown) {
    const id = value ? String(value) : null;
    this.originId.set(id);
    if (id !== null && id === this.destinationId()) this.destinationId.set(null);
    this.results.set([]);
  }

  protected setDestination(value: unknown) {
    this.destinationId.set(value ? String(value) : null);
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
      this.results.set([]);
      return;
    }
    this.searchTimer = setTimeout(() => this.runSearch().subscribe(), SEARCH_DELAY_MS);
  }

  private runSearch(): Observable<readonly TransferProductSearchItem[]> {
    const origin = this.originId();
    const text = this.searchText().trim();
    if (!origin || !text) return of([]);
    this.searchBusy.set(true);
    // only the latest search may fill the list: a slower, older answer would show results for text no longer in the box
    const seq = ++this.searchSeq;
    return this.api.productSearch(origin, text).pipe(
      map((r) => {
        if (seq === this.searchSeq) this.results.set(r.items);
        return r.items;
      }),
      finalize(() => this.searchBusy.set(false)),
      takeUntilDestroyed(this.destroyRef),
    );
  }

  /** Enter adds the first result: the search is run right away, without waiting for the typing pause. */
  protected onSearchEnter(event: Event) {
    event.preventDefault();
    clearTimeout(this.searchTimer);
    if (!this.canAdd() || !this.searchText().trim()) return;
    this.runSearch().subscribe({
      next: (items) => {
        if (items[0]) this.addFromSearch(items[0]);
        else this.submitError.set('No encontramos productos con ese código.');
      },
      error: (err: unknown) => this.submitError.set(this.messageOf(err)),
    });
  }

  protected addFromSearch(item: TransferProductSearchItem) {
    this.submitError.set(null);
    this.lines.update((lines) => addProduct(lines, item));
    this.requestedPage.set(1);
    this.searchText.set('');
    this.results.set([]);
  }

  protected closeResults() {
    this.results.set([]);
  }

  protected focusSearch() {
    this.searchBox()?.nativeElement.focus();
  }

  protected openList(mode: TransferListMode) {
    this.listMode.set(mode);
    this.listOpen.set(true);
  }

  protected addFromList(additions: TransferListAddition[]) {
    this.submitError.set(null);
    this.lines.update((lines) => additions.reduce((acc, a) => addProduct(acc, a.product, a.quantity), lines));
    this.requestedPage.set(1);
  }

  // ── Lines ──────────────────────────────────────────────────────────────────

  protected quantityOf(productId: string): number {
    return this.lines().find((l) => l.productId === productId)?.quantity ?? 0;
  }

  protected onQuantity(productId: string, event: Event) {
    const raw = (event.target as HTMLInputElement).value.trim();
    // an empty box is 0, which the line flags as not valid until the user types a number
    this.lines.update((lines) => setQuantity(lines, productId, raw === '' ? 0 : Number(raw)));
  }

  protected remove(productId: string) {
    this.lines.update((lines) => removeLine(lines, productId));
  }

  protected setFilter(filter: LineFilter) {
    this.filter.set(filter);
    this.requestedPage.set(1);
  }

  protected onLineSearch(event: Event) {
    this.lineSearch.set((event.target as HTMLInputElement).value);
    this.requestedPage.set(1);
  }

  protected goToPage(page: number) {
    this.requestedPage.set(page);
  }

  // ── Save, send, cancel ─────────────────────────────────────────────────────

  private body(): TransferSaveInput {
    return {
      originWarehouseId: this.originId() as string,
      destinationWarehouseId: this.destinationId() as string,
      note: this.note().trim() || null,
      lines: toSaveLines(this.lines()),
    };
  }

  /** Creates the draft the first time and replaces it afterwards, with the version the editor read. */
  private persist(): Observable<TransferDetail> {
    const saved = this.saved();
    return saved ? this.api.update(saved.id, { ...this.body(), expectedUpdatedAt: saved.updatedAt }) : this.api.create(this.body());
  }

  protected saveDraft() {
    if (!this.canSave()) return;
    this.busy.set('save');
    this.submitError.set(null);
    this.persist()
      .pipe(
        finalize(() => this.busy.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (detail) => {
          const created = this.saved() === null;
          this.apply(detail);
          this.toast.success('Borrador guardado');
          // the draft now has an address: the URL changes so a reload opens it, without rebuilding the editor
          if (created) this.location.replaceState(`/inventory/transfers/${detail.id}/edit`);
        },
        error: (err: unknown) => this.submitError.set(this.messageOf(err)),
      });
  }

  protected send() {
    if (!this.canSend()) return;
    this.busy.set('send');
    this.submitError.set(null);
    const needsSave = this.dirty() || this.saved() === null;
    (needsSave ? this.persist() : of(this.saved() as TransferDetail))
      .pipe(
        switchMap((detail) => {
          this.apply(detail);
          return this.api.send(detail.id, detail.updatedAt).pipe(
            catchError((err: unknown) => {
              // only a refused send reloads the draft: it is saved by now, and the stock may have changed, so the server's
              // version marks the lines that no longer fit. A failed save keeps what the user typed instead.
              this.api.get(detail.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({ next: (d) => this.apply(d) });
              return throwError(() => err);
            }),
          );
        }),
        finalize(() => this.busy.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (sent) => {
          this.apply(sent);
          this.toast.success(sent.status === 'PENDING_APPROVAL' ? `${sent.number} enviada para aprobación` : `${sent.number} enviada: el stock salió del origen`);
          void this.router.navigate(['/inventory/transfers']);
        },
        error: (err: unknown) => this.submitError.set(this.messageOf(err)),
      });
  }

  protected confirmCancel() {
    const saved = this.saved();
    if (!saved) return;
    this.busy.set('cancel');
    this.api
      .cancel(saved.id)
      .pipe(
        finalize(() => this.busy.set(null)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (done) => {
          // the editor matches the server: leaving does not ask
          this.apply(done);
          this.cancelOpen.set(false);
          this.toast.success(`${done.number} cancelada`);
          void this.router.navigate(['/inventory/transfers']);
        },
        error: (err: unknown) => {
          this.cancelOpen.set(false);
          this.submitError.set(this.messageOf(err));
        },
      });
  }
}
