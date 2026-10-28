import { expect, Page, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-07 · edit a product (IN-20a, IN-20b). Needs the demo catalog from `pnpm db:seed`: the 6205-2RS has stock
 * movements, so its brand and category are locked. The product that gets edited is created by the test (a fresh one has
 * no movements, so nothing from the seed changes). Codes carry a timestamp so the flows can run again.
 */

const stamp = () => `E2E${Date.now()}`;

/** Chooses an option of an `rs-select` by its inputId (the combobox button) and the option label. */
async function choose(page: Page, inputId: string, label: string) {
  await page.locator(`#${inputId}`).click();
  await page.getByRole('option', { name: new RegExp(`^${label}\\b`) }).click();
}

const next = (page: Page) => page.getByRole('button', { name: 'Siguiente' }).click();

/** Creates a product of a category with 4 steps (no stock, so no movements) and opens its sheet. */
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
  await expect(page.getByText('Producto creado correctamente.')).toBeVisible();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}$/);
}

const stepper = (page: Page, label: RegExp) => page.locator('rs-stepper').getByRole('button', { name: label });

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('edits the price and a technical field from the sheet, saves at the end and sees the new values', async ({ page }) => {
  const code = stamp();
  await createLubricant(page, code);

  await page.getByRole('button', { name: 'Editar' }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Editar ${code}`);
  await expect(page.locator('rs-page-header')).toContainText('Editando · Paso 1 de 4 · Identificación · los cambios se guardan al final');
  // the stored values are in the form, and nothing is locked while the product has no movements
  await expect(page.locator('#wizard-code')).toHaveValue(code);
  await expect(page.locator('#wizard-brand')).toBeEnabled();
  await expect(page.locator('#wizard-category')).toBeEnabled();

  await stepper(page, /Especificaciones/).click();
  await expect(page.locator('#attr-material')).toHaveValue('Aluminio');
  await page.locator('#attr-material').fill('Acero inoxidable');

  await stepper(page, /Precio e inventario/).click();
  await expect(page.locator('#wizard-price')).toHaveValue(/^80[.,]00$/);
  // stock is read-only here, with its own adjustment
  await expect(page.locator('#wizard-current-stock')).toHaveJSProperty('readOnly', true);
  await expect(page.locator('#wizard-stock')).toHaveCount(0);
  await page.locator('#wizard-price').fill('99.90');

  await page.getByRole('button', { name: 'Guardar cambios' }).click();

  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}$/);
  await expect(page.getByText('99,90').first()).toBeVisible();
  await expect(page.getByText('Acero inoxidable').first()).toBeVisible();
});

test('locks brand, category and subcategory on a product with movements, from the row menu', async ({ page }) => {
  await page.goto('/inventory/products');
  await page.getByRole('searchbox', { name: 'Buscar productos' }).fill('6205-2RS');
  const row = page.locator('rs-product-table .row:not(.header):not(.footer)').first();
  await expect(row).toContainText('6205-2RS');
  await row.getByRole('button', { name: /Acciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Editar' }).click();

  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}\/edit$/);
  await expect(page.locator('rs-page-header')).toContainText('Editar 6205-2RS');
  await expect(page.locator('#wizard-brand')).toBeDisabled();
  await expect(page.locator('#wizard-category')).toBeDisabled();
  await expect(page.locator('#wizard-subcategory')).toBeDisabled();
  await expect(page.getByText('No editable: el producto ya tiene movimientos').first()).toBeVisible();

  // nothing was touched: leaving goes straight back to the sheet, without asking
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}$/);
});
