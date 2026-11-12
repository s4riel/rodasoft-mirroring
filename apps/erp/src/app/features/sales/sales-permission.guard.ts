import { inject } from '@angular/core';
import { CanActivateFn, RedirectFunction, Router } from '@angular/router';
import { ToastService } from '@rodasoft/ui';
import { ContextStore } from '../../core/context.store';
import { canSeeSalesTab, SALES_TABS, SalesTab } from './sales-tabs';

/**
 * Guard of a sales tab. Once the context is loaded, a user without any of the tab's permissions goes back home with a
 * message that says why. Before the context loads the guard lets the route through: the screens call the API, which checks
 * the permission on every request (@RequirePermissions), so the UI guard is only a shortcut.
 */
export function requiresSalesTab(tab: SalesTab): CanActivateFn {
  return () => {
    const context = inject(ContextStore);
    if (!context.context()) return true;
    if (canSeeSalesTab(tab, (p) => context.permissions().has(p))) return true;
    inject(ToastService).warning('No tienes permiso para acceder a esta sección de ventas.');
    return inject(Router).createUrlTree(['/']);
  };
}

/**
 * Guard of a screen inside a tab that needs one more permission (the page where Management decides a cancellation). Same
 * shortcut as the tab guard: the API checks the permission on every request.
 */
export function requiresSalesPermission(permission: string, message: string): CanActivateFn {
  return () => {
    const context = inject(ContextStore);
    if (!context.context()) return true;
    if (context.permissions().has(permission)) return true;
    inject(ToastService).warning(message);
    return inject(Router).createUrlTree(['/sales/history']);
  };
}

/** `/sales` opens the first tab the user may see (the point of sale for a cashier), or home when there is none. */
export const salesHomeRedirect: RedirectFunction = () => {
  const context = inject(ContextStore);
  if (!context.context()) return `/sales/${SALES_TABS[0].path}`;
  const first = SALES_TABS.find((tab) => canSeeSalesTab(tab, (p) => context.permissions().has(p)));
  return first ? `/sales/${first.path}` : '/';
};

/**
 * `/sales/cash-register` is the cashier's own shift. Who only reviews differences (no `sales.cash-register.open`) has none, so
 * the tab takes them to the shift history instead.
 */
export const cashRegisterEntry: CanActivateFn = () => {
  const context = inject(ContextStore);
  if (!context.context()) return true;
  const permissions = context.permissions();
  if (permissions.has('sales.cash-register.open') || !permissions.has('sales.cash-register.review')) return true;
  return inject(Router).createUrlTree(['/sales/cash-register/history']);
};
