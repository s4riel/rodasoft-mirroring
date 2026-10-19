import { Route } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { ShellComponent } from './layout/shell.component';

const t = (s: string) => `${s} · ERP`;

const modulo = (path: string, titulo: string, sprint: string): Route => ({
  path,
  title: t(titulo),
  data: { titulo, sprint },
  loadComponent: () => import('./features/modulo/modulo.page').then((m) => m.ModuloPage),
});

export const routes: Route[] = [
  {
    path: 'login',
    title: t('Iniciar sesión'),
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'recuperar',
    title: t('Recuperar contraseña'),
    loadComponent: () => import('./features/auth/recuperar.page').then((m) => m.RecuperarPage),
  },
  {
    path: 'recuperar/restablecer',
    title: t('Nueva contraseña'),
    loadComponent: () => import('./features/auth/restablecer.page').then((m) => m.RestablecerPage),
  },
  {
    path: 'auth/callback',
    loadComponent: () => import('./features/auth/google-callback.page').then((m) => m.GoogleCallbackPage),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', title: t('Inicio'), loadComponent: () => import('./features/inicio/inicio.page').then((m) => m.InicioPage) },
      modulo('ventas', 'Ventas y POS', 'S2 (16–29 nov)'),
      modulo('facturacion', 'Facturación SIAT', 'S2–S3 (16 nov–13 dic)'),
      modulo('inventario', 'Inventario', 'S1 (2–15 nov)'),
      modulo('compras', 'Compras', 'S4 (5–18 ene)'),
      modulo('crm', 'CRM', 'S4 (5–18 ene)'),
      modulo('contabilidad', 'Contabilidad', 'S5 (19 ene–1 feb)'),
      modulo('tienda', 'Tienda en línea', 'S3 (30 nov–13 dic)'),
      modulo('reportes', 'Reportes', 'S5 (19 ene–1 feb)'),
      modulo('configuracion', 'Configuración', 'S1 (usuarios y roles)'),
    ],
  },
  { path: '**', redirectTo: '' },
];
