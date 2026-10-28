import { NgTemplateOutlet } from '@angular/common';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject, signal, type WritableSignal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { EQUIVALENCE_NOTES_MAX, type EquivalenceValidationResponse, type ProductListItem } from '@rodasoft/domain';
import {
  ButtonComponent,
  FieldComponent,
  FlagComponent,
  IconComponent,
  InputDirective,
  InputGroupComponent,
  NoteComponent,
  PageHeaderComponent,
  ProductThumbComponent,
  SelectComponent,
  SkeletonComponent,
  TextareaDirective,
  ToastService,
} from '@rodasoft/ui';
import { catchError, debounceTime, distinctUntilChanged, map, of, switchMap, tap } from 'rxjs';
import { problemOf } from '../../../../core/api-error';
import { ContextStore } from '../../../../core/context.store';
import { flagOf, thumbIconOf } from '../../products/product-list.mapper';
import { ProductsApi } from '../../products/products-api.service';
import { EquivalencesApi } from '../equivalences-api.service';
import {
  existsMessage,
  incompatibleMessage,
  type LinkProduct,
  linkProductOfDetail,
  isAvailableEquivalent,
  linkProductOfListItem,
  type LinkType,
  measuresText,
  productLabel,
  SAME_BRAND_MESSAGE,
  shownType,
  TYPE_OPTIONS,
} from './equivalence-link.mapper';

type Side = 'origin' | 'equivalent';
type PreviewState = 'idle' | 'loading' | 'ready' | 'error';
type LoadState = 'ready' | 'loading' | 'error';

const SEARCH_DEBOUNCE_MS = 250;
/** Products asked for, and shown once the ones that cannot be linked are left out. */
const FETCH_SIZE = 30;
const RESULTS_LIMIT = 8;

/**
 * IN-15c / IN-15d / IN-15e · Link two products as equivalents. The origin comes from the sheet (`?productId=`) or is
 * searched; the equivalent is always searched. Every pair is checked with the API as soon as both are chosen: an
 * existing link (IN-15d) or measures that differ (IN-15e) block saving, with the messages of the design.
 */
