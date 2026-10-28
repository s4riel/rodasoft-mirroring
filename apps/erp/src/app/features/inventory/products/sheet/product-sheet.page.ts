import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import {
  ButtonComponent,
  CanDirective,
  EmptyStateIllustratedComponent,
  IconComponent,
  NoteComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
  TabComponent,
  TabsComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import type { ProductFilterOptions } from '@rodasoft/domain';
import { filter, map, startWith } from 'rxjs';
import { problemOf } from '../../../../core/api-error';
import { DeactivateProductDialog } from '../deactivate-product.dialog';
import { AdjustStockDialog } from './adjust-stock/adjust-stock.dialog';
import { DuplicateProductDialog } from '../duplicate-product.dialog';
import { formatMeasure } from '../product-list.mapper';
import { ProductsApi } from '../products-api.service';
import { formatDate } from './product-sheet.mapper';
import { ProductSheetStore } from './product-sheet.store';

export type SheetTab = 'data' | 'equivalents' | 'movements' | 'stock';

const TAB_PATHS: Record<SheetTab, string> = { data: '', equivalents: 'equivalents', movements: 'movements', stock: 'stock' };

/**
 * IN-02a · Product sheet: header, tabs and the routed tab page. "Datos" is the default child route;
 * Equivalentes (HU-INV-04), Movimientos and Stock por almacén (HU-INV-05) are routed tabs.
 */
@Component({
  selector: 'rs-product-sheet-page',
  imports: [
    AdjustStockDialog,
    ButtonComponent,
    CanDirective,
    DeactivateProductDialog,
    DuplicateProductDialog,
    EmptyStateIllustratedComponent,
    IconComponent,
    NoteComponent,
    PageHeaderComponent,
    RouterLink,
    RouterOutlet,
    SkeletonComponent,
    StatusPillComponent,
    TabComponent,
    TabsComponent,
    ToastOutletComponent,
  ],
  providers: [ProductSheetStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-sheet.page.html',
  styleUrl: './product-sheet.page.scss',
})
export class ProductSheetPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly api = inject(ProductsApi);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly store = inject(ProductSheetStore);

  private readonly childPath = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => this.route.firstChild?.snapshot?.routeConfig?.path ?? ''),
    ),
    { initialValue: '' },
  );

  protected readonly tab = computed<SheetTab>(() => {
    const path = this.childPath();
    return (Object.keys(TAB_PATHS) as SheetTab[]).find((t) => TAB_PATHS[t] === path) ?? 'data';
  });

  protected readonly breadcrumbs = computed(() => [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Productos', link: '/inventory/products' },
    { label: this.store.product()?.manufacturerCode ?? '' },
  ]);

  protected readonly subtitle = computed(() => {
    const p = this.store.product();
    if (!p) return '';
    const kind = (p.subcategory ?? p.category).name;
    if (this.tab() === 'equivalents') {
      const m = p.dimensions;
      const measure = m ? `${[m.innerDiameter, m.outerDiameter, m.width].map(formatMeasure).join('×')} mm` : null;
      return [p.brand.name, measure, kind].filter(Boolean).join(' · ');
    }
    const who = p.createdBy ? ` por ${p.createdBy.name}` : '';
    return `${kind} · ${p.brand.name} · registrado el ${formatDate(p.createdAt)}${who}`;
  });

  protected setTab(tab: string | undefined) {
    const next = (Object.keys(TAB_PATHS) as SheetTab[]).find((t) => t === tab) ?? 'data';
    void this.router.navigate(next === 'data' ? ['./'] : [TAB_PATHS[next]], { relativeTo: this.route });
  }

  /** IN-20 · Opens the edit wizard (HU-INV-07). */
  protected edit() {
    const id = this.store.product()?.id;
    if (id) void this.router.navigate(['/inventory/products', id, 'edit']);
  }

  protected readonly duplicateOpen = signal(false);
  protected readonly duplicateOptions = signal<ProductFilterOptions>({ countries: [], brands: [], categories: [] });
  private optionsLoaded = false;
  private optionsLoading = false;

  /** IN-19 · Opens the duplicate dialog for this product. The brand and industry options load the first time, before it opens. */
  protected duplicate() {
    if (this.optionsLoaded) {
      this.duplicateOpen.set(true);
      return;
    }
    if (this.optionsLoading) return;
    this.optionsLoading = true;
    this.api
      .filterOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.optionsLoading = false;
          this.optionsLoaded = true;
          this.duplicateOptions.set(options);
          this.duplicateOpen.set(true);
        },
        error: () => {
          this.optionsLoading = false;
          this.toast.danger('No pudimos cargar las marcas e industrias. Inténtalo de nuevo.');
        },
      });
  }

  protected readonly deactivateOpen = signal(false);
  protected readonly reactivating = signal(false);

  /** IN-18a · Opens the deactivate dialog. */
  protected deactivate() {
    this.deactivateOpen.set(true);
  }

  /** Reactivating needs no confirmation: it only makes the product sellable again. */
  protected reactivate() {
    const id = this.store.product()?.id;
    if (!id || this.reactivating()) return;
    this.reactivating.set(true);
    this.api.reactivate(id).subscribe({
      next: () => {
        this.reactivating.set(false);
        this.toast.success('Producto reactivado');
        this.store.retry();
      },
      error: (err: unknown) => {
        this.reactivating.set(false);
        this.toast.danger(problemOf(err).message);
        this.store.retry();
      },
    });
  }

  protected readonly adjustOpen = signal(false);

  /** IN-17 · Opens the quick stock adjustment. */
  protected adjustStock() {
    this.adjustOpen.set(true);
  }
}
