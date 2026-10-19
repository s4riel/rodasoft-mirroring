import { routes } from './app.routes';

describe('rutas del ERP', () => {
  it('protege el shell con authGuard y expone las pantallas de acceso', () => {
    const shell = routes.find((r) => r.path === '' && r.children);
    expect(shell?.canActivate?.length).toBe(1);
    expect(routes.map((r) => r.path)).toEqual(
      expect.arrayContaining(['login', 'recuperar', 'recuperar/restablecer', 'auth/callback']),
    );
  });

  it('tiene una ruta por cada ítem del menú', () => {
    const children = routes.find((r) => r.path === '' && r.children)?.children?.map((c) => c.path) ?? [];
    for (const p of ['', 'ventas', 'facturacion', 'inventario', 'compras', 'crm', 'contabilidad', 'tienda', 'reportes', 'configuracion']) {
      expect(children).toContain(p);
    }
  });
});
