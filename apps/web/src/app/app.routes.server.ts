import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Render per request: the brand (Rodalaser / Company 2) depends on the Host.
 * If each brand had its own build, the institutional pages could move to RenderMode.Prerender.
 */
export const serverRoutes: ServerRoute[] = [
  { path: 'carrito', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Server },
];
