import { Route } from '@angular/router';

/** Product sheet at `/inventory/products/:id`: "Datos" by default, then "Equivalentes", "Movimientos" and "Stock por almacén". */
export const PRODUCT_SHEET_ROUTE: Route = {
  path: 'products/:id',
  title: 'Producto · ERP',
  loadComponent: () => import('./product-sheet.page').then((m) => m.ProductSheetPage),
  children: [
    { path: '', loadComponent: () => import('./product-data.tab').then((m) => m.ProductDataTab) },
    {
      path: 'equivalents',
      loadComponent: () => import('./equivalents/product-equivalents.tab').then((m) => m.ProductEquivalentsTab),
    },
    {
      path: 'movements',
      loadComponent: () => import('./movements/product-movements.tab').then((m) => m.ProductMovementsTab),
    },
    {
      path: 'stock',
      loadComponent: () => import('./stock/product-stock.tab').then((m) => m.ProductStockTab),
    },
  ],
};
