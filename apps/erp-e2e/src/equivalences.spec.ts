import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-11 · equivalence table between brands (IN-15a, IN-15f). Needs the demo catalog from `pnpm db:seed`: the
 * 6205-2RS is linked to 6205-2RSR (NTN, exact), 6205-DDU (NSK, other seal) and 6205-2Z (SKF, other seal and cage), and the
 * other demo bearings have their own links.
 */

test('lists the seeded links from the Inventory sub-navigation, filters by brand and opens a product', async ({ page }) => {
  await login(page);
  await page.goto('/inventory/products');
  await page.getByRole('link', { name: 'Equivalencias' }).click();
  await expect(page).toHaveURL(/\/inventory\/equivalences$/);
  await expect(page.getByRole('heading', { name: 'Equivalencias', level: 1 })).toBeVisible();
  // newest links first: narrow to the 6205 family so the assertions do not depend on how many links the seed made
  await page.goto('/inventory/equivalences?q=6205');

  const rows = page.locator('rs-doc-table tbody tr');
  await expect(rows.first()).toBeVisible();
  const all = await rows.count();
  expect(all).toBeGreaterThanOrEqual(3);
  await expect(page.locator('rs-doc-table')).toContainText('6205-2RS');
  await expect(page.locator('rs-doc-table')).toContainText('6205-2RSR');
  await expect(page.locator('rs-doc-table')).toContainText('Exacta');
  await expect(page.locator('rs-doc-table')).toContainText('Con diferencias');
  // a user who can link is not in read-only mode
  await expect(page.getByText('Modo solo lectura')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Vincular equivalencias' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Marca' }).click();
  await page.getByRole('option', { name: 'NTN' }).click();
  await expect(page).toHaveURL(/brandId=/);
  // NTN is on several links of the demo catalog: every row has it on one side, and 6205-2RSR is one of them
  await expect.poll(async () => (await rows.allTextContents()).every((text) => text.includes('NTN'))).toBe(true);
  const link = rows.filter({ hasText: '6205-2RSR' });
  await expect(link).toHaveCount(1);
  await expect(link).toContainText('Exacta');

  await link.getByRole('button', { name: /Abrir 6205-2RSR/ }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}$/);
});

test('shows the empty state with "Limpiar filtros" when a search finds nothing', async ({ page }) => {
  await login(page);
  await page.goto('/inventory/equivalences?q=NO-SUCH-CODE');
  await expect(page.getByText('No encontramos equivalencias')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(page).toHaveURL(/\/inventory\/equivalences$/);
  await expect(page.locator('rs-doc-table tbody tr').first()).toBeVisible();
});

test('a user who cannot link sees the list in read-only mode, with its note and no "Vincular"', async ({ page }) => {
  await login(page);
  // the seeded administrator can link: the context the ERP receives is served without that permission
  await page.route('**/api/v1/context', async (route) => {
    // `*.localhost` does not resolve from Node on Windows, so the request goes to the API directly
    const response = await route.fetch({ url: 'http://localhost:3000/api/v1/context' });
    const body = await response.json();
    body.permissions = (body.permissions as string[]).filter((p) => p !== 'inventory.equivalences.link');
    await route.fulfill({ response, json: body });
  });
  await page.goto('/inventory/equivalences');
  await expect(page.getByText('Modo solo lectura')).toBeVisible();
  await expect(page.locator('rs-doc-table tbody tr').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Vincular equivalencias' })).toHaveCount(0);
});