@Component({
  selector: 'rs-equivalence-link-page',
  imports: [
    ButtonComponent,
    FieldComponent,
    FlagComponent,
    IconComponent,
    InputDirective,
    InputGroupComponent,
    NgTemplateOutlet,
    NoteComponent,
    PageHeaderComponent,
    ProductThumbComponent,
    SelectComponent,
    SkeletonComponent,
    TextareaDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './equivalence-link.page.html',
  styleUrl: './equivalence-link.page.scss',
})
export class EquivalenceLinkPage {
  private readonly equivalences = inject(EquivalencesApi);
  private readonly products = inject(ProductsApi);
  private readonly ctx = inject(ContextStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  /** The product of the sheet the user came from; the form goes back there when it ends. */
  protected readonly fromProductId = this.route.snapshot.queryParamMap.get('productId');

  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Equivalencias', link: '/inventory/equivalences' },
    { label: 'Vincular equivalencia' },
  ];
  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly notesMax = EQUIVALENCE_NOTES_MAX;

  protected readonly origin = signal<LinkProduct | null>(null);
  protected readonly equivalent = signal<LinkProduct | null>(null);
  protected readonly originState = signal<LoadState>(this.fromProductId ? 'loading' : 'ready');

  protected readonly originQuery = signal('');
  protected readonly equivalentQuery = signal('');
  protected readonly originResults = signal<readonly LinkProduct[] | null>(null);
  protected readonly equivalentResults = signal<readonly LinkProduct[] | null>(null);
  protected readonly originSearching = signal(false);
  protected readonly equivalentSearching = signal(false);
  protected readonly searchFailed = signal(false);

  /** The three signals of each side of the form, so a side is read in one place. */
  private readonly slots: Record<Side, { selected: WritableSignal<LinkProduct | null>; query: WritableSignal<string>; results: WritableSignal<readonly LinkProduct[] | null> }> = {
    origin: { selected: this.origin, query: this.originQuery, results: this.originResults },
    equivalent: { selected: this.equivalent, query: this.equivalentQuery, results: this.equivalentResults },
  };

  /** Products the origin is already linked to. */
  private readonly linkedIds = signal<ReadonlySet<string>>(new Set());
  protected readonly previewState = signal<PreviewState>('idle');
  protected readonly validation = signal<EquivalenceValidationResponse | null>(null);
  protected readonly substitute = signal(false);
  protected readonly notes = signal('');
  protected readonly saving = signal(false);
  protected readonly submitError = signal<string | null>(null);
  /** Asks the API again after it answered that the pair changed meanwhile. */
  private readonly revalidate = signal(0);

  protected readonly registeredBy = computed(() => {
    const name = this.ctx.context()?.user.name ?? '';
    const date = new Date().toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/La_Paz' });
    return `${name} · ${date.replace(/\./g, '')}`;
  });

  protected readonly sameBrand = computed(() => {
    const a = this.origin();
    const b = this.equivalent();
    return !!a && !!b && a.brand.id === b.brand.id && a.id !== b.id;
  });
  /** The message under "Rodamiento equivalente": the error of IN-15d / IN-15e, or null. */
  protected readonly equivalentError = computed<string | null>(() => {
    const a = this.origin();
    const b = this.equivalent();
    const v = this.validation();
    if (!a || !b) return null;
    if (a.id === b.id) return 'Un producto no puede ser equivalente de sí mismo.';
    if (this.sameBrand()) return SAME_BRAND_MESSAGE;
    if (!v || this.previewState() !== 'ready') return null;
    if (v.exists) return existsMessage(a, b);
    if (v.typeDiffers) return incompatibleMessage(a, b, v);
    return null;
  });
  /** The red note ("No se pudo guardar"): why the pair cannot be saved. */
  protected readonly blockNote = computed<string | null>(() => {
    const v = this.validation();
    if (this.submitError()) return this.submitError();
    if (!this.equivalentError()) return null;
    if (v?.exists && !this.sameBrand()) return 'Este equivalente ya está vinculado al rodamiento de origen.';
    if (v?.typeDiffers) return 'Las medidas no coinciden. Revisa el rodamiento equivalente antes de continuar.';
    return 'Revisa el rodamiento equivalente antes de continuar.';
  });
  protected readonly type = computed<LinkType | null>(() => shownType(this.substitute(), this.validation()?.kind ?? null));
  protected readonly differenceTexts = computed(() =>
    (this.validation()?.differences ?? []).map((d) => `${d.label}: ${d.source ?? '—'} → ${d.other ?? '—'}`),
  );
  protected readonly canSave = computed(
    () => this.previewState() === 'ready' && !this.equivalentError() && !this.saving() && !!this.origin() && !!this.equivalent(),
  );
  protected readonly typeDisabled = computed(() => this.previewState() !== 'ready' || !!this.equivalentError());

  constructor() {
    this.loadOrigin();
    this.watchSearch(this.originQuery, this.originResults, this.originSearching);
    // the origin itself and what it is already linked to are not offered as its equivalent
    this.watchSearch(this.equivalentQuery, this.equivalentResults, this.equivalentSearching, (p) => {
      const origin = this.origin();
      return !origin || isAvailableEquivalent(p, origin, this.linkedIds());
    });
    this.watchLinkedProducts();
    this.watchPairCheck();
  }

  /** The product of the sheet is the origin; it is read from the API, so the form also opens from a bookmarked link. */
  private loadOrigin() {
    if (!this.fromProductId) return;
    this.products
      .detail(this.fromProductId)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (detail) => {
          this.origin.set(linkProductOfDetail(detail));
          this.originState.set('ready');
        },
        error: () => this.originState.set('error'),
      });
  }

  /** What the origin is already linked to, so those are not offered again. */
  private watchLinkedProducts() {
    toObservable(computed(() => this.origin()?.id ?? null))
      .pipe(
        tap(() => this.linkedIds.set(new Set())),
        switchMap((id) => (id ? this.products.equivalents(id, { page: 1, pageSize: 100 }).pipe(catchError(() => of(null))) : of(null))),
        takeUntilDestroyed(),
      )
      .subscribe((res) => this.linkedIds.set(new Set(res?.items.map((i) => i.productId) ?? [])));
  }

  /** Every pair is checked as soon as both products are chosen. */
  private watchPairCheck() {
    toObservable(computed(() => ({ a: this.origin()?.id ?? null, b: this.equivalent()?.id ?? null, again: this.revalidate() })))
      .pipe(
        tap(({ a, b }) => {
          this.validation.set(null);
          this.submitError.set(null);
          this.previewState.set(a && b && a !== b ? 'loading' : 'idle');
        }),
        switchMap(({ a, b }) => {
          if (!a || !b || a === b) return of(null);
          return this.equivalences.validate({ productAId: a, productBId: b }).pipe(
            map((validation) => ({ validation })),
            catchError((err) => of({ error: problemOf(err).message })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((result) => {
        if (!result) return;
        if ('error' in result) {
          this.submitError.set(result.error);
          this.previewState.set('error');
          return;
        }
        this.validation.set(result.validation);
        this.previewState.set('ready');
      });
  }

  private watchSearch(
    query: WritableSignal<string>,
    results: WritableSignal<readonly LinkProduct[] | null>,
    searching: WritableSignal<boolean>,
    keep: (product: LinkProduct) => boolean = () => true,
  ) {
    toObservable(query)
      .pipe(
        map((text) => text.trim()),
        distinctUntilChanged(),
        tap((text) => {
          if (!text) {
            results.set(null);
            searching.set(false);
          }
        }),
        debounceTime(SEARCH_DEBOUNCE_MS),
        switchMap((text) => {
          if (!text) return of(null);
          searching.set(true);
          return this.products.list({ search: text, status: 'ACTIVE', page: 1, pageSize: FETCH_SIZE }).pipe(
            map((res) => ({ items: res.items })),
            catchError(() => of({ failed: true as const })),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe((res) => {
        searching.set(false);
        if (!res) return;
        if ('failed' in res) {
          this.searchFailed.set(true);
          results.set([]);
          return;
        }
        this.searchFailed.set(false);
        results.set(res.items.map((item: ProductListItem) => linkProductOfListItem(item)).filter(keep).slice(0, RESULTS_LIMIT));
      });
  }

  protected setQuery(side: Side, text: string) {
    this.slots[side].query.set(text);
  }

  protected pick(side: Side, product: LinkProduct) {
    const slot = this.slots[side];
    slot.selected.set(product);
    slot.query.set('');
    slot.results.set(null);
  }

  protected clear(side: Side) {
    this.slots[side].selected.set(null);
  }

  protected onType(value: unknown) {
    this.substitute.set(value === 'SUBSTITUTE');
  }

  protected onNotes(text: string) {
    this.notes.set(text.slice(0, EQUIVALENCE_NOTES_MAX));
  }

  protected flagOf(product: LinkProduct) {
    return flagOf(product.country?.code);
  }

  protected thumbIcon(product: LinkProduct) {
    return thumbIconOf(product.categoryIcon);
  }

  protected measures(product: LinkProduct) {
    return measuresText(product.dimensions);
  }

  protected label(product: LinkProduct) {
    return productLabel(product);
  }

  protected cancel() {
    if (!this.saving()) this.leave();
  }

  protected save() {
    const a = this.origin();
    const b = this.equivalent();
    if (!a || !b || !this.canSave()) return;
    this.saving.set(true);
    this.submitError.set(null);
    this.equivalences
      .link({ productAId: a.id, productBId: b.id, substitute: this.substitute(), ...(this.notes().trim() ? { notes: this.notes().trim() } : {}) })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Equivalencia vinculada');
          this.leave();
        },
        error: (err: unknown) => {
          const problem = problemOf(err);
          this.saving.set(false);
          // someone linked or changed the pair meanwhile: show the current verdict instead of a bare error
          if (problem.code === 'EQUIVALENCE_EXISTS' || problem.code === 'EQUIVALENCE_INCOMPATIBLE') {
            this.revalidate.update((n) => n + 1);
            return;
          }
          this.submitError.set(problem.message);
        },
      });
  }

  /** Back to where the user came from: the sheet's equivalents, or the table. */
  private leave() {
    void this.router.navigate(this.fromProductId ? ['/inventory/products', this.fromProductId, 'equivalents'] : ['/inventory/equivalences']);
  }
}
