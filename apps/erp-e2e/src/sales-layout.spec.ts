import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-00 · sales section shell. The administrator sees every tab. The seed has no cashier user, so the cashier case
 * answers `/api/v1/context` with the permissions of the default Cajero role (libs/domain `DEFAULT_ROLES.cashier`): the
 * tabs are driven by those permissions, which is what the test is about.
 */

const ADMIN_TABS = ['Punto de venta', 'Cotizaciones', 'Pedidos', 'Ventas realizadas', 'Devoluciones', 'Caja', 'Precios y descuentos', 'Aprobaciones'];

const CASHIER_PERMISSIONS = [
  'inventory.products.view',
  'sales.pos.use',
  'sales.cash-register.open',
  'sales.quotes.manage',
  'sales.orders.manage',
  'sales.cancellations.request',
  'sales.returns.manage',
  'invoicing.invoices.view',
  'invoicing.invoices.issue',
  'crm.customers.view',
];

test('the administrator opens /sales and sees every tab', async ({ page }) => {
  await login(page);
  await page.goto('/sales');
  await expect(page).toHaveURL(/\/sales\/pos$/);
  const nav = page.getByRole('navigation', { name: 'Secciones de ventas' });
  for (const label of ADMIN_TABS) {
    await expect(nav.getByRole('link', { name: label })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Punto de venta', level: 1 })).toBeVisible();
});

test('the cashier does not see Precios or Aprobaciones, and cannot open them by URL', async ({ page }) => {
  await page.route('**/api/v1/context', async (route) => {
    // `*.localhost` does not resolve from Node on Windows (see playwright.config.ts); the request carries `x-company`
    const response = await route.fetch({ url: route.request().url().replace('rodalaser.localhost', 'localhost') });
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, permissions: CASHIER_PERMISSIONS } });
  });
  await login(page);
  await page.goto('/sales');
  const nav = page.getByRole('navigation', { name: 'Secciones de ventas' });
  await expect(nav.getByRole('link', { name: 'Punto de venta' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Cotizaciones' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Precios' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Aprobaciones' })).toHaveCount(0);

  await page.goto('/sales/prices');
  await expect(page).not.toHaveURL(/\/sales\/prices$/);
});

test('who can only approve returns sees Aprobaciones (HU-VEN-29) but not Precios', async ({ page }) => {
  await page.route('**/api/v1/context', async (route) => {
    const response = await route.fetch({ url: route.request().url().replace('rodalaser.localhost', 'localhost') });
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, permissions: ['sales.pos.use', 'sales.returns.approve'] } });
  });
  await login(page);
  // `/sales` opens the full-screen POS, which has no sub-navigation: the history tab is inside the shell
  await page.goto('/sales/history');
  const nav = page.getByRole('navigation', { name: 'Secciones de ventas' });
  await expect(nav.getByRole('link', { name: /Aprobaciones/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Precios' })).toHaveCount(0);
});
