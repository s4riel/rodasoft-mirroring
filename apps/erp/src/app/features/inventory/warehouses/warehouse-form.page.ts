import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  normalizeWarehouseCode,
  WAREHOUSE_CODE_PATTERN,
  WAREHOUSE_LOCATION_NOTE_MAX,
  WAREHOUSE_NAME_MAX,
  type WarehouseCreateInput,
  type WarehouseDetail,
  type WarehouseUpdateInput,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  EmptyStateIllustratedComponent,
  FieldComponent,
  IconComponent,
  InputDirective,
  ModalComponent,
  NoteComponent,
  PageHeaderComponent,
  SelectComponent,
  SelectOption,
  SkeletonComponent,
  SwitchComponent,
  TextareaDirective,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { problemOf } from '../../../core/api-error';
import { ContextStore } from '../../../core/context.store';
import { WarehousesApi } from './warehouses-api.service';
import { fieldOfError, WAREHOUSE_ERROR_MESSAGES } from './warehouses.mapper';

type LoadState = 'loading' | 'ready' | 'error' | 'not-found' | 'forbidden';

/** The code is stored upper case; this checks the normalized value, so typing `hk-02` is fine. */
function codeValidator(control: AbstractControl<string>): ValidationErrors | null {
  const value = normalizeWarehouseCode(control.value ?? '');
  if (!value) return { required: true };
  return WAREHOUSE_CODE_PATTERN.test(value) ? null : { pattern: true };
}

/** A main warehouse that would lose the flag when the one in the form takes it. */
interface MainSwap {
  code: string;
}

/**
 * IN-30a / IN-30b · New and edit warehouse, one form for both modes (the route decides). Editing locks what the API
 * would refuse (the branch once there are movements, the main flag of the main warehouse, deactivating with stock) and
 * explains why; whatever it still refuses comes back as a message under the field or above the buttons. Taking the main
 * flag from another warehouse asks for a confirmation that names it.
 */
