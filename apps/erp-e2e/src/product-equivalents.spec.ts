import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-04 · equivalents of the product sheet (IN-02a card, IN-02b tab). Needs the demo catalog from `pnpm db:seed`:
 * the 6205-2RS is linked to 6205-2RSR (NTN, exact), 6205-DDU (NSK, other seal) and 6205-2Z (SKF, other seal and cage).
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

test('shows the equivalents on the sheet and opens the full tab from "Ver todas las equivalencias"', async ({ page }) => {
  const card = page.locator('[aria-labelledby="equivalents-card-title"]');
  await expect(card).toContainText('3 referencias de otras marcas');
  await expect(card.locator('.eq-list li')).toHaveCount(3);
  await expect(card.locator('.eq-list li').first()).toContainText('Exacta');
  await expect(page.locator('rs-kpi-card', { hasText: 'Equivalentes' }).locator('.value')).toHaveText('3 marcas');

  await card.getByRole('link', { name: 'Ver todas las equivalencias' }).click();
  await expect(page).toHaveURL(/\/equivalents$/);
  await expect(page.getByRole('tab', { name: 'Equivalentes' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: 'Equivalentes por marca' })).toBeVisible();

  const rows = page.locator('rs-doc-table tbody tr');
  await expect(rows).toHaveCount(4);
  // the original first, then the exact one, then the ones with differences
  await expect(rows.nth(0)).toContainText('6205-2RS');
  await expect(rows.nth(0)).toContainText('Original');
  await expect(rows.nth(1)).toContainText('6205-2RSR');
  await expect(rows.nth(1)).toContainText('Exacta');
  await expect(rows.nth(2)).toContainText('Protección / sello');
  await expect(rows.nth(3)).toContainText('Protección / sello +1');
  await expect(page.getByText('1–4 de 4 registros')).toBeVisible();
});

test('flags each difference and totals the stock of the original and its equivalents', async ({ page }) => {
  await page.getByRole('link', { name: 'Ver todas las equivalencias' }).click();
  const rows = page.locator('rs-doc-table tbody tr');
  await expect(rows).toHaveCount(4);

  const brands = await rows.locator('td:nth-child(2)').allTextContents();
  expect(brands.map((b) => b.trim())).toEqual(expect.arrayContaining(['NTN', 'NSK', 'SKF']));

  // the industry column: the original is German (FAG), the equivalents Japanese (NTN, NSK) and Swedish (SKF)
  await expect(page.getByRole('columnheader', { name: 'Industria' })).toBeVisible();
  const industries = await rows.locator('td:nth-child(3)').allTextContents();
  expect(industries.map((i) => i.trim())).toEqual(['Alemania', 'Japón', 'Japón', 'Suecia']);
  await expect(rows.locator('td:nth-child(3) rs-flag')).toHaveCount(4);

  // every equivalent with differences is flagged with a warning pill that can be focused for its detail
  const warnings = page.locator('rs-doc-table rs-status-pill[data-status="warning"]');
  await expect(warnings).toHaveCount(2);
  await expect(warnings.first()).toHaveAttribute('tabindex', '0');
  await warnings.last().focus();
  await expect(page.getByRole('tooltip')).toContainText('Material de la jaula');

  // the total row adds up the stock of the four codes
  const stocks = await rows.locator('td:nth-child(4)').allTextContents();
  const sum = stocks.reduce((total, s) => total + Number(s.trim()), 0);
  const total = page.locator('rs-doc-table tfoot');
  await expect(total).toContainText('4 códigos');
  await expect(total).toContainText(String(sum));
});
