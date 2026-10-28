import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, type OnDestroy, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  ADJUSTMENT_NOTE_MAX,
  ADJUSTMENT_REASON_LABELS,
  ADJUSTMENT_REASONS,
  type AdjustmentKind,
  type AdjustmentReason,
  type QuickAdjustmentResponse,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  FilterChipComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  ModalComponent,
  NoteComponent,
  NumericInputDirective,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  ToastService,
} from '@rodasoft/ui';
import type { Subscription } from 'rxjs';
import { problemOf } from '../../../../../core/api-error';
import { ContextStore } from '../../../../../core/context.store';
import { ProductsApi } from '../../products-api.service';
import { formatQuantity } from '../product-sheet.mapper';

/** What the dialog needs to know about the product it adjusts; the product sheet fits. */
export interface AdjustSourceSummary {
  id: string;
  manufacturerCode: string;
  unit: string;
  brand: { name: string };
}

interface KindChip {
  kind: AdjustmentKind;
  label: string;
}

/** Figma IN-17 "Tipo de ajuste", in this order. */
const KIND_CHIPS: readonly KindChip[] = [
  { kind: 'IN', label: 'Entrada' },
  { kind: 'OUT', label: 'Salida' },
  { kind: 'COUNT', label: 'Corrección de conteo' },
];

const REASON_OPTIONS: SelectOption[] = ADJUSTMENT_REASONS.map((value) => ({ value, label: ADJUSTMENT_REASON_LABELS[value] }));

interface WarehouseStock {
  quantity: number;
  minStock: number | null;
}

/**
 * IN-17 · Ajustar stock: one product, one branch, a kind (entrada, salida or corrección de conteo), a quantity and a
 * mandatory reason. The stock of each warehouse is read when the dialog opens, so it can show the resulting stock and send
 * the balance it saw: if somebody moved the stock meanwhile the API answers `STOCK_CHANGED` and the dialog refreshes the
 * numbers instead of adjusting blindly. A branch with several warehouses also asks which one (the design shows branches only).
 */
