import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-05 · movements and stock per warehouse of the product sheet (IN-22, IN-23). Needs the demo catalog from
 * `pnpm db:seed`: every demo product has a movement history whose last balance equals its stock in each warehouse.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto('/inventory/products?search=6205-2RS');
  // the exact code only: the search also matches 6205-2RSR
  const row = page
    .locator('rs-product-table .row:not(.header):not(.footer)')
    .filter({ has: page.getByText('6205-2RS', { exact: true }) })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Acciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Ver detalles' }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}$/);
});

test('shows the movements with the entries and exits of the last 30 days and the current balance', async ({ page }) => {
  await page.getByRole('tab', { name: 'Movimientos' }).click();
  await expect(page).toHaveURL(/\/movements$/);
  await expect(page.getByRole('heading', { name: 'Movimientos de 6205-2RS' })).toBeVisible();

  const kpis = page.locator('rs-kpi-card');
  await expect(kpis.filter({ hasText: 'Entradas (30 días)' })).toBeVisible();
  await expect(kpis.filter({ hasText: 'Salidas (30 días)' })).toBeVisible();
  await expect(kpis.filter({ hasText: 'Saldo actual' })).toBeVisible();

  const headers = await page.locator('rs-doc-table thead th').allTextContents();
  expect(headers.map((h) => h.trim())).toEqual(['Fecha', 'Documento', 'Tipo', 'Cant.', 'Saldo', 'Sucursal']);

  // newest first, signed quantities, and the balance after each movement
  const rows = page.locator('rs-doc-table tbody tr');
  expect(await rows.count()).toBeGreaterThan(0);
  const quantities = await rows.locator('td:nth-child(4)').allTextContents();
  expect(quantities.every((q) => /^[+−]\d+$/.test(q.trim()) || q.trim() === '0')).toBe(true);
  await expect(page.getByText('Historial completo en Kardex, con filtros por sucursal, tipo y fechas.')).toBeVisible();
});

test('the current balance equals the total of the stock per warehouse', async ({ page }) => {
  await page.getByRole('tab', { name: 'Movimientos' }).click();
  await expect(page).toHaveURL(/\/movements$/);
  const balance = await page
    .locator('rs-kpi-card', { hasText: 'Saldo actual' })
    .locator('.value')
    .textContent();

  await page.getByRole('tab', { name: 'Stock por almacén' }).click();
  await expect(page).toHaveURL(/\/stock$/);
  await expect(page.getByRole('heading', { name: 'Stock por almacén' })).toBeVisible();

  const headers = await page.locator('rs-doc-table thead th').allTextContents();
  expect(headers.map((h) => h.trim())).toEqual(['Sucursal', 'Almacén', 'Ubicación', 'Stock', 'Mín.', 'Máx.']);

  const total = await page.locator('rs-doc-table .total').textContent();
  const units = Number(total?.match(/Total (\d+) piezas?/)?.[1]);
  expect(units).toBe(Number(balance?.replace(/[^\d]/g, '')));
  await expect(page.getByText('el stock se mueve entre sucursales solo con transferencias.')).toBeVisible();
});
