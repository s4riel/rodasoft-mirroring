import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-12 · side-by-side comparator (IN-13). Needs the demo catalog from `pnpm db:seed`: the 6205-2RS is linked to
 * 6205-2RSR (NTN, exact), 6205-DDU (NSK, other seal) and 6205-2Z (SKF, other seal and cage).
 */

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto('/inventory/products?search=6205-2RS');
  const row = page
    .locator('rs-product-table .row:not(.header):not(.footer)')
    .filter({ has: page.getByText('6205-2RS', { exact: true }) })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Acciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Ver detalles' }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}$/);
  await page.getByRole('tab', { name: 'Equivalentes' }).click();
  await expect(page.locator('rs-doc-table tbody tr')).toHaveCount(4);
});

const check = (page: import('@playwright/test').Page, code: string) =>
  page.getByRole('checkbox', { name: code, exact: true }).check();

test('compares the original with two equivalents, highlights what differs and opens a product', async ({ page }) => {
  const compare = page.getByRole('button', { name: /Comparar/ });
  await expect(compare).toBeDisabled();

  await check(page, '6205-2RS');
  await check(page, '6205-2RSR');
  await check(page, '6205-DDU');
  await expect(compare).toHaveText(/Comparar \(3\)/);
  await expect(compare).toBeEnabled();
  await compare.click();

  await expect(page).toHaveURL(/\/inventory\/equivalences\/compare\?ids=[^&]+&from=/);
  await expect(page.getByRole('heading', { name: 'Comparar equivalentes', level: 1 })).toBeVisible();
  const columns = page.locator('thead th.product');
  await expect(columns).toHaveCount(3);
  // the original is the reference, the others say how they compare with it
  await expect(columns.nth(0)).toContainText('6205-2RS');
  await expect(columns.nth(0)).toContainText('Referencia');
  await expect(columns.nth(1)).toContainText('Exacta');
  await expect(columns.nth(2)).toContainText('Con diferencias');

  // measures are equal, the seal is not
  const seal = page.locator('tbody tr', { hasText: 'Protección / sello' });
  await expect(seal).toHaveClass(/differs/);
  await expect(seal).toContainText('Difiere');
  await expect(page.locator('tbody tr', { hasText: 'Diámetro interior (d)' })).not.toHaveClass(/differs/);

  // only the differences
  // the native input sits under the visible track, so the label is what a user clicks
  await page.getByText('Solo diferencias', { exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Solo diferencias' })).toBeChecked();
  await expect(page.locator('tbody tr.differs')).not.toHaveCount(0);
  await expect(page.locator('tbody tr:not(.differs):not(.group)')).toHaveCount(0);
  await expect(page.locator('tbody tr', { hasText: 'Diámetro interior (d)' })).toHaveCount(0);

  await page.getByRole('button', { name: /Abrir 6205-DDU/ }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}$/);
});

test('compares four products and can drop columns down to two', async ({ page }) => {
  await check(page, '6205-2RS');
  await check(page, '6205-2RSR');
  await check(page, '6205-DDU');
  await check(page, '6205-2Z');
  // the demo bearing has three equivalents: with the original that is the maximum of four
  await expect(page.getByRole('button', { name: /Comparar \(4\)/ })).toBeEnabled();
  await page.getByRole('button', { name: /Comparar \(4\)/ }).click();

  await expect(page.locator('thead th.product')).toHaveCount(4);
  await page.getByRole('button', { name: /Quitar 6205-2Z/ }).click();
  await expect(page.locator('thead th.product')).toHaveCount(3);
  await expect(page).toHaveURL(/ids=[^&]+/);
  await page.getByRole('button', { name: /Quitar 6205-DDU/ }).click();
  await expect(page.locator('thead th.product')).toHaveCount(2);
  // two is the minimum: nothing left to remove
  await expect(page.getByRole('button', { name: /Quitar/ })).toHaveCount(0);
});

test('shows a note instead of a table when the selection is not valid', async ({ page }) => {
  await page.goto('/inventory/equivalences/compare?ids=only-one');
  await expect(page.getByText('Selección no válida')).toBeVisible();
  await expect(page.locator('table')).toHaveCount(0);
});
