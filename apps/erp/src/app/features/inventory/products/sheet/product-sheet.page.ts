import { toSignal } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import {
  ButtonComponent,
  CanDirective,
  EmptyStateIllustratedComponent,
  IconComponent,
  PageHeaderComponent,
  SkeletonComponent,
  StatusPillComponent,
  TabComponent,
  TabsComponent,
  ToastOutletComponent,
  ToastService,
} from '@rodasoft/ui';
import { filter, map, startWith } from 'rxjs';
import { formatMeasure } from '../product-list.mapper';
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
    ButtonComponent,
    CanDirective,
    EmptyStateIllustratedComponent,
    IconComponent,
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

  /** Edit and stock adjustment arrive with HU-INV-07 and HU-INV-16. */
  protected comingSoon() {
    this.toast.info('Esta acción estará disponible próximamente.');
  }
}
