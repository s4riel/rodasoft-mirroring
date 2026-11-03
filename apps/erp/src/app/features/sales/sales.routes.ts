import { Route } from '@angular/router';
import { requiresSalesTab, salesHomeRedirect } from './sales-permission.guard';
import { SALES_TABS } from './sales-tabs';

/**
 * Every tab is a placeholder until its story fills it (see `SALES_TABS`). The tab route is guarded with the tab's
 * permissions, so a screen the user cannot use is not reachable by typing its URL either.
 */
const tabRoutes: Route[] = SALES_TABS.map((tab) => ({
  path: tab.path,
  title: `${tab.label} · ERP`,
  canActivate: [requiresSalesTab(tab)],
  data: { title: tab.label, sprint: `la historia ${tab.story}` },
  loadComponent: () => import('../module-placeholder/module-placeholder.page').then((m) => m.ModulePlaceholderPage),
}));

export const SALES_ROUTES: Route[] = [
  {
    path: '',
    loadComponent: () => import('./sales-layout.page').then((m) => m.SalesLayoutPage),
    children: [{ path: '', pathMatch: 'full', redirectTo: salesHomeRedirect }, ...tabRoutes],
  },
];
