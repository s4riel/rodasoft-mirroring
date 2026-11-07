import { Route } from '@angular/router';
import { requiresSalesPermission, requiresSalesTab, salesHomeRedirect } from './sales-permission.guard';
import { POS_TAB, SALES_TABS } from './sales-tabs';

/** Screens already built; every other tab is a placeholder until its story fills it (see `SALES_TABS`). */
const BUILT_TABS: Record<string, Pick<Route, 'loadComponent' | 'children'>> = {
  history: {
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./history/sales-history.page').then((m) => m.SalesHistoryPage) },
      {
        path: ':id/cancellation',
        title: 'Aprobar anulación · ERP',
        canActivate: [requiresSalesPermission('sales.cancellations.approve', 'No tienes permiso para decidir anulaciones de ventas.')],
        loadComponent: () => import('./history/sale-cancellation-review.page').then((m) => m.SaleCancellationReviewPage),
      },
      { path: ':id', title: 'Venta · ERP', loadComponent: () => import('./history/sale-detail.page').then((m) => m.SaleDetailPage) },
    ],
  },
  quotes: {
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./quotes/quotes.page').then((m) => m.QuotesPage) },
      {
        path: 'new',
        title: 'Nueva cotización · ERP',
        loadComponent: () => import('./quotes/quote-form.page').then((m) => m.QuoteFormPage),
      },
      { path: ':id', title: 'Cotización · ERP', loadComponent: () => import('./quotes/quote-detail.page').then((m) => m.QuoteDetailPage) },
    ],
  },
  orders: {
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./orders/orders.page').then((m) => m.OrdersPage) },
      { path: ':id', title: 'Pedido · ERP', loadComponent: () => import('./orders/order-detail.page').then((m) => m.OrderDetailPage) },
    ],
  },
  customers: { loadComponent: () => import('./customers/customers.page').then((m) => m.CustomersPage) },
  'cash-register': {
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./cash/cash-register.page').then((m) => m.CashRegisterPage) },
      { path: 'open', title: 'Apertura de caja · ERP', loadComponent: () => import('./cash/cash-opening.page').then((m) => m.CashOpeningPage) },
    ],
  },
};

/**
 * The point of sale is full screen, routed next to the shell in `app.routes.ts` (HU-VEN-02), so it is left out here.
 * The tab route is guarded with the tab's permissions, so a screen the user cannot use is not reachable by typing its URL
 * either.
 */
const tabRoutes: Route[] = SALES_TABS.filter((tab) => tab.key !== POS_TAB.key).map((tab) => ({
  path: tab.path,
  title: `${tab.label} · ERP`,
  canActivate: [requiresSalesTab(tab)],
  data: { title: tab.label, sprint: `la historia ${tab.story}` },
  ...(BUILT_TABS[tab.key] ?? {
    loadComponent: () => import('../module-placeholder/module-placeholder.page').then((m) => m.ModulePlaceholderPage),
  }),
}));

export const SALES_ROUTES: Route[] = [
  {
    path: '',
    loadComponent: () => import('./sales-layout.page').then((m) => m.SalesLayoutPage),
    children: [{ path: '', pathMatch: 'full', redirectTo: salesHomeRedirect }, ...tabRoutes],
  },
];
