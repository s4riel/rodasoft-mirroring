import { Route } from '@angular/router';

/** Product sheet at `/inventory/products/:id`: "Datos" by default, plus the two placeholder tabs. */
export const PRODUCT_SHEET_ROUTE: Route = {
  path: 'products/:id',
  title: 'Producto · ERP',
  loadComponent: () => import('./product-sheet.page').then((m) => m.ProductSheetPage),
  children: [
    { path: '', loadComponent: () => import('./product-data.tab').then((m) => m.ProductDataTab) },
    {
      path: 'equivalents',
      data: { kind: 'equivalents' },
      loadComponent: () => import('./product-placeholder.tab').then((m) => m.ProductPlaceholderTab),
    },
    {
      path: 'movements',
      data: { kind: 'movements' },
      loadComponent: () => import('./product-placeholder.tab').then((m) => m.ProductPlaceholderTab),
    },
  ],
};
