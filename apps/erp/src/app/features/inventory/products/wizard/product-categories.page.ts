import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import type { ProductFilterOptions } from '@rodasoft/domain';
import {
  ButtonComponent,
  ICON_NAMES,
  type IconName,
  EmptyStateIllustratedComponent,
  IconComponent,
  NoteComponent,
  PageHeaderComponent,
  CategoryCardComponent,
  SkeletonComponent,
} from '@rodasoft/ui';
import { ProductsApi } from '../products-api.service';

/** IN-03a · New product: one card per root category; the subcategory is chosen on the first wizard step. */
@Component({
  selector: 'rs-product-categories-page',
  imports: [
    ButtonComponent,
    EmptyStateIllustratedComponent,
    IconComponent,
    NoteComponent,
    PageHeaderComponent,
    CategoryCardComponent,
    ReactiveFormsModule,
    RouterLink,
    SkeletonComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-categories.page.html',
  styleUrl: './product-categories.page.scss',
})
export class ProductCategoriesPage {
  private readonly api = inject(ProductsApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly breadcrumbs = [
    { label: 'Inicio', link: '/' },
    { label: 'Inventario', link: '/inventory' },
    { label: 'Productos', link: '/inventory/products' },
    { label: 'Nuevo producto' },
  ];
  protected readonly skeletonRows = Array.from({ length: 8 }, (_, i) => i);
  protected readonly selected = new FormControl<string | null>(null);

  /** Arrow keys move to the next or previous card and select it, as a radio group does. */
  protected onCardKey(event: KeyboardEvent) {
    const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
    if (!keys.includes(event.key)) return;
    const card = event.currentTarget as HTMLElement;
    const cards = Array.from(card.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]:not([aria-disabled="true"])') ?? []);
    const current = cards.indexOf(card);
    if (current < 0) return;
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = cards[(current + step + cards.length) % cards.length];
    event.preventDefault();
    next.focus();
    next.click();
  }

  /** Chooses the category of a card; the form keeps the one selected card. */
  protected select(id: string) {
    this.selected.setValue(id);
  }
  protected readonly options = signal<ProductFilterOptions | null>(null);
  protected readonly state = signal<'loading' | 'ready' | 'error'>('loading');
  protected readonly categories = computed(() => this.options()?.categories ?? []);

  constructor() {
    this.load();
  }

  protected subcategoryCount(count: number): string {
    if (count === 0) return 'Sin subcategorías';
    return count === 1 ? '1 subcategoría' : `${count} subcategorías`;
  }

  /** Category icons come from the API as text; anything outside the icon set falls back to the package icon. */
  protected iconOf(icon: string): IconName {
    return (ICON_NAMES as string[]).includes(icon) ? (icon as IconName) : 'package';
  }

  protected load() {
    this.state.set('loading');
    this.api
      .filterOptions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.options.set(options);
          this.state.set('ready');
        },
        error: () => this.state.set('error'),
      });
  }

  protected cancel() {
    void this.router.navigate(['/inventory/products']);
  }

  protected next() {
    const id = this.selected.value;
    if (!id) return;
    void this.router.navigate(['/inventory/products/new', id]);
  }
}
