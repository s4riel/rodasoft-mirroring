import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-24 · kardex of a product (IN-09). Needs the demo catalog from `pnpm db:seed`: every demo product has a movement
 * history whose last balance equals its stock in each warehouse, so the closing balance must equal the sheet's stock.
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

/** The number under "Saldo" in the table footer ("Saldo final"); the cost columns, when shown, come after it. */
async function closingBalance(page: import('@playwright/test').Page): Promise<number> {
  const headers = (await page.locator('rs-doc-table thead th').allTextContents()).map((h) => h.trim());
  const cells = await page.locator('rs-doc-table tfoot').locator('th, td').allTextContents();
  return Number(cells[headers.indexOf('Saldo')]?.replace(/[^\d-]/g, ''));
}

test('opens the kardex from the movements tab and its final balance matches the sheet stock', async ({ page }) => {
  await page.getByRole('tab', { name: 'Movimientos' }).click();
  await expect(page).toHaveURL(/\/movements$/);
  const balance = await page.locator('rs-kpi-card', { hasText: 'Saldo actual' }).locator('.value').textContent();
  const stock = Number(balance?.replace(/[^\d]/g, ''));

  await page.getByRole('link', { name: 'Ver kardex' }).click();
  await expect(page).toHaveURL(/\/inventory\/kardex\?productId=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Kardex', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kardex', exact: true })).toBeVisible();

  const headers = await page.locator('rs-doc-table thead th').allTextContents();
  expect(headers.map((h) => h.trim()).slice(0, 8)).toEqual(['Fecha', 'Tipo', 'Documento', 'Almacén', 'Usuario', 'Entrada', 'Salida', 'Saldo']);

  // the first row is the opening balance and the footer closes with the stock the sheet shows
  const firstRow = page.locator('rs-doc-table tbody tr').first();
  await expect(firstRow).toContainText('Saldo inicial');
  await expect(page.locator('rs-doc-table tfoot')).toContainText('Saldo final');
  expect(await closingBalance(page)).toBe(stock);
});

test('filters by warehouse and shows only its movements and its own balance', async ({ page }) => {
  await page.getByRole('tab', { name: 'Movimientos' }).click();
  await page.getByRole('link', { name: 'Ver kardex' }).click();
  await expect(page).toHaveURL(/\/inventory\/kardex\?productId=/);
  await expect(page.locator('rs-doc-table tfoot')).toContainText('Saldo final');
  const allWarehouses = await closingBalance(page);

  await page.getByRole('combobox', { name: 'Almacén' }).click();
  const options = page.getByRole('listbox').getByRole('option');
  await expect(options.first()).toHaveText('Todos los almacenes');
  const warehouse = (await options.nth(1).textContent())?.trim() ?? '';
  await options.nth(1).click();
  await expect(page).toHaveURL(/warehouseId=[0-9a-f-]{36}/);
  await expect(page.locator('rs-doc-table tfoot')).toContainText('Saldo final');

  // every movement shown belongs to that warehouse, and its closing balance cannot exceed the total
  const warehouses = await page.locator('rs-doc-table tbody tr:not(:first-child) td:nth-child(4)').allTextContents();
  for (const text of warehouses) expect(text.trim()).toBe(warehouse);
  expect(await closingBalance(page)).toBeLessThanOrEqual(allWarehouses);
});

test('shows the ledger of every movement and narrows it by type and search text', async ({ page }) => {
  await page.goto('/inventory/kardex');
  await expect(page.getByRole('heading', { name: 'Kardex', level: 1 })).toBeVisible();

  const headers = await page.locator('rs-doc-table thead th').allTextContents();
  expect(headers.map((h) => h.trim()).slice(0, 6)).toEqual(['Fecha', 'Producto', 'Movimiento', 'Detalle', 'Cantidad', 'Saldo']);
  await expect(page.locator('rs-doc-table tfoot')).toContainText('Total');
  const rows = page.locator('rs-doc-table tbody tr');
  await expect(rows.first()).toBeVisible();

  // the type filter keeps only that kind of movement
  await page.getByRole('combobox', { name: 'Tipo de movimiento' }).click();
  await page.getByRole('listbox').getByRole('option', { name: 'Compra' }).click();
  await expect(page).toHaveURL(/type=PURCHASE_RECEIPT/);
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.locator('td:nth-child(3)').allTextContents()) expect(text.trim()).toMatch(/^Compra/);

  // the search narrows it to one product
  await page.getByRole('searchbox', { name: 'Buscar movimiento o documento' }).fill('6205-2RS');
  await expect(page).toHaveURL(/q=6205-2RS/);
  await expect(rows.first()).toBeVisible();
  for (const text of await rows.locator('td:nth-child(2)').allTextContents()) expect(text).toContain('6205-2RS');

  await page.getByRole('button', { name: 'Limpiar' }).click();
  await expect(page).not.toHaveURL(/type=|q=/);
});

test('picks a product from the ledger and gets its kardex, then goes back to every movement', async ({ page }) => {
  await page.goto('/inventory/kardex');
  await expect(page.locator('rs-doc-table tbody tr').first()).toBeVisible();

  await page.getByRole('searchbox', { name: 'Buscar producto' }).fill('6205-2RS');
  await page.getByRole('button', { name: /6205-2RS/ }).first().click();
  await expect(page).toHaveURL(/\/inventory\/kardex\?productId=/);
  await expect(page.locator('rs-doc-table tfoot')).toContainText('Saldo final');

  await page.getByRole('button', { name: 'Cambiar producto' }).click();
  await expect(page).not.toHaveURL(/productId=/);
  await expect(page.locator('rs-doc-table thead')).toContainText('Movimiento');
});

test('opens the kardex of a product from the row menu of the ledger', async ({ page }) => {
  await page.goto('/inventory/kardex');
  const first = page.locator('rs-doc-table tbody tr').first();
  await expect(first).toBeVisible();
  await first.getByRole('button', { name: /Acciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Ver kardex del producto' }).click();
  await expect(page).toHaveURL(/productId=[0-9a-f-]{36}/);
  await expect(page.locator('rs-doc-table tfoot')).toContainText('Saldo final');
});
