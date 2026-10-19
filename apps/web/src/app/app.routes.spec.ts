import { routes } from './app.routes';

describe('rutas del sitio', () => {
  it('incluye los 6 ítems del header y el carrito', () => {
    const paths = routes.map((r) => r.path);
    for (const p of ['', 'productos', 'marcas', 'sectores', 'nosotros', 'novedades', 'contacto', 'carrito']) {
      expect(paths).toContain(p);
    }
  });
});
