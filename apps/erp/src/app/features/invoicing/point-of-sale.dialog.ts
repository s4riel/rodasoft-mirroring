import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent, SelectComponent, type SelectOption, ToastService } from '@rodasoft/ui';
import { problemOf } from '../../core/api-error';
import { ContextStore } from '../../core/context.store';
import { WarehousesApi } from '../inventory/warehouses/warehouses-api.service';
import { InvoicingApi } from './invoicing-api.service';

/**
 * FS-33 · New point of sale (HU-FAC-24): branch, name, SIN type and the warehouse its cash register sells from. It is registered in the
 * SIAT first; when the SIAT does not answer nothing is saved and the dialog says so.
 */
@Component({
  selector: 'rs-point-of-sale-dialog',
  imports: [ButtonComponent, FieldComponent, InputDirective, ModalComponent, NoteComponent, SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './point-of-sale.dialog.html',
  styleUrl: './point-of-sale.dialog.scss',
})
export class PointOfSaleDialog {
  private readonly api = inject(InvoicingApi);
  private readonly warehousesApi = inject(WarehousesApi);
  private readonly context = inject(ContextStore);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly open = model(false);
  readonly types = input<readonly { code: number; description: string }[]>([]);
  readonly created = output<void>();

  protected readonly branchId = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly typeCode = signal<number | null>(null);
  protected readonly warehouseId = signal<string | null>(null);
  protected readonly warehouses = signal<SelectOption[]>([]);
  protected readonly touched = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly branchOptions = computed<SelectOption[]>(() => this.context.branches().map((b) => ({ value: b.id, label: b.name })));
  protected readonly typeOptions = computed<SelectOption[]>(() => this.types().map((t) => ({ value: t.code, label: t.description })));
  protected readonly nameError = computed(() => (this.touched() && this.name().trim() === '' ? 'Escribe el nombre del punto de venta.' : null));
  protected readonly branchError = computed(() => (this.touched() && !this.branchId() ? 'Elige la sucursal.' : null));
  protected readonly typeError = computed(() => (this.touched() && this.typeCode() === null ? 'Elige el tipo de punto de venta.' : null));
  protected readonly warehouseError = computed(() => (this.touched() && !this.warehouseId() ? 'Elige el almacén de la caja.' : null));

  constructor() {
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.branchId.set(this.context.branches().length === 1 ? this.context.branches()[0].id : null);
        this.name.set('');
        this.typeCode.set(null);
        this.warehouseId.set(null);
        this.warehouses.set([]);
        this.touched.set(false);
        this.saving.set(false);
        this.error.set(null);
        if (this.branchId()) this.loadWarehouses(this.branchId() as string);
      });
    });
  }

  protected setBranch(value: unknown) {
    this.branchId.set(value ? String(value) : null);
    this.warehouseId.set(null);
    this.warehouses.set([]);
    if (this.branchId()) this.loadWarehouses(this.branchId() as string);
  }

  private loadWarehouses(branchId: string) {
    this.warehousesApi
      .list({ branchId, status: 'ACTIVE', pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.warehouses.set(response.items.map((w) => ({ value: w.id, label: w.name })));
          if (response.items.length === 1) this.warehouseId.set(response.items[0].id);
        },
        error: (err) => this.error.set(problemOf(err).message),
      });
  }

  protected save() {
    this.touched.set(true);
    const branchId = this.branchId();
    const typeCode = this.typeCode();
    const warehouseId = this.warehouseId();
    if (this.saving() || !branchId || typeCode === null || !warehouseId || this.name().trim() === '') return;
    this.saving.set(true);
    this.error.set(null);
    this.api
      .createPointOfSale({ branchId, name: this.name().trim(), typeCode, warehouseId })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Punto de venta registrado en el SIAT');
          this.open.set(false);
          this.created.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.error.set(problemOf(err).message);
        },
      });
  }
}
