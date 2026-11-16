import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ToastService } from '@rodasoft/ui';
import { ContextStore } from '../../core/context.store';
import { canSeeInvoicingTab, type InvoicingTab } from './invoicing-tabs';

/**
 * Guard of an invoicing tab. Once the context is loaded, a user without any of the tab's permissions goes back to the invoices with a
 * message that says why. Before the context loads the guard lets the route through: the screens call the API, which checks the
 * permission on every request, so the UI guard is only a shortcut.
 */
export function requiresInvoicingTab(tab: InvoicingTab): CanActivateFn {
  return () => {
    const context = inject(ContextStore);
    if (!context.context()) return true;
    if (canSeeInvoicingTab(tab, (p) => context.permissions().has(p))) return true;
    inject(ToastService).warning('No tienes permiso para acceder a esta sección de facturación.');
    return inject(Router).createUrlTree(['/']);
  };
}
