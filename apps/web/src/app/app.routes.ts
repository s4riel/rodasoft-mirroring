import { Route } from '@angular/router';

const section = (path: string, title: string, delivery: string): Route => ({
  path,
  title: `${title} · Rodalaser`,
  data: { title, delivery },
  loadComponent: () => import('./pages/section/section.page').then((m) => m.SectionPage),
});

/** Site information architecture: 6-item header + cart (design-system, Site/Header). */
export const routes: Route[] = [
  { path: '', title: 'Rodalaser · Rodamientos en Bolivia', loadComponent: () => import('./pages/home/home.page').then((m) => m.HomePage) },
  section('productos', 'Productos', 'S3: catálogo con filtros por marca, sector y medida'),
  section('marcas', 'Marcas', 'S3'),
  section('sectores', 'Sectores', 'S3'),
  section('nosotros', 'Nosotros', 'S3: video de fondo y contenido al hacer scroll'),
  section('novedades', 'Novedades', 'S3'),
  section('contacto', 'Contacto', 'S3: mapa de Bolivia con las sucursales'),
  section('carrito', 'Carrito', 'S3: carrito y checkout con QR, tarjeta y transferencia'),
  { path: '**', redirectTo: '' },
];
