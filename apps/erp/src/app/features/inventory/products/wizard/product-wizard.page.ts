import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  type AttributeDefinitionItem,
  completedRequiredSteps,
  type EquivalenceSuggestion,
  fieldIconOf,
  type ProductDetail,
  type ProductEditModel,
  type ProductFilterOptions,
  type ProductSpec,
  type WizardStepKey,
  todayInLaPaz,
  validateProductDraft,
  wizardSteps,
} from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  FileDropzoneComponent,
  FileItemComponent,
  FilterChipComponent,
  IconComponent,
  type IconName,
  InputDirective,
  InputGroupComponent,
  ModalComponent,
  NoteComponent,
  NumericInputDirective,
  PageHeaderComponent,
  TextareaDirective,
  SelectComponent,
  SkeletonComponent,
  type SelectOption,
  StatusPillComponent,
  StepperComponent,
  ToastOutletComponent,
  ToastService,
  FlagComponent,
  ProductThumbComponent,
} from '@rodasoft/ui';
import { catchError, debounceTime, forkJoin, map, merge, of, type Subscription, switchMap } from 'rxjs';
import { equivalencePill } from '../sheet/equivalents/equivalence-pill';
import { messageFor, problemOf } from '../../../../core/api-error';
import { ContextStore } from '../../../../core/context.store';
import { canLinkReference, flagOf, type ReferenceSearchResult, toReferenceSearchResult } from '../product-list.mapper';
import { ProductsApi } from '../products-api.service';
import {
  attributeRules,
  attributeStep,
  commercialNameOf,
  draftInputOf,
  invalidStockFields,
  FIELD_ERROR_MESSAGES,
  formatSize,
  isLongText,
  placeholderOf,
  toUpdateRequest,
  toWriteRequest,
  uploadDetailOf,
  uploadProblemOf,
  WIZARD_SECTORS,
  WIZARD_STEP_LABELS,
  type WizardFieldError,
  type WizardFormValues,
} from './product-wizard.model';

/** First control the user can type in or pick from on the current step (the first match in document order). */
const FIRST_FIELD =
  '#product-wizard-step input:not([readonly]):not([type=file]):not([type=hidden]), #product-wizard-step textarea, #product-wizard-step button[role=combobox]';
/** The live code check waits this long after the last keystroke. */
const CODE_CHECK_DEBOUNCE_MS = 350;
/** Attribute step that holds the dimensions of a bearing (SPEC_STEP_DIMENSIONS in libs/domain). */
const DIMENSIONS_STEP = 2;
/** Largest number of photos on a product (IN-03 step 4). */
const MAX_PHOTOS = 5;
/** Attribute keys of the measures: the preview shows them as one chip. */
const DIMENSION_KEYS = ['innerDiameter', 'outerDiameter', 'width'];

type AttributeControls = Record<string, FormControl<string>>;

/** A chip of the preview card: what it is ("Medidas") and its value. */
interface PreviewChip {
  label: string;
  value: string;
}

/** A file that is uploading (or that failed): shown in the list until it is saved or dismissed. */
interface PendingUpload {
  id: number;
  kind: 'photo' | 'datasheet';
  name: string;
  percent: number;
  status: 'uploading' | 'error';
  detail: string;
  cancel: () => void;
}

/**
 * IN-03 · Creation wizard (HU-INV-06). `/inventory/products/new/:categoryId` creates a product; `/inventory/products/:id/draft`
 * resumes a draft. The steps come from `wizardSteps`: bearings have 6, the other categories 4.
 *
 * IN-20 · Edit (HU-INV-07). `/inventory/products/:id/edit` (route data `mode: 'edit'`) opens the same steps filled with the
 * stored product: every step is reachable and one "Guardar cambios" saves everything at the end. Stock is read-only, and
 * brand, category and subcategory are locked once the product has movements.
 */
