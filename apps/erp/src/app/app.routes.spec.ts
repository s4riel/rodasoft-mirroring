import type { Route } from '@angular/router';
import { routes } from './app.routes';

describe('ERP routes', () => {
  it('guards the shell with authGuard and exposes the access screens', () => {
    const shell = routes.find((r) => r.path === '' && r.children);
    expect(shell?.canActivate?.length).toBe(1);
    expect(routes.map((r) => r.path)).toEqual(
      expect.arrayContaining(['login', 'forgot-password', 'reset-password', 'auth/callback']),
    );
  });

  it('loads the sales section lazily, with its tabs behind permissions', async () => {
    const sales = routes.find((r) => r.path === '' && r.children)?.children?.find((c) => c.path === 'sales');
    expect(sales?.loadChildren).toBeDefined();
    const children = (await (sales?.loadChildren as () => Promise<Route[]>)()) as Route[];
    const tabs = children[0].children ?? [];
    const guarded = tabs.filter((t) => t.path);
    expect(guarded.map((t) => t.path)).toEqual(['pos', 'quotes', 'orders', 'history', 'returns', 'cash-register', 'prices', 'approvals']);
    expect(guarded.every((t) => t.canActivate?.length === 1)).toBe(true);
  });

  it('has one route per menu item', () => {
    const children = routes.find((r) => r.path === '' && r.children)?.children?.map((c) => c.path) ?? [];
    for (const p of ['', 'sales', 'invoicing', 'inventory', 'purchasing', 'crm', 'accounting', 'store', 'reports', 'settings']) {
      expect(children).toContain(p);
    }
  });
});
