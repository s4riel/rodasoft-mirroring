import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ToastService } from '@rodasoft/ui';
import { ContextStore } from '../context.store';

/**
 * Route guard for screens that need one permission. Once the context is loaded, a user without the permission goes back
 * to the product list with a message that says why. Before the context loads the guard lets the route through: the
 * screens call the API, which checks the permission on every request (@RequirePermissions), so the UI guard is only a
 * shortcut.
 */
export function requiresPermission(permission: string): CanActivateFn {
  return () => {
    const context = inject(ContextStore);
    if (!context.context()) return true;
    if (context.permissions().has(permission)) return true;
    inject(ToastService).warning('No tienes permiso para crear o editar productos.');
    return inject(Router).createUrlTree(['/inventory/products']);
  };
}
