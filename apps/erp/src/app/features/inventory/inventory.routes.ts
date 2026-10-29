import { Route } from '@angular/router';
import { requiresPermission } from '../../core/auth/permission.guard';
import { PRODUCT_SHEET_ROUTE } from './products/sheet/product-sheet.routes';
import { unsavedTransferGuard } from './transfers/unsaved-transfer.guard';

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
      {
        path: 'equivalences/new',
        canActivate: [requiresPermission('inventory.equivalences.link')],
        title: 'Vincular equivalencia · ERP',
        loadComponent: () => import('./equivalences/link/equivalence-link.page').then((m) => m.EquivalenceLinkPage),
      },
      {
        // the page shows its own no-permission state, as the product list does
        path: 'warehouses',
        title: 'Almacenes · ERP',
        loadComponent: () => import('./warehouses/warehouses.page').then((m) => m.WarehousesPage),
      },
      {
        // the forms show their own no-permission state: the shared guard words its message for products
        path: 'warehouses/new',
        title: 'Nuevo almacén · ERP',
        loadComponent: () => import('./warehouses/warehouse-form.page').then((m) => m.WarehouseFormPage),
      },
      {
        path: 'warehouses/:id/edit',
        title: 'Editar almacén · ERP',
        loadComponent: () => import('./warehouses/warehouse-form.page').then((m) => m.WarehouseFormPage),
      },
      {
        // the pages show their own no-permission state, as the warehouse list does
        path: 'transfers',
        title: 'Transferencias · ERP',
        loadComponent: () => import('./transfers/transfers.page').then((m) => m.TransfersPage),
      },
      {
        // before `transfers/:id`, which would otherwise take "incoming" for an id
        path: 'transfers/incoming',
        title: 'Por recibir · ERP',
        loadComponent: () => import('./transfers/transfers-incoming.page').then((m) => m.TransfersIncomingPage),
      },
      {
        path: 'transfers/new',
        title: 'Nueva transferencia · ERP',
        canDeactivate: [unsavedTransferGuard],
        loadComponent: () => import('./transfers/transfer-editor.page').then((m) => m.TransferEditorPage),
      },
      {
        path: 'transfers/:id/edit',
        title: 'Editar transferencia · ERP',
        canDeactivate: [unsavedTransferGuard],
        loadComponent: () => import('./transfers/transfer-editor.page').then((m) => m.TransferEditorPage),
      },
      {
        path: 'transfers/:id',
        title: 'Transferencia · ERP',
        loadComponent: () => import('./transfers/transfer-detail.page').then((m) => m.TransferDetailPage),
      },
      {
        // the pages show their own no-permission state, as the transfer list does
        path: 'adjustments',
        title: 'Ajustes · ERP',
        loadComponent: () => import('./adjustments/adjustments.page').then((m) => m.AdjustmentsPage),
      },
      {
        // before `adjustments/:id`, which would otherwise take "new" for an id
        path: 'adjustments/new',
        title: 'Nuevo ajuste · ERP',
        canDeactivate: [unsavedTransferGuard],
        loadComponent: () => import('./adjustments/adjustment-editor.page').then((m) => m.AdjustmentEditorPage),
      },
      {
        path: 'adjustments/:id',
        title: 'Ajuste · ERP',
        loadComponent: () => import('./adjustments/adjustment-detail.page').then((m) => m.AdjustmentDetailPage),
      },
      {
        // the page shows its own no-permission state, as the adjustment list does
        path: 'kardex',
        title: 'Kardex · ERP',
        loadComponent: () => import('./kardex/kardex.page').then((m) => m.KardexPage),
      },
      PRODUCT_SHEET_ROUTE,
    ],
  },
];
