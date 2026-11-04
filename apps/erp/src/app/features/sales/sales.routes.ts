import { Route } from '@angular/router';
import { requiresSalesTab, salesHomeRedirect } from './sales-permission.guard';
import { POS_TAB, SALES_TABS } from './sales-tabs';

/** Screens already built; every other tab is a placeholder until its story fills it (see `SALES_TABS`). */
const BUILT_TABS: Record<string, Pick<Route, 'loadComponent' | 'children'>> = {
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
