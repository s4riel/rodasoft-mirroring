import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/** HU-INV-03 · product sheet (IN-02a, tab "Datos"). Needs the demo catalog from `pnpm db:seed`. */

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto('/inventory/products');
  await page.getByRole('searchbox', { name: 'Buscar productos' }).fill('6205-2RS');
  const row = page.locator('rs-product-table .row:not(.header):not(.footer)').first();
  await expect(row).toContainText('6205-2RS');
  await row.getByRole('button', { name: /Acciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Ver detalles' }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}$/);
});

test('shows the sheet with identity, flag, KPI total matching the stock per branch and field icons', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 1 })).toContainText('6205-2RS');
  await expect(page.getByText('Activo').first()).toBeVisible();
  await expect(page.locator('.identity rs-flag')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dimensiones' })).toBeVisible();
  await expect(page.getByText('25 mm').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Especificaciones técnicas' })).toBeVisible();

  // every field carries an icon that tells its data type
  const fields = page.locator('rs-data-field');
  expect(await fields.count()).toBeGreaterThan(10);
  await expect(fields.locator('rs-icon[aria-hidden="true"]')).toHaveCount(await fields.count());

  // the KPI total equals the sum of the per-branch quantities
  await expect(page.getByRole('heading', { name: 'Stock por sucursal' })).toBeVisible();
  const quantities = await page.locator('.stock-list .qty').allTextContents();
  const sum = quantities.reduce((total, q) => total + Number(q.trim()), 0);
  await expect(page.locator('rs-kpi-card', { hasText: 'Stock total' }).locator('.value')).toHaveText(`${sum} uds`);
  await expect(page.locator('.stock-total')).toContainText(String(sum));
});

test('shows the placeholder of the Movimientos tab and goes back to the list', async ({ page }) => {
  await page.getByRole('tab', { name: 'Movimientos' }).click();
  await expect(page.getByText('Disponible próximamente').first()).toBeVisible();
  await expect(page.locator('.stock-list')).toHaveCount(0);

  await page.getByRole('link', { name: 'Productos' }).first().click();
  await expect(page).toHaveURL(/\/inventory\/products/);
  await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
});
