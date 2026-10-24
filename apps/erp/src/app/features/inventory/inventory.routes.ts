import { Route } from '@angular/router';
import { requiresPermission } from '../../core/auth/permission.guard';
import { PRODUCT_SHEET_ROUTE } from './products/sheet/product-sheet.routes';

export const INVENTORY_ROUTES: Route[] = [
  {
    path: '',
    loadComponent: () => import('./inventory-layout.page').then((m) => m.InventoryLayoutPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'products' },
      {
        path: 'products',
        title: 'Productos · ERP',
        loadComponent: () => import('./products/products.page').then((m) => m.ProductsPage),
      },
      {
        path: 'products/new',
        canActivate: [requiresPermission('inventory.products.edit')],
        title: 'Nuevo producto · ERP',
        loadComponent: () =>
          import('./products/wizard/product-categories.page').then((m) => m.ProductCategoriesPage),
      },
      {
        path: 'products/new/:categoryId',
        canActivate: [requiresPermission('inventory.products.edit')],
        title: 'Nuevo producto · ERP',
        loadComponent: () => import('./products/wizard/product-wizard.page').then((m) => m.ProductWizardPage),
      },
      {
        path: 'products/:id/draft',
        canActivate: [requiresPermission('inventory.products.edit')],
        title: 'Borrador · ERP',
        loadComponent: () => import('./products/wizard/product-wizard.page').then((m) => m.ProductWizardPage),
      },
      {
        path: 'products/:id/edit',
        canActivate: [requiresPermission('inventory.products.edit')],
        title: 'Editar producto · ERP',
        data: { mode: 'edit' },
        loadComponent: () => import('./products/wizard/product-wizard.page').then((m) => m.ProductWizardPage),
      },
      {
        path: 'products/:id/created',
        canActivate: [requiresPermission('inventory.products.edit')],
        title: 'Producto creado · ERP',
        loadComponent: () => import('./products/wizard/product-created.page').then((m) => m.ProductCreatedPage),
      },
      {
        // the page shows its own no-permission state, as the product list does
        path: 'equivalences',
        title: 'Equivalencias · ERP',
        loadComponent: () => import('./equivalences/equivalences.page').then((m) => m.EquivalencesPage),
      },
      {
        // the page shows its own no-permission state, as the equivalence table does
        path: 'equivalences/compare',
        title: 'Comparar equivalentes · ERP',
        loadComponent: () => import('./equivalences/compare/equivalence-compare.page').then((m) => m.EquivalenceComparePage),
      },
      PRODUCT_SHEET_ROUTE,
    ],
  },
];
