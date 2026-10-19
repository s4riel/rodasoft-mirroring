import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Rutas internas: si no hay token en memoria, intenta renovar con la cookie antes de mandar al login. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated()) return true;
  if (await auth.refresh()) return true;
  return router.createUrlTree(['/login'], { queryParams: state.url !== '/' ? { returnUrl: state.url } : {} });
};

/** Pantallas de acceso: si ya hay sesión válida, ir al inicio. */
export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.isAuthenticated() || (await auth.refresh())) return router.createUrlTree(['/']);
  return true;
};
