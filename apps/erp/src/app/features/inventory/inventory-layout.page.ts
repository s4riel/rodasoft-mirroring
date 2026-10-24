import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SubNavComponent, SubNavItem } from '@rodasoft/ui';

/** Inventory section: sub-navigation (Figma SubNav) + the active tab. Tabs of later stories stay disabled. */
@Component({
  selector: 'rs-inventory-layout-page',
  imports: [RouterOutlet, SubNavComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <rs-sub-nav [items]="tabs" label="Secciones de inventario" />
    <router-outlet />
  `,
  styles: `
    :host { display: grid; gap: var(--space-6); }
  `,
})
export class InventoryLayoutPage {
  protected readonly tabs: SubNavItem[] = [
    { key: 'products', label: 'Productos', route: '/inventory/products' },
    { key: 'equivalences', label: 'Equivalencias', route: '/inventory/equivalences' },
    { key: 'warehouses', label: 'Almacenes', disabled: true },
    { key: 'transfers', label: 'Transferencias', disabled: true },
    { key: 'adjustments', label: 'Ajustes', disabled: true },
    { key: 'kardex', label: 'Kardex', disabled: true },
  ];
}
