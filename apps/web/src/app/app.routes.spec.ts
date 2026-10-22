import { routes } from './app.routes';

describe('site routes', () => {
  it('includes the 6 header items and the cart', () => {
    const paths = routes.map((r) => r.path);
    for (const p of ['', 'productos', 'marcas', 'sectores', 'nosotros', 'novedades', 'contacto', 'carrito']) {
      expect(paths).toContain(p);
    }
  });
});