@Component({
  selector: 'rs-warehouse-form-page',
  imports: [
    ButtonComponent,
    EmptyStateIllustratedComponent,
    FieldComponent,
    IconComponent,
    InputDirective,
    ModalComponent,
    NoteComponent,
    PageHeaderComponent,
    ReactiveFormsModule,
    SelectComponent,
    SkeletonComponent,
    SwitchComponent,
    TextareaDirective,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './warehouse-form.page.html',
  styleUrl: './warehouse-form.page.scss',
})
export class WarehouseFormPage implements OnInit {
  private readonly api = inject(WarehousesApi);
  private readonly ctx = inject(ContextStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly id = inject(ActivatedRoute).snapshot.paramMap.get('id');

  protected readonly editing = this.id !== null;
  protected readonly nameMax = WAREHOUSE_NAME_MAX;
  protected readonly noteMax = WAREHOUSE_LOCATION_NOTE_MAX;

  protected readonly form = new FormGroup({
    code: new FormControl('', { nonNullable: true, validators: [codeValidator] }),
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(WAREHOUSE_NAME_MAX)] }),
    branchId: new FormControl<string | null>(null, { validators: [Validators.required] }),
    locationNote: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(WAREHOUSE_LOCATION_NOTE_MAX)] }),
    isMain: new FormControl(false, { nonNullable: true }),
    visibleInStore: new FormControl(true, { nonNullable: true }),
    active: new FormControl(true, { nonNullable: true }),
  });

  protected readonly state = signal<LoadState>(this.editing ? 'loading' : 'ready');
  protected readonly detail = signal<WarehouseDetail | null>(null);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly submitError = signal<{ code: string; message: string } | null>(null);
  /** Server message tied to one field, cleared as soon as the user edits it. */
  protected readonly fieldErrors = signal<Partial<Record<'code' | 'branchId', string>>>({});
  protected readonly mainSwap = signal<MainSwap | null>(null);
  protected readonly swapOpen = signal(false);
  // the form is not a signal source: this mirrors the values the template and the rules read
  private readonly formValue = signal(this.form.getRawValue());

  protected readonly canManage = computed(() => this.ctx.can('inventory.warehouses.manage'));
  protected readonly branchOptions = computed<SelectOption[]>(() => this.ctx.branches().map((b) => ({ value: b.id, label: b.name })));
  private readonly branchName = computed(() => this.ctx.branches().find((b) => b.id === this.formValue().branchId)?.name ?? '');

  protected readonly title = this.editing ? 'Editar almacén' : 'Nuevo almacén';
  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Almacenes', link: '/inventory/warehouses' },
    { label: this.title },
  ];

  /** Why a control is locked in edit mode, shown as its hint. */
  protected readonly branchLocked = computed(() => !!this.detail()?.hasMovements);
  protected readonly mainLocked = computed(() => !!this.detail()?.isMain);
  protected readonly statusHint = computed(() => {
    const d = this.detail();
    if (!d) return '';
    if (d.totalUnits > 0) return 'Tiene stock: transfiérelo o ajústalo antes de desactivar el almacén.';
    if (d.isMain) return 'Es el principal de la sucursal: define otro como principal antes de desactivarlo.';
    return 'Un almacén inactivo no recibe stock, pero conserva su historial.';
  });

  protected readonly codeMessage = computed(() => {
    const server = this.fieldErrors().code;
    if (server) return server;
    const c = this.form.controls.code;
    if (!(c.touched || this.submitted()) || !c.errors) return null;
    return c.errors['required'] ? 'Ingresa el código del almacén.' : 'Usa de 2 a 12 letras mayúsculas, números o guiones (por ejemplo HK-02).';
  });
  protected readonly nameMessage = computed(() => {
    const c = this.form.controls.name;
    if (!(c.touched || this.submitted()) || !c.errors) return null;
    return c.errors['required'] ? 'Ingresa el nombre del almacén.' : `Usa como máximo ${WAREHOUSE_NAME_MAX} caracteres.`;
  });
  protected readonly branchMessage = computed(() => {
    const server = this.fieldErrors().branchId;
    if (server) return server;
    const c = this.form.controls.branchId;
    return (c.touched || this.submitted()) && c.errors ? 'Elige la sucursal del almacén.' : null;
  });

  protected readonly canSave = computed(() => !this.saving() && (!this.editing || this.dirty()));
  private readonly dirty = signal(false);

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      this.formValue.set(this.form.getRawValue());
      this.dirty.set(this.form.dirty);
    });
    this.form.controls.code.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.clearFieldError('code'));
    this.form.controls.branchId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.clearFieldError('branchId'));
  }

  ngOnInit() {
    if (!this.canManage()) {
      this.state.set('forbidden');
      return;
    }
    if (this.editing) this.load();
  }

  protected load() {
    if (!this.id) return;
    this.state.set('loading');
    this.submitError.set(null);
    this.api
      .get(this.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => {
          this.detail.set(detail);
          this.form.reset({
            code: detail.code,
            name: detail.name,
            branchId: detail.branch.id,
            locationNote: detail.locationNote ?? '',
            isMain: detail.isMain,
            visibleInStore: detail.visibleInStore,
            active: detail.status === 'ACTIVE',
          });
          this.formValue.set(this.form.getRawValue());
          this.dirty.set(false);
          this.applyLocks(detail);
          this.state.set('ready');
        },
        error: (err: unknown) => {
          const status = problemOf(err).status;
          this.state.set(status === 404 ? 'not-found' : status === 403 ? 'forbidden' : 'error');
        },
      });
  }

  private applyLocks(detail: WarehouseDetail) {
    const { branchId, isMain, active } = this.form.controls;
    const lock = (control: AbstractControl, locked: boolean) => (locked ? control.disable({ emitEvent: false }) : control.enable({ emitEvent: false }));
    lock(branchId, detail.hasMovements);
    lock(isMain, detail.isMain);
    lock(active, detail.isMain || detail.totalUnits > 0);
  }

  protected submit() {
    this.submitted.set(true);
    this.submitError.set(null);
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const takesMain = v.isMain && (!this.editing || !this.detail()?.isMain || v.branchId !== this.detail()?.branch.id);
    if (!takesMain || !v.branchId) {
      this.save();
      return;
    }
    // taking the main flag from another warehouse needs a confirmation that names it
    this.saving.set(true);
    this.api
      .list({ branchId: v.branchId, status: 'ACTIVE', pageSize: 100 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          const previous = list.items.find((w) => w.isMain && w.id !== this.id);
          this.saving.set(false);
          if (previous) {
            this.mainSwap.set({ code: previous.code });
            this.swapOpen.set(true);
          } else {
            this.save();
          }
        },
        // the save itself is still protected by the API: if the lookup fails, save without the confirmation text
        error: () => {
          this.saving.set(false);
          this.save();
        },
      });
  }

  protected confirmSwap() {
    this.swapOpen.set(false);
    this.save();
  }

  protected save() {
    if (this.saving()) return;
    this.saving.set(true);
    this.submitError.set(null);
    const request = this.editing && this.id ? this.api.update(this.id, this.updateBody()) : this.api.create(this.createBody());
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: ({ demotedMain }) => {
        this.saving.set(false);
        this.toast.success(this.editing ? 'Almacén actualizado' : 'Almacén creado');
        if (demotedMain) this.toast.info(`${demotedMain.code} dejó de ser el almacén principal.`);
        void this.router.navigate(['/inventory/warehouses']);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private createBody(): WarehouseCreateInput {
    const v = this.form.getRawValue();
    return {
      code: normalizeWarehouseCode(v.code),
      name: v.name.trim(),
      branchId: v.branchId ?? '',
      isMain: v.isMain,
      visibleInStore: v.visibleInStore,
      locationNote: this.noteOrNull(v.locationNote),
    };
  }

  /** Only what the user changed, plus the `updatedAt` the form loaded. */
  private updateBody(): WarehouseUpdateInput {
    const v = this.form.getRawValue();
    const d = this.detail();
    const body: WarehouseUpdateInput = { expectedUpdatedAt: d?.updatedAt };
    if (!d) return body;
    const code = normalizeWarehouseCode(v.code);
    if (code !== d.code) body.code = code;
    if (v.name.trim() !== d.name) body.name = v.name.trim();
    if (v.branchId && v.branchId !== d.branch.id) body.branchId = v.branchId;
    if (v.isMain && !d.isMain) body.isMain = true;
    if (v.visibleInStore !== d.visibleInStore) body.visibleInStore = v.visibleInStore;
    const locationNote = this.noteOrNull(v.locationNote);
    if (locationNote !== d.locationNote) body.locationNote = locationNote;
    const status = v.active ? 'ACTIVE' : 'INACTIVE';
    if (status !== d.status) body.status = status;
    return body;
  }

  /** An empty note is stored as no note. */
  private noteOrNull(note: string): string | null {
    return note.trim() || null;
  }

  private fail(err: unknown) {
    this.saving.set(false);
    const problem = problemOf(err);
    const message = WAREHOUSE_ERROR_MESSAGES[problem.code] ?? problem.message;
    const field = fieldOfError(problem.code);
    if (field) {
      this.fieldErrors.update((e) => ({ ...e, [field]: message }));
      return;
    }
    this.submitError.set({ code: problem.code, message });
  }

  private clearFieldError(field: 'code' | 'branchId') {
    if (this.fieldErrors()[field]) this.fieldErrors.update((e) => ({ ...e, [field]: undefined }));
  }

  /** Uppercases the code as the user leaves the field, so what is saved is what they see. */
  protected normalizeCode() {
    const control = this.form.controls.code;
    control.setValue(normalizeWarehouseCode(control.value), { emitEvent: false });
  }

  protected swapText(): string {
    const swap = this.mainSwap();
    const code = normalizeWarehouseCode(this.form.controls.code.value);
    return swap ? `${code || 'Este almacén'} será el principal de ${this.branchName()}. Se quitará como principal a ${swap.code}.` : '';
  }

  protected cancel() {
    if (!this.saving()) void this.router.navigate(['/inventory/warehouses']);
  }
}
