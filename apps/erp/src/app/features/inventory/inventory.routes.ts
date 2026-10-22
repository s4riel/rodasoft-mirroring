import { Route } from '@angular/router';
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
      PRODUCT_SHEET_ROUTE,
    ],
  },
];
