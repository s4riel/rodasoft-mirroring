import { expect, Page, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-09 · deactivate or delete a product (IN-18a, IN-18b). Needs the demo catalog from `pnpm db:seed`: the 6205-2RS has
 * stock movements, so it can only be deactivated. The product that gets deactivated is created by the test (a fresh one has
 * no movements), so nothing from the seed changes. Codes carry a timestamp so the flows can run again.
 */

const stamp = () => `E2E${Date.now()}`;

/** Chooses an option of an `rs-select` by its inputId (the combobox button) and the option label. */
async function choose(page: Page, inputId: string, label: string) {
  await page.locator(`#${inputId}`).click();
  await page.getByRole('option', { name: new RegExp(`^${label}\\b`) }).click();
}

const next = (page: Page) => page.getByRole('button', { name: 'Siguiente' }).click();

/** Creates a product of a category with 4 steps (no stock, so no movements). */
async function createLubricant(page: Page, code: string) {
  await page.goto('/inventory/products/new');
  await page.getByRole('radio', { name: /Lubricantes y grasas/ }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.locator('#wizard-code').fill(code);
  await choose(page, 'wizard-brand', 'SKF');
  await next(page);
  await page.locator('#attr-material').fill('Aluminio');
  await page.locator('#attr-mainMeasure').fill('1 L');
  await next(page);
  await page.locator('#wizard-price').fill('80.00');
  await next(page);
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Producto creado correctamente.')).toBeVisible();
}

const dataRows = (page: Page) => page.locator('rs-product-table .row:not(.header):not(.footer)');

/** Searches the list for a code and opens the row menu of the first match (of the given brand, when the code repeats). */
async function openRowMenu(page: Page, code: string, brand?: string) {
  await page.goto('/inventory/products');
  await page.getByPlaceholder('Buscar por código, medida o marca').fill(code);
  // the search applies after a short pause: wait for the filtered list, or the menu would open on rows about to be replaced
  await expect(page).toHaveURL(/search=/);
  const rows = (brand ? dataRows(page).filter({ hasText: brand }) : dataRows(page)).filter({ hasText: code });
  await expect(rows.first()).toBeVisible();
  await rows.first().locator('[data-kebab]').click();
}

/**
 * Codes the API offers for sale: the same request the POS will make. It reuses the headers of a request the app already sent
 * (company and session), so the call is authorized exactly like the app's own. It goes straight to the API: `*.localhost`
 * does not resolve outside the browser on Windows.
 */
async function sellableCodes(page: Page, search: string): Promise<string[]> {
  const sent = await page.waitForRequest((r) => r.url().includes('/api/v1/inventory/'));
  const api = process.env['E2E_API_URL'] ?? 'http://localhost:3000';
  const { host, referer, ...headers } = await sent.allHeaders();
  void host;
  void referer;
  const response = await page.request.get(`${api}/api/v1/inventory/products?sellable=true&search=${encodeURIComponent(search)}`, { headers });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { items: { manufacturerCode: string }[] }).items.map((i) => i.manufacturerCode);
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('deactivates a product from the row menu, shows it as Inactivo, drops it from sellable and reactivates it', async ({ page }) => {
  const code = stamp();
  await createLubricant(page, code);

  await openRowMenu(page, code);
  await page.getByRole('menuitem', { name: 'Desactivar / Reactivar' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`¿Desactivar ${code}?`);
  await expect(dialog).toContainText('Conserva su historial y su stock');
  await dialog.getByRole('button', { name: 'Desactivar' }).click();

  await expect(page.getByText('Producto desactivado')).toBeVisible();
  await expect(dataRows(page).first()).toContainText('Inactivo');

  // hidden from sales, still in the catalog
  const sellableRequest = sellableCodes(page, code);
  await page.reload();
  expect(await sellableRequest).not.toContain(code);
  await expect(dataRows(page).first()).toBeVisible();

  // the sheet says so and offers Reactivar
  await page.goto('/inventory/products');
  await page.getByPlaceholder('Buscar por código, medida o marca').fill(code);
  await expect(dataRows(page)).toHaveCount(1);
  await dataRows(page).first().locator('[data-kebab]').click();
  await page.getByRole('menuitem', { name: 'Ver detalles' }).click();
  await expect(page.getByText('Producto inactivo')).toBeVisible();
  await page.getByRole('button', { name: 'Reactivar' }).click();
  await expect(page.getByText('Producto reactivado')).toBeVisible();
  await expect(page.getByText('Producto inactivo')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Desactivar' })).toBeVisible();

  const again = sellableCodes(page, code);
  await page.reload();
  expect(await again).toContain(code);
});

test('a product with movements cannot be deleted: the dialog offers Desactivar instead', async ({ page }) => {
  await openRowMenu(page, '6205-2RS', 'FAG');
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Tiene movimientos: solo puede desactivarse');
  await expect(dialog.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Desactivar' }).click();
  await expect(page.getByRole('dialog')).toContainText('¿Desactivar 6205-2RS?');
  // leaves the seeded catalog untouched
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
