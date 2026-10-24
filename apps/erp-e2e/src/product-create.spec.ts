import { expect, Page, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-06 · creation wizard (IN-03). Needs the demo catalog from `pnpm db:seed`: the 6205-2RS (SKF, 25 × 52 × 15)
 * exists, so the duplicate-code state can be reproduced. Codes carry a timestamp so the flows can run again.
 */

const stamp = () => `E2E${Date.now()}`;

/**
 * Chooses an option of an `rs-select` by its inputId (the combobox button) and the option label. Brand options read
 * "SKF SKF" (logo text, then label), so the label is matched at the start of the name.
 */
async function choose(page: Page, inputId: string, label: string) {
  await page.locator(`#${inputId}`).click();
  await page.getByRole('option', { name: new RegExp(`^${label}\\b`) }).click();
}

async function startCategory(page: Page, category: string) {
  await page.goto('/inventory/products/new');
  await page.getByRole('radio', { name: new RegExp(category) }).click();
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/new\/[0-9a-f-]{36}$/);
}

/** Fills the identification step; the live code check runs after the typing stops. */
async function identify(page: Page, code: string, brand: string, subcategory?: string) {
  await page.locator('#wizard-code').fill(code);
  await choose(page, 'wizard-brand', brand);
  if (subcategory) await choose(page, 'wizard-subcategory', subcategory);
}

const next = (page: Page) => page.getByRole('button', { name: 'Siguiente' }).click();

/** The generic technical fields of the categories that have none of their own (material and main measure are required). */
async function fillGenericSpecs(page: Page) {
  await page.locator('#attr-material').fill('Aluminio');
  await page.locator('#attr-mainMeasure').fill('1 L');
}

/** A 1 x 1 PNG, enough for the upload checks (they read the file signature). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('creates a bearing: duplicate code first, then fix, dimensions, missing price, stock and the created screen', async ({ page }) => {
  // a product that already uses the code for SKF, so the duplicate does not depend on the seed data
  const taken = stamp();
  await startCategory(page, 'Lubricantes y grasas');
  await identify(page, taken, 'SKF');
  await next(page);
  await fillGenericSpecs(page);
  await next(page);
  await page.locator('#wizard-price').fill('80.00');
  await next(page);
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByRole('heading', { name: 'Producto creado' })).toBeVisible();

  await startCategory(page, 'Rodamientos');
  await identify(page, taken, 'SKF', 'Rígidos de bolas');

  // duplicate code: the live check shows the error and "Siguiente" stays on the step
  await expect(page.getByText('Código duplicado')).toBeVisible();
  await next(page);
  await expect(page.getByRole('heading', { name: 'Identificación' })).toBeVisible();

  await page.locator('#wizard-code').fill(stamp());
  await expect(page.getByText('Código duplicado')).toHaveCount(0);
  await next(page);

  // dimensions (bearings only)
  await expect(page.getByRole('heading', { name: 'Dimensiones' })).toBeVisible();
  await page.locator('#wizard-d').fill('25');
  await page.locator('#wizard-big-d').fill('52');
  await page.locator('#wizard-b').fill('15');
  await next(page);

  // specifications, then price: missing price blocks the step
  await next(page);
  await expect(page.getByRole('heading', { name: 'Precio e inventario' })).toBeVisible();
  await next(page);
  await expect(page.getByText('Falta el precio de venta')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Precio e inventario' })).toBeVisible();

  await page.locator('#wizard-price').fill('245.00');
  await page.locator('#wizard-stock').fill('24');
  await next(page);

  await expect(page.getByRole('heading', { name: 'Fotos y ficha técnica' })).toBeVisible();
  await next(page);
  await expect(page.getByRole('heading', { name: 'Revisa antes de guardar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Equivalencias', exact: true })).toBeVisible();
  // candidates by measures: link the first one before saving, if the catalog has one for 25 × 52 × 15
  const candidate = page.getByRole('button', { name: 'Vincular' }).first();
  if (await candidate.count()) {
    await candidate.click();
    await expect(page.getByRole('button', { name: 'Vinculado' }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Guardar producto' }).click();

  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}\/created$/);
  await expect(page.getByRole('heading', { name: 'Producto creado' })).toBeVisible();

  // link the first suggestion, then the sheet shows the product with its stock
  const suggestion = page.locator('li').filter({ has: page.getByRole('button', { name: 'Vincular' }) }).first();
  if (await suggestion.count()) {
    await suggestion.getByRole('button', { name: 'Vincular' }).click();
    // the suggestion row shows its state; the toast is transient and may close before the check
    await expect(page.locator('li').filter({ hasText: 'Vinculado' }).first()).toBeVisible();
  }
  await page.getByRole('link', { name: 'Ver producto' }).click();
  await expect(page.locator('rs-kpi-card', { hasText: 'Stock' })).toContainText('24');
});

test('creates a product of a category with 4 steps', async ({ page }) => {
  await startCategory(page, 'Lubricantes y grasas');
  await identify(page, stamp(), 'SKF');
  await next(page);
  await expect(page.locator('#attr-material')).toBeVisible();
  await next(page);
  // the generic fields are required: the step does not move on without them
  await expect(page.getByRole('heading', { name: 'Especificaciones' })).toBeVisible();
  await fillGenericSpecs(page);
  await next(page);
  await page.locator('#wizard-price').fill('80.00');
  await next(page);
  await expect(page.getByRole('button', { name: 'Crear producto' })).toBeVisible();
  await page.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByRole('heading', { name: 'Producto creado' })).toBeVisible();
});

test('uploads a photo on the last step and saves it with the product', async ({ page }) => {
  await startCategory(page, 'Lubricantes y grasas');
  await identify(page, stamp(), 'SKF');
  await next(page);
  await fillGenericSpecs(page);
  await next(page);
  await page.locator('#wizard-price').fill('80.00');
  await next(page);

  await expect(page.getByRole('heading', { name: 'Fotos y ficha técnica' })).toBeVisible();
  await page.locator('input[type=file][accept^="image"]').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.locator('rs-file-item img')).toBeVisible();

  await page.getByRole('button', { name: 'Crear producto' }).click();
  await expect(page.getByRole('heading', { name: 'Producto creado' })).toBeVisible();
});

test('shows the eight root categories as cards', async ({ page }) => {
  await page.goto('/inventory/products/new');
  await expect(page.getByRole('radio')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Continuar' })).toBeDisabled();
});

test('saves a draft, finds it under Borrador and resumes it in the wizard', async ({ page }) => {
  const code = stamp();
  await startCategory(page, 'Lubricantes y grasas');
  await identify(page, code, 'SKF');
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page).toHaveURL(/status=DRAFT/);

  await page.getByRole('button', { name: /Acciones de/ }).first().click();
  await page.getByRole('menuitem', { name: 'Ver detalles' }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}\/draft$/);
  await expect(page.locator('#wizard-code')).toHaveValue(code);
});

test('"Nuevo producto" opens the category cards instead of the coming-soon toast', async ({ page }) => {
  await page.goto('/inventory/products');
  await page.getByRole('button', { name: 'Nuevo producto' }).first().click();
  await expect(page).toHaveURL(/\/inventory\/products\/new$/);
  await expect(page.getByText('Esta acción estará disponible próximamente.')).toHaveCount(0);
});