@Component({
  selector: 'rs-product-wizard-page',
  imports: [
    ButtonComponent,
    FlagComponent,
    ProductThumbComponent,
    FieldComponent,
    FileDropzoneComponent,
    FileItemComponent,
    FilterChipComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    ModalComponent,
    NgTemplateOutlet,
    NoteComponent,
    NumericInputDirective,
    PageHeaderComponent,
    ReactiveFormsModule,
    RouterLink,
    SelectComponent,
    SkeletonComponent,
    StatusPillComponent,
    StepperComponent,
    TextareaDirective,
    ToastOutletComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-wizard.page.html',
  styleUrl: './product-wizard.page.scss',
})
export class ProductWizardPage {
  private readonly api = inject(ProductsApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Edit mode (HU-INV-07): the route says so; the product is loaded from the API instead of a draft or a category. */
  protected readonly isEdit = this.route.snapshot.data['mode'] === 'edit';
  /** The product being edited, as loaded: its lock value (`updatedAt`), whether it has movements and its stock. */
  protected readonly editState = signal<ProductEditModel | null>(null);
  protected readonly hasMovements = computed(() => this.editState()?.hasMovements ?? false);
  /** Set when the save finds that someone else edited the product meanwhile (409 `PRODUCT_MODIFIED`). */
  protected readonly modifiedOpen = signal(false);
  protected readonly lockedHint = 'No editable: el producto ya tiene movimientos';
  /** True while `prefill` runs, so the changes it makes to the form are not taken as the user changing the category. */
  private prefilling = false;
  /** Set when resuming a draft or editing: saves then update that product. A new product is created once and the page moves on. */
  protected readonly productId = signal<string | null>(this.route.snapshot.paramMap.get('id'));
  protected readonly rootId = signal<string | null>(this.route.snapshot.paramMap.get('categoryId'));
  protected readonly options = signal<ProductFilterOptions | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly definitions = signal<AttributeDefinitionItem[]>([]);
  /** Technical values of the draft being resumed; copied into the attribute controls once their definitions load. */
  private draftSpecs: ProductSpec[] = [];
  protected readonly stepIndex = signal(0);
  /** Highest step index the user has reached: going back must not undo a step that was already completed. */
  private readonly furthestStep = signal(0);
  /** Keys of the photos and the datasheet (POST /inventory/uploads), saved with the product on step 4. */
  protected readonly photoKeys = signal<string[]>([]);
  protected readonly datasheetKey = signal<string | null>(null);
  protected readonly uploads = signal<PendingUpload[]>([]);
  private nextUploadId = 0;
  protected readonly uploadError = signal<string | null>(null);
  /** Latest date the entry date can have: today in La Paz. */
  protected readonly today = todayInLaPaz();
  protected readonly stepNumber = computed(() => this.stepIndex() + 1);
  /** The hint under the first technical field of the dimensions step (IN-03 step 2). */
  protected readonly dimensionsHint = 'Se completa según d, D y B.';
  /** The hint under the first technical field of the second row (IN-03d). */
  protected readonly specsHint = computed(() => {
    this.formValues();
    return `Según la ${this.form.controls.subcategoryId.value ? 'subcategoría' : 'categoría'} ${this.categoryLabel() ?? ''}.`;
  });

  // Equivalences step (bearings): candidates by measures before the product exists, picked with "Vincular"
  protected readonly candidates = signal<EquivalenceSuggestion[]>([]);
  protected readonly candidatesState = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly linkIds = signal<readonly string[]>([]);
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly searchResults = signal<ReferenceSearchResult[]>([]);
  // leaving with unsaved work asks first; previews are object URLs of the uploaded photos
  protected readonly leaveOpen = signal(false);
  protected readonly mediaChanged = signal(false);
  protected readonly previews = signal<Readonly<Record<string, string>>>({});
  protected readonly maxPhotos = MAX_PHOTOS;
  protected readonly optionalStep = computed(() => !this.steps()[this.stepIndex()]?.required);
  protected readonly progressPercent = computed(() => {
    const { done, total } = this.progress();
    return total ? Math.round((done / total) * 100) : 0;
  });
  protected readonly attempted = signal(false);
  protected readonly stepMessage = signal<string | null>(null);
  protected readonly stepErrors = signal<WizardFieldError[]>([]);
  /** Set when the live check finds the code already used by the brand (the duplicate-code state). */
  protected readonly taken = signal<{ productId: string | null } | null>(null);
  protected readonly saving = signal(false);
  /** True while "Siguiente" waits for the API to confirm the code of the first step. */
  protected readonly verifying = signal(false);
  private definitionsSub?: Subscription;
  protected readonly submitError = signal<string | null>(null);

  protected readonly canSeeCost = computed(() => this.ctx.can('inventory.costs.view'));
  protected readonly root = computed(() => this.options()?.categories.find((c) => c.id === this.rootId()) ?? null);
  /** Bearings are the categories whose definitions include the dimensions step (the API uses the same rule). */
  protected readonly isBearing = computed(() => this.definitions().some((d) => d.step === DIMENSIONS_STEP));
  protected readonly steps = computed(() => wizardSteps(this.isBearing()));
  protected readonly currentStep = computed<WizardStepKey>(() => this.steps()[this.stepIndex()]?.key ?? 'identification');
  protected readonly isLastStep = computed(() => this.stepIndex() === this.steps().length - 1);
  protected readonly stepItems = computed(() =>
    this.steps().map((s) => ({ label: WIZARD_STEP_LABELS[s.key], tag: s.required ? 'Requerido' : 'Opcional' })),
  );
  protected readonly subcategoryOptions = computed<SelectOption[]>(() => [
    { value: null, label: 'Sin subcategoría' },
    ...(this.root()?.subcategories ?? []).map((s) => ({ value: s.id, label: s.name })),
  ]);
  protected readonly brandOptions = computed<SelectOption[]>(() =>
    (this.options()?.brands ?? []).map((b) => ({
      value: b.id,
      label: b.name,
      media: { type: 'brand' as const, text: b.name.slice(0, 3).toUpperCase() },
    })),
  );
  protected readonly countryOptions = computed<SelectOption[]>(() => [
    { value: null, label: 'Sin industria' },
    ...(this.options()?.countries ?? []).map((c) => {
      const flag = flagOf(c.code);
      return {
        value: c.id,
        label: c.name,
        media: flag ? { type: 'flag' as const, country: flag } : { type: 'brand' as const, text: c.code },
      };
    }),
  ]);
  protected readonly branchOptions = computed<SelectOption[]>(() => this.ctx.branches().map((b) => ({ value: b.id, label: b.name })));
  protected readonly unitOptions: SelectOption[] = [
    { value: 'UN', label: 'Pieza' },
    { value: 'PAR', label: 'Par' },
    { value: 'KG', label: 'Kilogramo (KG)' },
    { value: 'M', label: 'Metro (M)' },
  ];

  protected readonly form = new FormGroup({
    manufacturerCode: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(60)] }),
    name: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    sectors: new FormControl<string[]>([], { nonNullable: true }),
    brandId: new FormControl<string | null>(null),
    countryId: new FormControl<string | null>(null),
    subcategoryId: new FormControl<string | null>(null),
    /** The root category: only shown (and changeable) when editing; creation picks it on the categories screen. */
    rootCategoryId: new FormControl<string | null>(null),
    innerDiameter: new FormControl('', { nonNullable: true }),
    outerDiameter: new FormControl('', { nonNullable: true }),
    width: new FormControl('', { nonNullable: true }),
    weight: new FormControl('', { nonNullable: true }),
    salePrice: new FormControl('', { nonNullable: true }),
    cost: new FormControl('', { nonNullable: true }),
    unit: new FormControl('UN', { nonNullable: true }),
    branchId: new FormControl<string | null>(null),
    initialStock: new FormControl('', { nonNullable: true }),
    minStock: new FormControl('', { nonNullable: true }),
    maxStock: new FormControl('', { nonNullable: true }),
    location: new FormControl('', { nonNullable: true }),
    supplierName: new FormControl('', { nonNullable: true }),
    tariffCode: new FormControl('', { nonNullable: true }),
    entryDate: new FormControl('', { nonNullable: true }),
    /** One control per technical field of the category; replaced when the category changes. */
    attributes: new FormGroup<AttributeControls>({}),
  });

  private readonly formValues = toSignal(this.form.valueChanges, { initialValue: null });

  /** Required steps that are filled: they drive the progress counter ("2 de 3 requeridos"). */
  protected readonly completed = computed(() => {
    this.formValues();
    const done = new Set<WizardStepKey>();
    if (this.isEdit) {
      // an existing product has every step filled: a step only stops being done when its fields stop passing the rules
      for (const { key } of this.steps()) {
        if (!(key === 'identification' && this.taken()) && this.stepProblems(key).length === 0) done.add(key);
      }
      return done;
    }
    // a step is done when the final rules find nothing wrong in its fields (the same check "Siguiente" makes)
    if (!this.taken() && this.stepProblems('identification').length === 0) done.add('identification');
    if (this.steps().some((s) => s.key === 'dimensions') && this.stepProblems('dimensions').length === 0) done.add('dimensions');
    const priceFilled = (this.form.controls.salePrice.value ?? '').trim() !== '';
    if (priceFilled && this.stepProblems('price-inventory').length === 0) done.add('price-inventory');
    // the specifications count once the user has reached a later step with every required field filled (IN-03: a check on that step)
    const specsIndex = this.steps().findIndex((s) => s.key === 'specifications');
    if (specsIndex >= 0 && this.furthestStep() > specsIndex && this.stepProblems('specifications').length === 0) {
      done.add('specifications');
    }
    if (this.photoKeys().length || this.datasheetKey()) done.add('photos');
    return done;
  });
  protected readonly progress = computed(() => completedRequiredSteps(this.steps(), this.completed()));
  protected readonly brandName = computed(() => {
    this.formValues();
    return this.options()?.brands.find((b) => b.id === this.form.controls.brandId.value)?.name ?? null;
  });
  protected readonly categoryLabel = computed(() => {
    this.formValues();
    const sub = this.root()?.subcategories.find((s) => s.id === this.form.controls.subcategoryId.value);
    return sub?.name ?? this.root()?.name ?? null;
  });
  /** The commercial name built from category, brand and code; it follows them until the user types their own. */
  protected readonly suggestedName = computed(() => {
    this.formValues();
    return commercialNameOf(this.categoryLabel(), this.brandName(), this.form.controls.manufacturerCode.value);
  });
  /** True once the user wrote or kept a name of their own; clearing the field gives the automatic name back. */
  private readonly customName = signal(false);
  protected readonly title = computed(() => {
    if (this.isEdit) return `Editar ${this.editState()?.product.manufacturerCode ?? ''}`.trim();
    return this.productId() ? 'Borrador de producto' : 'Nuevo producto';
  });
  /** IN-03c header line: step, category, step name and whether the step is required. */
  protected readonly subtitle = computed(() => {
    const step = this.steps()[this.stepIndex()];
    const label = WIZARD_STEP_LABELS[step?.key ?? 'identification'];
    if (this.isEdit) return `Editando · Paso ${this.stepIndex() + 1} de ${this.steps().length} · ${label} · los cambios se guardan al final`;
    return `Paso ${this.stepIndex() + 1} de ${this.steps().length} · ${this.root()?.name ?? ''} · ${label} · ${step?.required ? 'requerido' : 'opcional'}`;
  });
  protected readonly progressItems = computed(() =>
    this.steps().map((step) => ({
      key: step.key,
      label: WIZARD_STEP_LABELS[step.key],
      required: step.required,
      done: this.completed().has(step.key),
    })),
  );
  /** Measures, price and the first two technical values, as the IN-03c preview shows them. */
  protected readonly previewChips = computed(() => {
    this.formValues();
    const v = this.form.getRawValue() as WizardFormValues;
    const attrs = v.attributes as Readonly<Record<string, string>>;
    const chips: PreviewChip[] = [];
    const measures = v.innerDiameter && v.outerDiameter && v.width ? [v.innerDiameter, v.outerDiameter, v.width] : DIMENSION_KEYS.map((k) => attrs[k] ?? '');
    if (measures.every(Boolean)) chips.push({ label: 'Medidas', value: `${measures[0]}×${measures[1]}×${measures[2]} mm` });
    const price = Number(v.salePrice.replace(',', '.'));
    if (v.salePrice && Number.isFinite(price)) chips.push({ label: 'Precio', value: `Bs ${price.toFixed(2).replace('.', ',')}` });
    const others = Object.entries(attrs).filter(([key, value]) => value && !DIMENSION_KEYS.includes(key));
    for (const [key, value] of others.slice(0, 2)) {
      const definition = this.definitions().find((d) => d.key === key);
      chips.push({ label: definition?.label ?? key, value: definition?.unit ? `${value} ${definition.unit}` : value });
    }
    return chips;
  });
  /** The first photo, once its preview is ready: it shows in the preview card as soon as it is uploaded. */
  protected readonly previewPhoto = computed(() => {
    const first = this.photoKeys()[0];
    return first ? (this.previews()[first] ?? null) : null;
  });
  protected readonly brandInitials = computed(() => (this.brandName() ?? '').slice(0, 2).toUpperCase());

  protected readonly sectorOptions = WIZARD_SECTORS;

  protected isSector(sector: string): boolean {
    return this.form.controls.sectors.value.includes(sector);
  }

  protected setSector(sector: string, on: boolean) {
    const current = this.form.controls.sectors.value.filter((s) => s !== sector);
    this.form.controls.sectors.setValue(on ? [...current, sector] : current);
  }
  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Productos', link: '/inventory/products' },
    { label: this.isEdit ? this.title() : 'Nuevo producto' },
  ]);
  /** Steps shown as done in the stepper: every filled step in edit mode; `null` keeps "the ones before the current". */
  protected readonly stepperCompleted = computed(() =>
    this.isEdit ? this.steps().flatMap((s, i) => (this.completed().has(s.key) ? [i + 1] : [])) : null,
  );
  protected readonly skuText = computed(() => this.editState()?.product.sku ?? 'Se asigna al crear');
  protected readonly rootOptions = computed<SelectOption[]>(() => (this.options()?.categories ?? []).map((c) => ({ value: c.id, label: c.name })));
  protected readonly currentStock = computed(() => this.editState()?.product.totalStock ?? 0);
  protected readonly thresholdBranchName = computed(() => this.ctx.branches().find((b) => b.id === this.form.controls.branchId.value)?.name ?? null);

  constructor() {
    effect(() => {
      if (this.currentStep() === 'equivalences') untracked(() => this.loadCandidates());
    });
    this.search.valueChanges
      .pipe(
        debounceTime(300),
        switchMap((term) => {
          const text = term.trim();
          return text.length < 2 ? of(null) : this.api.list({ search: text, page: 1, pageSize: 5 }).pipe(catchError(() => of(null)));
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) =>
        this.searchResults.set(
          (result?.items ?? [])
            .filter((item) => item.id !== this.productId() && !this.candidates().some((c) => c.productId === item.id))
            .map(toReferenceSearchResult),
        ),
      );
    this.destroyRef.onDestroy(() => Object.values(this.previews()).forEach((url) => URL.revokeObjectURL(url)));
    this.form.controls.brandId.valueChanges.pipe(takeUntilDestroyed()).subscribe((brandId) => {
      // the industry is suggested from the brand; the user can still change it
      const brand = this.options()?.brands.find((b) => b.id === brandId);
      if (brand?.countryId && !this.form.controls.countryId.value) this.form.controls.countryId.setValue(brand.countryId);
    });
    this.form.controls.subcategoryId.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => {
      // technical values belong to the category: a category chosen by the user starts them over
      if (this.isEdit && !this.prefilling) this.draftSpecs = [];
      this.loadDefinitions();
    });
    this.form.controls.rootCategoryId.valueChanges.pipe(takeUntilDestroyed()).subscribe((id) => {
      if (this.prefilling || !id || id === this.rootId()) return;
      this.rootId.set(id);
      this.draftSpecs = [];
      // emits even when the value is the same, so the definitions of the new category load
      this.form.controls.subcategoryId.setValue(null);
    });
    this.form.controls.branchId.setValue(this.ctx.currentBranch()?.id ?? this.ctx.branches()[0]?.id ?? null);
    // every step opens with its first field focused, so the user can start typing right away
    effect(() => {
      this.stepIndex();
      if (!this.options()) return;
      afterNextRender(
        () => this.host.nativeElement.querySelector<HTMLElement>(FIRST_FIELD)?.focus(),
        { injector: this.injector },
      );
    });
    // after "Siguiente" showed errors, they follow the fields: fixing one hides its message right away
    effect(() => {
      this.formValues();
      this.taken();
      untracked(() => {
        if (!this.attempted()) return;
        const errors = this.currentErrors(this.currentStep());
        this.stepErrors.set(errors);
        if (!errors.some((e) => e.code === 'PRICE_REQUIRED')) this.stepMessage.set(null);
      });
    });
    effect(() => {
      const suggested = this.suggestedName();
      if (!untracked(() => this.customName())) untracked(() => this.form.controls.name.setValue(suggested));
    });
    effect(() => {
      const index = this.stepIndex();
      untracked(() => this.furthestStep.update((furthest) => Math.max(furthest, index)));
    });

    merge(this.form.controls.manufacturerCode.valueChanges, this.form.controls.brandId.valueChanges)
      .pipe(
        debounceTime(CODE_CHECK_DEBOUNCE_MS),
        map(() => ({ code: this.form.controls.manufacturerCode.value.trim(), brandId: this.form.controls.brandId.value })),
        switchMap(({ code, brandId }) =>
          code && brandId ? this.api.codeAvailability(brandId, code).pipe(catchError(() => of(null))) : of(null),
        ),
        takeUntilDestroyed(),
      )
      .subscribe((result) => this.applyCodeCheck(result));

    this.load();
  }

  /** Filter options (categories, brands, industries) first; then the draft when resuming one, else the fields of the category. */
  protected load() {
    this.loadError.set(null);
    this.api
      .filterOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.options.set(options);
          const savedId = this.productId();
          if (savedId && this.isEdit) this.loadEdit(savedId);
          else if (savedId) this.loadDraft(savedId);
          else this.loadDefinitions();
        },
        error: (err: unknown) => this.loadError.set(problemOf(err).message),
      });
  }

  private loadDraft(id: string) {
    this.api
      .detail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (product) => {
          this.prefill(product);
          this.loadDefinitions();
        },
        error: (err: unknown) => this.loadError.set(problemOf(err).message),
      });
  }

  /** The product to edit with its lock value; copies it into the form, the current branch's thresholds included. */
  private loadEdit(id: string) {
    this.api
      .editModel(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (model) => {
          this.editState.set(model);
          this.prefill(model.product);
          // the sheet shows the brand's country when the product has none: the form holds the product's own
          this.form.patchValue({ countryId: model.countryId, entryDate: model.entryDate ?? '' });
          // the main warehouse's own thresholds: they are what the save replaces, not the branch sum the sheet shows
          const branch = model.thresholds.find((t) => t.branchId === this.form.controls.branchId.value);
          this.form.patchValue({
            minStock: branch?.minStock?.toString() ?? '',
            maxStock: branch?.maxStock?.toString() ?? '',
            location: branch?.location ?? '',
          });
          for (const control of [this.form.controls.brandId, this.form.controls.subcategoryId, this.form.controls.rootCategoryId]) {
            if (model.hasMovements) control.disable({ emitEvent: false });
            else control.enable({ emitEvent: false });
          }
          this.form.markAsPristine();
          this.loadDefinitions();
        },
        error: (err: unknown) => this.loadError.set(problemOf(err).message),
      });
  }

  /** Copies a saved draft into the form, technical fields included (applied when their definitions load). */
  private prefill(product: ProductDetail) {
    this.prefilling = true;
    this.rootId.set(product.category.id);
    this.form.controls.rootCategoryId.setValue(product.category.id);
    this.draftSpecs = product.specs;
    this.photoKeys.set(product.photos ?? []);
    for (const key of product.photos ?? []) this.loadPreview(key);
    this.datasheetKey.set(product.datasheetUrl ?? null);
    this.form.patchValue({ name: product.name });
    this.form.controls.sectors.setValue(product.extra.sectors ? product.extra.sectors.split(', ') : []);
    this.form.patchValue({
      manufacturerCode: product.manufacturerCode,
      brandId: product.brand.id,
      countryId: product.country?.id ?? null,
      subcategoryId: product.subcategory?.id ?? null,
      innerDiameter: product.dimensions?.innerDiameter ?? '',
      outerDiameter: product.dimensions?.outerDiameter ?? '',
      width: product.dimensions?.width ?? '',
      weight: product.dimensions?.weight ?? '',
      salePrice: product.pricing.salePrice ?? '',
      cost: product.pricing.cost ?? '',
      unit: product.unit || 'UN',
      supplierName: product.extra.supplierName ?? '',
      tariffCode: product.extra.tariffCode ?? '',
    });
    // a saved name that differs from the suggestion was written by the user: keep it
    this.customName.set(!!product.name?.trim() && product.name.trim() !== this.suggestedName());
    this.prefilling = false;
  }

  /** Typing in the name field takes it over from the suggestion; emptying it hands it back. */
  protected onNameInput() {
    this.customName.set(this.form.controls.name.value.trim() !== '');
  }

  /** Technical fields of the chosen subcategory, or of the root category when none is chosen (the API falls back to the parent). */
  private loadDefinitions() {
    const categoryId = this.form.controls.subcategoryId.value ?? this.rootId();
    if (!categoryId) return;
    // a newer subcategory cancels the request still in flight, so an old answer cannot replace the fields
    this.definitionsSub?.unsubscribe();
    this.definitionsSub = this.api
      .attributeDefinitions(categoryId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (items) => {
          this.definitions.set(items);
          const group = new FormGroup<AttributeControls>({});
          for (const item of items) group.addControl(item.key, new FormControl('', { nonNullable: true }));
          for (const spec of this.draftSpecs) {
            if (spec.value !== null) group.get(spec.key)?.setValue(String(spec.value));
          }
          this.form.setControl('attributes', group);
        },
        error: (err: unknown) => this.loadError.set(problemOf(err).message),
      });
  }

  protected fieldsOf(step: WizardStepKey): AttributeDefinitionItem[] {
    if (step !== 'dimensions' && step !== 'specifications') return [];
    return this.definitions().filter((d) => attributeStep(d, this.isBearing()) === step);
  }

  protected readonly isLongText = isLongText;
  protected readonly placeholderOf = placeholderOf;

  protected optionsOf(definition: AttributeDefinitionItem): SelectOption[] {
    return (definition.options ?? []).map((o) => ({ value: o, label: o }));
  }

  /** Errors that belong to one step; they block "Siguiente" until fixed. */
  private errorsOf(step: WizardStepKey, all: readonly WizardFieldError[]): WizardFieldError[] {
    const own: Record<WizardStepKey, string[]> = {
      identification: ['manufacturerCode', 'brandId', 'categoryId'],
      dimensions: ['dimensions', 'innerDiameter', 'outerDiameter', 'width', 'weight'],
      specifications: [],
      'price-inventory': ['salePrice', 'cost', 'tariffCode', 'entryDate', 'minStock', 'maxStock'],
      photos: [],
      equivalences: [],
    };
    const keys = this.fieldsOf(step).map((d) => d.key);
    return all.filter((e) => own[step].includes(e.field) || keys.includes(e.field));
  }

  private validate(draft: boolean): WizardFieldError[] {
    const values = this.form.getRawValue() as WizardFormValues;
    const input = draftInputOf(values, this.rootId(), this.isBearing());
    // numbers are typed with a comma in Bolivia ("0,13"); the domain rules take a dot
    const attributes: Record<string, string> = { ...values.attributes };
    for (const definition of this.definitions()) {
      if (definition.type === 'NUMBER' && attributes[definition.key]) {
        attributes[definition.key] = attributes[definition.key].trim().replace(',', '.');
      }
    }
    input.attributes = attributes;
    return validateProductDraft(input, attributeRules(this.definitions()), { draft });
  }

  /** Body for the API: NUMBER attributes are sent as numbers; cost only with `inventory.costs.view`. */
  private body(status: 'ACTIVE' | 'DRAFT') {
    return {
      ...toWriteRequest(this.form.getRawValue() as WizardFormValues, this.definitions(), {
        status,
        categoryId: this.rootId(),
        withCost: this.canSeeCost(),
      }),
      photos: this.photoKeys(),
      datasheetKey: this.datasheetKey(),
    };
  }

  /** Icon of a technical field, from its type, unit and key (Figma field icons). */
  protected iconOfField(definition: AttributeDefinitionItem): IconName {
    return fieldIconOf({ type: definition.type, unit: definition.unit, key: definition.key }) as IconName;
  }

  /** Files picked or dropped on a drop area: each one is checked and uploaded on its own, with its own progress. */
  protected onFiles(kind: 'photo' | 'datasheet', files: File[]) {
    const code = this.form.controls.manufacturerCode.value.trim();
    if (!code) {
      this.uploadError.set('Ingresa el código del fabricante antes de subir archivos: da nombre a cada archivo.');
      return;
    }
    const room = kind === 'photo' ? MAX_PHOTOS - this.photoKeys().length - this.uploads().filter((u) => u.kind === 'photo').length : 1;
    const picked = files.slice(0, Math.max(0, room));
    if (!picked.length) {
      this.uploadError.set(`Ya hay ${MAX_PHOTOS} fotos. Quita una para agregar otra.`);
      return;
    }
    const problems = picked.map((file) => uploadProblemOf(kind, file)).filter((p): p is string => !!p);
    this.uploadError.set(problems[0] ?? (files.length > picked.length ? `Solo se subieron ${picked.length} de ${files.length} archivos.` : null));
    for (const file of picked) if (!uploadProblemOf(kind, file)) this.upload(kind, file, code);
  }

  private upload(kind: 'photo' | 'datasheet', file: File, code: string) {
    const id = ++this.nextUploadId;
    const started = Date.now();
    const patch = (change: Partial<PendingUpload>) =>
      this.uploads.update((all) => all.map((u) => (u.id === id ? { ...u, ...change } : u)));
    const subscription = this.api
      .upload(file, kind, code)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (event) => {
          if (event.type === 'progress') {
            patch({ percent: event.percent, detail: uploadDetailOf(file.size, event.percent, Date.now() - started) });
            return;
          }
          const { key } = event.response;
          if (kind === 'photo') {
            this.photoKeys.update((keys) => [...keys, key]);
            this.loadPreview(key);
          } else {
            this.datasheetKey.set(key);
          }
          this.mediaChanged.set(true);
          this.uploads.update((all) => all.filter((u) => u.id !== id));
        },
        error: (err: unknown) => patch({ status: 'error', detail: problemOf(err).message }),
      });
    this.uploads.update((all) => [
      ...all,
      { id, kind, name: file.name, percent: 0, status: 'uploading', detail: formatSize(file.size), cancel: () => subscription.unsubscribe() },
    ]);
  }

  /** The "x" of a row that is still uploading (cancels the request) or that failed (dismisses it). */
  protected dismissUpload(upload: PendingUpload) {
    upload.cancel();
    this.uploads.update((all) => all.filter((u) => u.id !== upload.id));
  }

  /** File name shown in the list: the last part of the key or of the Cloudinary URL. */
  protected fileNameOf(reference: string): string {
    return reference.slice(reference.lastIndexOf('/') + 1);
  }

  protected readonly photosFull = computed(
    () => this.photoKeys().length + this.uploads().filter((u) => u.kind === 'photo').length >= MAX_PHOTOS,
  );

  protected removePhoto(index: number) {
    this.photoKeys.update((keys) => keys.filter((_, i) => i !== index));
    this.mediaChanged.set(true);
  }

  protected removeDatasheet() {
    this.datasheetKey.set(null);
    this.mediaChanged.set(true);
  }

  protected pillOf(candidate: EquivalenceSuggestion) {
    return equivalencePill(candidate, 'short');
  }

  /** What makes a candidate exact or different, in a line. */
  protected noteOf(candidate: EquivalenceSuggestion): string {
    if (candidate.kind === 'EXACT') return 'Mismas medidas y características.';
    return `Difiere en: ${candidate.differences.map((d) => d.label.toLowerCase()).join(', ')}.`;
  }

  /** The search results with whether each can be linked: the API only links the same type and measures. */
  protected readonly searchRows = computed(() => {
    this.formValues();
    return this.searchResults().map((result) => ({ result, linkable: this.canLink(result) }));
  });

  /** Whether a search result can be linked to the product being typed: same type and measures. */
  protected canLink(result: ReferenceSearchResult): boolean {
    const body = this.body('DRAFT');
    const measures = body.innerDiameter && body.outerDiameter && body.width ? { innerDiameter: body.innerDiameter, outerDiameter: body.outerDiameter, width: body.width } : null;
    return canLinkReference(result, { categoryId: body.categoryId ?? null, measures });
  }

  protected isLinked(productId: string): boolean {
    return this.linkIds().includes(productId);
  }

  protected toggleLink(productId: string) {
    this.linkIds.update((ids) => (ids.includes(productId) ? ids.filter((id) => id !== productId) : [...ids, productId]));
  }

  /** The measures typed so far as one text ("25×52×15 mm"), or null while one is missing. */
  protected readonly measuresText = computed(() => {
    this.formValues();
    const body = this.body('DRAFT');
    return body.innerDiameter && body.outerDiameter && body.width ? `${body.innerDiameter}×${body.outerDiameter}×${body.width} mm` : null;
  });

  /** "Revisa antes de guardar": what will be saved, and the optional steps that were left out. */
  protected readonly review = computed(() => {
    this.formValues();
    const v = this.form.getRawValue() as WizardFormValues;
    const branch = this.ctx.branches().find((b) => b.id === v.branchId)?.name;
    const skipped = this.steps()
      .filter((s) => !s.required && s.key !== 'equivalences' && !this.completed().has(s.key))
      .map((s) => WIZARD_STEP_LABELS[s.key]);
    return [
      { label: 'Producto', value: [v.manufacturerCode.trim(), this.brandName(), this.categoryLabel()].filter(Boolean).join(' · ') || '—' },
      { label: 'Medidas', value: this.measuresText() ?? '—' },
      { label: 'Precio de venta', value: v.salePrice ? `Bs ${v.salePrice.replace('.', ',')}` : '—' },
      this.isEdit
        ? { label: 'Stock total', value: String(this.currentStock()) }
        : { label: 'Stock inicial', value: v.initialStock ? [v.initialStock, branch].filter(Boolean).join(' · ') : '—' },
      { label: 'Pasos omitidos', value: skipped.length ? skipped.join(', ') : 'Ninguno' },
    ];
  });

  protected loadCandidates() {
    const savedId = this.productId();
    if (this.isEdit && savedId) {
      // the product is saved: the API knows its measures and leaves out itself and what is already linked
      this.candidatesState.set('loading');
      this.api
        .equivalenceSuggestions(savedId)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: ({ items }) => {
            this.candidates.set(items);
            this.candidatesState.set('ready');
          },
          error: () => this.candidatesState.set('error'),
        });
      return;
    }
    const body = this.body('DRAFT');
    const categoryId = body.categoryId;
    if (!categoryId || !body.innerDiameter || !body.outerDiameter || !body.width) {
      this.candidates.set([]);
      this.candidatesState.set('ready');
      return;
    }
    this.candidatesState.set('loading');
    this.api
      .candidates({ categoryId, innerDiameter: body.innerDiameter, outerDiameter: body.outerDiameter, width: body.width, attributes: body.attributes })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ items }) => {
          this.candidates.set(items);
          this.candidatesState.set('ready');
        },
        error: () => this.candidatesState.set('error'),
      });
  }

  /** "Guardar sin vincular": saves the product and leaves the equivalences for later. */
  protected saveWithoutLinks() {
    this.linkIds.set([]);
    this.create();
  }

  protected cancel() {
    if (this.form.dirty || this.mediaChanged()) {
      this.leaveOpen.set(true);
      return;
    }
    this.leave();
  }

  protected leave() {
    this.leaveOpen.set(false);
    const savedId = this.productId();
    void this.router.navigate(this.isEdit && savedId ? ['/inventory/products', savedId] : ['/inventory/products']);
  }

  /** "Ajustar stock" links to the adjustments, which arrive with their own story. */
  protected adjustStock() {
    this.toast.info('Esta acción estará disponible próximamente.');
  }

  /** The step the user picked in the stepper (1-based): in edit mode every step is reachable, without validating on the way. */
  protected selectStep(step: number) {
    this.stepMessage.set(null);
    this.stepErrors.set([]);
    this.attempted.set(false);
    this.stepIndex.set(Math.min(Math.max(0, step - 1), this.steps().length - 1));
  }

  /** "Recargar" after another user's edit: starts over from what is saved now. */
  protected reload() {
    this.modifiedOpen.set(false);
    this.mediaChanged.set(false);
    this.attempted.set(false);
    this.stepErrors.set([]);
    this.stepMessage.set(null);
    this.submitError.set(null);
    this.linkIds.set([]);
    this.load();
  }

  private loadPreview(key: string) {
    // Cloudinary photos are public URLs; only files kept on disk (development) are fetched through the API
    if (key.startsWith('https://')) {
      this.previews.update((p) => ({ ...p, [key]: key }));
      return;
    }
    this.api
      .file(key)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({ next: (blob) => this.previews.update((p) => ({ ...p, [key]: URL.createObjectURL(blob) })), error: () => undefined });
  }

  /** Omit this step: move on without its data; on the last step it creates the product. */
  protected skip() {
    if (this.isLastStep()) {
      this.create();
      return;
    }
    this.stepMessage.set(null);
    this.stepErrors.set([]);
    this.attempted.set(false);
    this.stepIndex.update((i) => i + 1);
  }

  protected errorText(name: string): string | null {
    // the duplicate code found by the API shows under the field as soon as it is known, not only after "Siguiente"
    if (name === 'manufacturerCode' && this.taken()) return FIELD_ERROR_MESSAGES['DUPLICATE_MANUFACTURER_CODE'];
    const error = this.stepErrors().find((e) => e.field === name);
    return error ? (FIELD_ERROR_MESSAGES[error.code] ?? null) : null;
  }

  protected invalid(name: string): boolean {
    return this.attempted() && this.stepErrors().some((e) => e.field === name);
  }

  protected back() {
    this.stepMessage.set(null);
    this.stepErrors.set([]);
    this.attempted.set(false);
    this.stepIndex.update((i) => Math.max(0, i - 1));
  }

  /**
   * "Siguiente" checks the current step. On the last step the same button creates the product. On the first step the
   * code is asked to the API first (not only the live check, which may still be waiting for its pause), so a duplicate
   * never gets past this step.
   */
  protected next() {
    if (this.saving() || this.verifying()) return;
    this.attempted.set(true);
    const code = this.form.controls.manufacturerCode.value.trim();
    const brandId = this.form.controls.brandId.value;
    if (this.currentStep() === 'identification' && code && brandId) {
      this.verifying.set(true);
      this.api
        .codeAvailability(brandId, code)
        .pipe(catchError(() => of(null)), takeUntilDestroyed(this.destroyRef))
        .subscribe((result) => {
          this.verifying.set(false);
          // if the check itself fails, the API still refuses a duplicate when the product is saved
          if (result) this.applyCodeCheck(result);
          this.advance();
        });
      return;
    }
    this.advance();
  }

  private advance() {
    const step = this.currentStep();
    // a step is checked with the final rules: a required field is required before the user moves on
    const errors = this.currentErrors(step);
    if (errors.length) {
      this.stepErrors.set(errors);
      this.stepMessage.set(
        errors.some((e) => e.code === 'PRICE_REQUIRED') ? 'No puedes continuar sin precio de venta.' : null,
      );
      return;
    }
    this.stepErrors.set([]);
    this.stepMessage.set(null);
    this.attempted.set(false);
    if (this.isLastStep()) this.create();
    else this.stepIndex.update((i) => i + 1);
  }

  /** The answer of the API about the (brand, code) pair: a code used by another product marks the field. */
  private applyCodeCheck(result: { available: boolean; productId: string | null } | null) {
    const used = !!result && !result.available && result.productId !== this.productId();
    this.taken.set(used ? { productId: result.productId } : null);
  }


  /** What blocks the step now: its field problems, plus the duplicate code found by the live check. */
  private currentErrors(step: WizardStepKey): WizardFieldError[] {
    const problems = this.stepProblems(step);
    if (step !== 'identification' || !this.taken()) return problems;
    return [{ field: 'manufacturerCode', code: 'DUPLICATE_MANUFACTURER_CODE' }, ...problems.filter((e) => e.field !== 'manufacturerCode')];
  }

  /** Field problems of one step: the domain rules for its fields, plus stock that is not a whole number. */
  private stepProblems(step: WizardStepKey): WizardFieldError[] {
    const problems: WizardFieldError[] = this.errorsOf(step, this.validate(false));
    if (step === 'price-inventory') {
      for (const field of invalidStockFields(this.form.getRawValue() as WizardFormValues)) {
        problems.push({ field, code: 'STOCK_INVALID' });
      }
    }
    return problems;
  }

  /** The step that owns the first field error of the whole form, so the user lands where the problem is. */
  private firstStepWithProblem(): WizardStepKey | null {
    for (const { key } of this.steps()) {
      if (this.stepProblems(key).length) return key;
    }
    return null;
  }

  /** Enter in a field and the main button: creating goes step by step; editing saves everything. */
  protected submit() {
    if (this.isEdit) this.saveChanges();
    else this.next();
  }

  /** "Guardar cambios" (HU-INV-07): checks every step, then one PATCH with the lock value the form was loaded with. */
  protected saveChanges() {
    const id = this.productId();
    const model = this.editState();
    if (this.saving() || !id || !model) return;
    const blocked = this.firstStepWithProblem();
    if (blocked) {
      this.goTo(blocked, this.stepProblems(blocked), null);
      return;
    }
    if (this.taken()) {
      this.goTo('identification', [{ field: 'manufacturerCode', code: 'DUPLICATE_MANUFACTURER_CODE' }], null);
      return;
    }
    this.saving.set(true);
    this.submitError.set(null);
    const values = this.form.getRawValue() as WizardFormValues;
    const touched = (['minStock', 'maxStock', 'location'] as const).some((key) => this.form.controls[key].dirty);
    const body = {
      ...toUpdateRequest(values, this.definitions(), {
        categoryId: this.rootId(),
        withCost: this.canSeeCost(),
        expectedUpdatedAt: model.product.updatedAt,
        thresholdBranchId: touched ? values.branchId : null,
      }),
      photos: this.photoKeys(),
      datasheetKey: this.datasheetKey(),
    };
    const links = this.linkIds();
    this.api
      .update(id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const done = () => {
            this.saving.set(false);
            this.form.markAsPristine();
            this.mediaChanged.set(false);
            this.toast.success('Cambios guardados');
            void this.router.navigate(['/inventory/products', id]);
          };
          if (!links.length) return done();
          // a link that fails must not undo the changes that were just saved, but the user is told
          forkJoin(links.map((other) => this.api.linkEquivalence(id, other).pipe(map(() => true), catchError(() => of(false)))))
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((results) => {
              done();
              const failed = results.filter((ok) => !ok).length;
              if (failed) this.toast.warning(`No se pudo vincular ${failed === 1 ? 'una equivalencia' : `${failed} equivalencias`}. Vincúlalas desde la ficha.`);
            });
        },
        error: (err: unknown) => this.failed(err),
      });
  }

  protected saveDraft() {
    if (this.saving()) return;
    this.saving.set(true);
    this.submitError.set(null);
    const id = this.productId();
    const request = id ? this.api.saveDraft(id, this.body('DRAFT')) : this.api.create(this.body('DRAFT'));
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.toast.success('Borrador guardado.');
        // drafts keep no stock, location or thresholds: they are recorded when the product is created
        const stock = this.form.getRawValue();
        if ([stock.initialStock, stock.minStock, stock.maxStock, stock.location].some((v) => (v ?? '').toString().trim() !== '')) {
          this.toast.info('El stock y la ubicación se registran al crear el producto.');
        }
        void this.router.navigate(['/inventory/products'], { queryParams: { status: 'DRAFT' } });
      },
      error: (err: unknown) => this.failed(err),
    });
  }

  private create() {
    // the last step does not re-check the others: a problem left on an earlier step sends the user back there
    const blocked = this.firstStepWithProblem();
    if (blocked) {
      this.goTo(blocked, this.stepProblems(blocked), null);
      return;
    }
    this.saving.set(true);
    this.submitError.set(null);
    const id = this.productId();
    const request = id ? this.api.saveDraft(id, this.body('ACTIVE')) : this.api.create(this.body('ACTIVE'));
    const links = this.linkIds();
    request.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (created) => {
        // the product sheet opens right away; a link that fails must not undo the product that was just saved, but the user is told
        const done = (failed = 0) => {
          this.saving.set(false);
          this.toast.success('Producto creado correctamente.');
          if (failed) this.toast.warning(`No se pudo vincular ${failed === 1 ? 'una equivalencia' : `${failed} equivalencias`}. Vincúlalas desde la ficha.`);
          void this.router.navigate(['/inventory/products', created.id]);
        };
        if (!links.length) return done();
        forkJoin(links.map((id) => this.api.linkEquivalence(created.id, id).pipe(map(() => true), catchError(() => of(false)))))
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe((results) => done(results.filter((ok) => !ok).length));
      },
      error: (err: unknown) => this.failed(err),
    });
  }

  /** Maps API errors to the IN-03 error states: a duplicate code and a missing price go back to their step. */
  private failed(err: unknown) {
    this.saving.set(false);
    const problem = problemOf(err);
    if (problem.code === 'PRODUCT_MODIFIED') {
      this.modifiedOpen.set(true);
    } else if (problem.code === 'PRODUCT_HAS_MOVEMENTS') {
      this.submitError.set(messageFor('PRODUCT_FIELDS_LOCKED'));
    } else if (problem.code === 'DUPLICATE_MANUFACTURER_CODE') {
      this.taken.set({ productId: this.taken()?.productId ?? null });
      this.goTo('identification', [{ field: 'manufacturerCode', code: 'DUPLICATE_MANUFACTURER_CODE' }], null);
    } else if (problem.code === 'PRICE_REQUIRED') {
      this.goTo('price-inventory', [{ field: 'salePrice', code: 'PRICE_REQUIRED' }], problem.message);
    } else {
      this.submitError.set(problem.message);
    }
  }

  private goTo(step: WizardStepKey, errors: WizardFieldError[], message: string | null) {
    const index = this.steps().findIndex((s) => s.key === step);
    this.stepIndex.set(Math.max(0, index));
    this.attempted.set(true);
    this.stepErrors.set(errors);
    this.stepMessage.set(message);
  }

}
