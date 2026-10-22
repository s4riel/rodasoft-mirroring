import { isDevMode } from '@angular/core';
import { Route } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';
import { ShellComponent } from './layout/shell.component';

const t = (s: string) => `${s} · ERP`;

const modulePlaceholder = (path: string, title: string, sprint: string): Route => ({
  path,
  title: t(title),
  data: { title, sprint },
  loadComponent: () =>
    import('./features/module-placeholder/module-placeholder.page').then((m) => m.ModulePlaceholderPage),
});

export const routes: Route[] = [
  {
    path: 'login',
    title: t('Iniciar sesión'),
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'forgot-password',
    title: t('Recuperar contraseña'),
    loadComponent: () => import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    title: t('Nueva contraseña'),
    loadComponent: () => import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage),
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
      { path: '', title: t('Inicio'), loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage) },
      modulePlaceholder('sales', 'Ventas y POS', 'S2 (16–29 nov)'),
      modulePlaceholder('invoicing', 'Facturación SIAT', 'S2–S3 (16 nov–13 dic)'),
      {
        path: 'inventory',
        loadChildren: () => import('./features/inventory/inventory.routes').then((m) => m.INVENTORY_ROUTES),
      },
      modulePlaceholder('purchasing', 'Compras', 'S4 (5–18 ene)'),
      modulePlaceholder('crm', 'CRM', 'S4 (5–18 ene)'),
      modulePlaceholder('accounting', 'Contabilidad', 'S5 (19 ene–1 feb)'),
      modulePlaceholder('store', 'Tienda en línea', 'S3 (30 nov–13 dic)'),
      modulePlaceholder('reports', 'Reportes', 'S5 (19 ene–1 feb)'),
      modulePlaceholder('settings', 'Configuración', 'S1 (usuarios y roles)'),
    ],
  },
  {
    // Component catalog, development only (compare against the Figma Design System)
    path: 'design-system',
    title: t('Design System'),
    canMatch: [() => isDevMode()],
    loadComponent: () => import('./features/design-system/design-system.page').then((m) => m.DesignSystemPage),
  },
  { path: '**', redirectTo: '' },
];
