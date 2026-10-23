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
        path: 'products/:id/created',
        canActivate: [requiresPermission('inventory.products.edit')],
        title: 'Producto creado · ERP',
        loadComponent: () => import('./products/wizard/product-created.page').then((m) => m.ProductCreatedPage),
      },
      PRODUCT_SHEET_ROUTE,
    ],
  },
];