@Component({
  selector: 'rs-adjust-stock-dialog',
  imports: [
    ButtonComponent,
    FieldComponent,
    FilterChipComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    ModalComponent,
    NoteComponent,
    NumericInputDirective,
    ReactiveFormsModule,
    SelectComponent,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './adjust-stock.dialog.html',
  styleUrl: './adjust-stock.dialog.scss',
})
export class AdjustStockDialog implements OnDestroy {
  private readonly api = inject(ProductsApi);
  private readonly ctx = inject(ContextStore);
  private readonly toast = inject(ToastService);
  private stockRequest: Subscription | null = null;

  readonly open = model(false);
  /** Product being adjusted; the dialog resets whenever it opens. */
  readonly product = input<AdjustSourceSummary | null>(null);
  readonly adjusted = output<QuickAdjustmentResponse>();

  protected readonly kindChips = KIND_CHIPS;
  protected readonly reasonOptions = REASON_OPTIONS;
  protected readonly noteMax = ADJUSTMENT_NOTE_MAX;
  protected readonly form = new FormGroup({
    branchId: new FormControl<string | null>(null, { validators: [Validators.required] }),
    warehouseId: new FormControl<string | null>(null, { validators: [Validators.required] }),
    kind: new FormControl<AdjustmentKind | null>(null, { validators: [Validators.required] }),
    quantity: new FormControl('', { nonNullable: true }),
    reason: new FormControl<AdjustmentReason | null>(null, { validators: [Validators.required] }),
    note: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(ADJUSTMENT_NOTE_MAX)] }),
  });

  /** Warehouse id → quantity and minimum; null while loading or when it could not be read. */
  protected readonly stock = signal<ReadonlyMap<string, WarehouseStock> | null>(null);
  protected readonly stockFailed = signal(false);
  protected readonly stockLoading = signal(false);
  protected readonly saving = signal(false);
  protected readonly quantityError = signal<string | null>(null);
  protected readonly notice = signal<{ type: 'warning' | 'info' | 'danger'; message: string } | null>(null);

  // the form is not a signal source: these mirror the values the template and the result read
  private readonly formValue = signal(this.form.getRawValue());
  protected readonly kind = computed(() => this.formValue().kind);
  protected readonly isOther = computed(() => this.formValue().reason === 'OTHER');
  protected readonly isCount = computed(() => this.formValue().kind === 'COUNT');

  protected readonly branchOptions = computed<SelectOption[]>(() => this.ctx.branches().map((b) => ({ value: b.id, label: b.name })));
  private readonly branch = computed(() => this.ctx.branches().find((b) => b.id === this.formValue().branchId) ?? null);

  /** Only a branch with several warehouses asks which one. */
  protected readonly warehouseOptions = computed<SelectOption[]>(() => {
    const branch = this.branch();
    return branch && branch.warehouses.length > 1 ? branch.warehouses.map((w) => ({ value: w.id, label: w.name })) : [];
  });

  /** Quantity and minimum of the chosen warehouse, or null when unknown. */
  private readonly current = computed<WarehouseStock | null>(() => {
    const id = this.formValue().warehouseId;
    const stock = this.stock();
    return id && stock ? (stock.get(id) ?? { quantity: 0, minStock: null }) : null;
  });
  protected readonly currentStock = computed(() => this.current()?.quantity ?? null);

  /** Stock of the whole branch, for the header ("Stock actual 24 en Huayna Kapac"). */
  private readonly branchStock = computed<number | null>(() => {
    const branch = this.branch();
    const stock = this.stock();
    return branch && stock ? branch.warehouses.reduce((sum, w) => sum + (stock.get(w.id)?.quantity ?? 0), 0) : null;
  });

  protected readonly subtitle = computed(() => {
    const p = this.product();
    if (!p) return '';
    const base = `${p.manufacturerCode} · ${p.brand.name}`;
    const stock = this.branchStock();
    const branch = this.branch();
    return stock !== null && branch ? `${base} · Stock actual ${stock} en ${branch.name}` : base;
  });

  /** The typed quantity, or null while it is empty. */
  private readonly quantityValue = computed(() => {
    const text = this.formValue().quantity.trim();
    return /^\d+$/.test(text) ? Number(text) : null;
  });

  /** Signed pieces the adjustment moves against the stock on hand; null while it cannot be told. */
  private readonly delta = computed<number | null>(() => {
    const quantity = this.quantityValue();
    const kind = this.kind();
    const current = this.currentStock();
    if (quantity === null || !kind) return null;
    if (kind === 'COUNT') return current === null ? null : quantity - current;
    return kind === 'IN' ? quantity : -quantity;
  });

  protected readonly result = computed<{ title: string; detail: string } | null>(() => {
    const current = this.current();
    const delta = this.delta();
    const kind = this.kind();
    if (!current || delta === null || delta === 0 || !kind) return null;
    const next = current.quantity + delta;
    if (next < 0) return null;
    const sign = delta > 0 ? '+' : '−';
    const move =
      kind === 'COUNT'
        ? `${current.quantity} → ${next} (${sign}${Math.abs(delta)}).`
        : `${current.quantity} ${sign} ${Math.abs(delta)}.`;
    const min = current.minStock;
    const versusMin =
      min === null
        ? ''
        : next > min
          ? ` Superior al mínimo de ${min}.`
          : next === min
            ? ` Igual al mínimo de ${min}.`
            : ` Inferior al mínimo de ${min}.`;
    return { title: `Stock resultante: ${formatQuantity(next, this.product()?.unit)}`, detail: `${move}${versusMin} Los ajustes grandes requieren aprobación.` };
  });

  protected readonly canSubmit = computed(() => {
    const v = this.formValue();
    const quantity = this.quantityValue();
    const delta = this.delta();
    const current = this.currentStock();
    const validQuantity = quantity !== null && (v.kind === 'COUNT' || quantity >= 1);
    const wouldGoNegative = delta !== null && current !== null && current + delta < 0;
    return (
      !this.stockLoading() &&
      !!v.branchId &&
      !!v.warehouseId &&
      !!v.kind &&
      !!v.reason &&
      validQuantity &&
      delta !== 0 &&
      !wouldGoNegative &&
      (v.reason !== 'OTHER' || !!v.note.trim())
    );
  });

  protected readonly quantityMessage = computed(() => {
    if (this.quantityError()) return this.quantityError();
    const delta = this.delta();
    const current = this.currentStock();
    if (delta === 0 && this.isCount()) return 'El conteo es igual al stock actual: no hay nada que ajustar.';
    return delta !== null && current !== null && current + delta < 0 ? 'No hay stock suficiente en el almacén para esta salida.' : null;
  });
  protected readonly noteMessage = computed(() =>
    this.isOther() && !this.formValue().note.trim() ? 'Describe el motivo cuando eliges "Otro".' : null,
  );

  constructor() {
    effect(() => {
      if (!this.open()) return;
      // only opening resets the form: a re-emitted product must not wipe what the user is typing
      const p = untracked(() => this.product());
      if (!p) return;
      const branches = untracked(() => this.ctx.branches());
      const start = branches.length === 1 ? branches[0] : untracked(() => this.ctx.currentBranch());
      this.form.reset({
        branchId: start?.id ?? null,
        warehouseId: start && start.warehouses.length === 1 ? start.warehouses[0].id : null,
        kind: null,
        quantity: '',
        reason: null,
        note: '',
      });
      this.saving.set(false);
      this.quantityError.set(null);
      this.notice.set(null);
      this.loadStock(p.id);
    });
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.formValue.set(this.form.getRawValue()));
    // choosing a branch picks its only warehouse; a branch with several asks
    this.form.controls.branchId.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => {
      const branch = this.ctx.branches().find((b) => b.id === id);
      this.form.controls.warehouseId.setValue(branch && branch.warehouses.length === 1 ? branch.warehouses[0].id : null);
    });
    // a changed quantity, kind or warehouse makes the previous "not enough stock" answer stale
    for (const control of [this.form.controls.quantity, this.form.controls.warehouseId, this.form.controls.kind]) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.quantityError.set(null));
    }
  }

  protected setKind(kind: AdjustmentKind, selected: boolean) {
    this.form.controls.kind.setValue(selected ? kind : null);
  }

  protected cancel() {
    if (!this.saving()) this.open.set(false);
  }

  protected submit() {
    const p = this.product();
    this.notice.set(null);
    const quantity = this.quantityValue();
    if (!p || this.saving() || !this.canSubmit() || quantity === null) return;
    const v = this.form.getRawValue();
    const current = this.currentStock();
    this.saving.set(true);
    this.api
      .adjustStock(p.id, {
        warehouseId: v.warehouseId as string,
        kind: v.kind as AdjustmentKind,
        quantity,
        reason: v.reason as AdjustmentReason,
        ...(v.note.trim() ? { note: v.note.trim() } : {}),
        ...(current === null ? {} : { expectedBalance: current }),
      })
      .subscribe({
        next: (result) => {
          this.saving.set(false);
          this.open.set(false);
          this.toast.success(`Ajuste ${result.refNumber} registrado`);
          this.adjusted.emit(result);
        },
        error: (err: unknown) => {
          this.saving.set(false);
          this.showError(p.id, problemOf(err));
        },
      });
  }

  private showError(productId: string, problem: { code: string; message: string }) {
    switch (problem.code) {
      case 'INSUFFICIENT_STOCK':
      case 'NO_STOCK_CHANGE':
        this.quantityError.set(problem.message);
        break;
      case 'STOCK_CHANGED':
        this.loadStock(productId);
        this.notice.set({ type: 'warning', message: problem.message });
        break;
      case 'ADJUSTMENT_NEEDS_APPROVAL':
        this.notice.set({ type: 'info', message: problem.message });
        break;
      case 'WAREHOUSE_NOT_FOUND':
        this.notice.set({ type: 'danger', message: 'El almacén ya no está disponible. Cierra e inténtalo de nuevo.' });
        break;
      default:
        this.notice.set({ type: 'danger', message: problem.message });
    }
  }

  protected retryStock() {
    const p = this.product();
    if (p) this.loadStock(p.id);
  }

  /** Reads the stock of every warehouse; a newer read cancels the previous one, so a slow answer cannot overwrite it. */
  private loadStock(productId: string) {
    this.stockRequest?.unsubscribe();
    this.stock.set(null);
    this.stockFailed.set(false);
    this.stockLoading.set(true);
    this.stockRequest = this.api.stockByWarehouse(productId).subscribe({
      next: (res) => {
        this.stock.set(new Map(res.items.map((i) => [i.warehouse.id, { quantity: i.quantity, minStock: i.minStock }])));
        this.stockLoading.set(false);
      },
      error: () => {
        this.stockFailed.set(true);
        this.stockLoading.set(false);
      },
    });
  }

  ngOnDestroy() {
    this.stockRequest?.unsubscribe();
  }
}
