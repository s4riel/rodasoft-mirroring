import { routes } from './app.routes';

describe('ERP routes', () => {
  it('guards the shell with authGuard and exposes the access screens', () => {
    const shell = routes.find((r) => r.path === '' && r.children);
    expect(shell?.canActivate?.length).toBe(1);
    expect(routes.map((r) => r.path)).toEqual(
      expect.arrayContaining(['login', 'forgot-password', 'reset-password', 'auth/callback']),
    );
  });

  it('has one route per menu item', () => {
    const children = routes.find((r) => r.path === '' && r.children)?.children?.map((c) => c.path) ?? [];
    for (const p of ['', 'sales', 'invoicing', 'inventory', 'purchasing', 'crm', 'accounting', 'store', 'reports', 'settings']) {
      expect(children).toContain(p);
    }
  });
});
