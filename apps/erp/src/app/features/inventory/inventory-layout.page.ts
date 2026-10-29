import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { SubNavComponent, SubNavItem } from '@rodasoft/ui';
import { catchError, debounceTime, filter, merge, of, switchMap } from 'rxjs';
import { ContextStore } from '../../core/context.store';
import { TransfersApi } from './transfers/transfers-api.service';

/** Inventory section: sub-navigation (Figma SubNav) + the active tab. Tabs of later stories stay disabled. */
@Component({
  selector: 'rs-inventory-layout-page',
  imports: [RouterOutlet, SubNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rs-sub-nav [items]="tabs()" label="Secciones de inventario" />
    <router-outlet />
  `,
  styles: `
    :host { display: grid; gap: var(--space-6); }
  `,
})
export class InventoryLayoutPage {
  private readonly ctx = inject(ContextStore);
  private readonly transfers = inject(TransfersApi);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Transfers still open (the Figma badge on the Transferencias tab); 0 hides it. */
  private readonly openTransfers = signal(0);

  protected readonly tabs = computed<SubNavItem[]>(() => [
    { key: 'products', label: 'Productos', route: '/inventory/products' },
    { key: 'equivalences', label: 'Equivalencias', route: '/inventory/equivalences' },
    { key: 'warehouses', label: 'Almacenes', route: '/inventory/warehouses' },
    { key: 'transfers', label: 'Transferencias', route: '/inventory/transfers', badge: this.openTransfers() || undefined },
    { key: 'adjustments', label: 'Ajustes', disabled: true },
    { key: 'kardex', label: 'Kardex', disabled: true },
  ]);

  constructor() {
    // the count changes when a transfer is sent or closed on one of the tabs, so it is read on every navigation, and again
    // when the permissions arrive (on a page load they can land after the first navigation). The two triggers fire together
    // at startup, so they are merged into one read.
    const navigated$ = this.router.events.pipe(filter((e) => e instanceof NavigationEnd));
    merge(navigated$, toObservable(this.ctx.permissions))
      .pipe(
        debounceTime(0),
        switchMap(() =>
          this.canSeeTransfers()
            ? this.transfers.openCount().pipe(catchError(() => of({ count: 0 })))
            : of({ count: 0 }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ count }) => this.openTransfers.set(count));
  }

  private canSeeTransfers(): boolean {
    return this.ctx.can('inventory.transfers.create') || this.ctx.can('inventory.transfers.receive');
  }
}
