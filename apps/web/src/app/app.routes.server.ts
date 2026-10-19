import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Render por solicitud: la marca (Rodalaser / Empresa 2) depende del Host.
 * Si cada marca tuviera su propio build, las páginas institucionales podrían pasar a RenderMode.Prerender.
 */
export const serverRoutes: ServerRoute[] = [
  { path: 'carrito', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Server },
];
