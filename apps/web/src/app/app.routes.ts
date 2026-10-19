import { Route } from '@angular/router';

const seccion = (path: string, titulo: string, entrega: string): Route => ({
  path,
  title: `${titulo} · Rodalaser`,
  data: { titulo, entrega },
  loadComponent: () => import('./pages/seccion/seccion.page').then((m) => m.SeccionPage),
});

/** Arquitectura de información del sitio: header de 6 ítems + carrito (design-system, Site/Header). */
export const routes: Route[] = [
  { path: '', title: 'Rodalaser · Rodamientos en Bolivia', loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage) },
  seccion('productos', 'Productos', 'S3: catálogo con filtros por marca, sector y medida'),
  seccion('marcas', 'Marcas', 'S3'),
  seccion('sectores', 'Sectores', 'S3'),
  seccion('nosotros', 'Nosotros', 'S3: video de fondo y contenido al hacer scroll'),
  seccion('novedades', 'Novedades', 'S3'),
  seccion('contacto', 'Contacto', 'S3: mapa de Bolivia con las sucursales'),
  seccion('carrito', 'Carrito', 'S3: carrito y checkout con QR, tarjeta y transferencia'),
  { path: '**', redirectTo: '' },
];
