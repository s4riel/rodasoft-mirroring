import { expect, Page, test } from '@playwright/test';
import { login } from './support/auth';

/** HU-INV-01 · main flow of the product list (screens IN-01a…e). Needs the demo catalog from `pnpm db:seed`. */

const dataRows = (page: Page) => page.locator('rs-product-table .row:not(.header):not(.footer)');

async function pick(page: Page, filter: string, option: string) {
  await page.getByRole('combobox', { name: filter }).click();
  await page.getByRole('option', { name: option }).click();
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await page.goto('/inventory/products');
  await expect(page.getByRole('heading', { name: 'Productos' })).toBeVisible();
  await expect(dataRows(page).first()).toBeVisible();
});

test('lists products with header actions, brand and flag', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Importar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Exportar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Nuevo producto' })).toBeVisible();
  await expect(dataRows(page)).toHaveCount(10);
  await expect(dataRows(page).first().locator('rs-flag')).toBeVisible();
  await expect(page.getByText(/1–10 de \d+ registros/)).toBeVisible();
});

test('filters by industry and brand, shows chips and removes one with the ✕', async ({ page }) => {
  await pick(page, 'Industria (país)', 'Japón');
  const japan = page.locator('rs-filter-chip', { hasText: 'Japón' });
  await expect(japan).toBeVisible();
  await expect(page).toHaveURL(/countryId=/);
  // every visible product belongs to a Japanese brand (NSK, NTN)
  await expect(dataRows(page).first()).toBeVisible();
  for (const brand of await dataRows(page).locator('.brand-name').allTextContents()) {
    expect(['NSK', 'NTN']).toContain(brand.trim());
  }

  await pick(page, 'Marca', 'NSK');
  const nsk = page.locator('rs-filter-chip', { hasText: 'NSK' });
  await expect(nsk).toBeVisible();
  await expect(page).toHaveURL(/brandId=/);

  await nsk.getByRole('button').click();
  await expect(nsk).toHaveCount(0);
  await expect(page).not.toHaveURL(/brandId=/);
  await expect(japan).toBeVisible();

  await page.getByRole('button', { name: 'Limpiar todo' }).click();
  await expect(page.locator('rs-filter-chip')).toHaveCount(0);
});

test('has no branch filter', async ({ page }) => {
  // the branch lives in the global context bar, never in the product filters
  const filters = page.locator('rs-filter-bar-products');
  await expect(filters.getByRole('combobox')).toHaveCount(5);
  await expect(filters.getByRole('combobox', { name: /sucursal/i })).toHaveCount(0);
});

test('shows the no-results state and recovers with "Limpiar filtros"', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Buscar productos' }).fill('zzzz-no-existe');
  await expect(page.getByText('No encontramos productos')).toBeVisible();
  await expect(dataRows(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(dataRows(page).first()).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Buscar productos' })).toHaveValue('');
});

test('searches by measurement', async ({ page }) => {
  await page.getByRole('searchbox', { name: 'Buscar productos' }).fill('25x52x15');
  await expect(page).toHaveURL(/search=25x52x15/);
  await expect(dataRows(page).first()).toContainText('25×52×15 mm');
});

test('paginates the catalog', async ({ page }) => {
  await page.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.getByText(/11–\d+ de \d+ registros/)).toBeVisible();
  await page.getByRole('button', { name: 'Anterior' }).click();
  await expect(page.getByText(/1–10 de \d+ registros/)).toBeVisible();
});

test('opens the row actions menu', async ({ page }) => {
  await dataRows(page).first().getByRole('button', { name: /Acciones de/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Ver detalles' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Eliminar' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

/** HU-INV-02 · row actions: duplicate with a new code and industry, then delete the copy. */
test('duplicates a product choosing the industry and deletes the copy', async ({ page }) => {
  const code = `E2E-${Date.now()}`;
  const search = page.getByRole('searchbox', { name: 'Buscar productos' });

  await search.fill('6205-2RS');
  await expect(dataRows(page).first()).toContainText('6205-2RS');
  await dataRows(page).first().getByRole('button', { name: /Acciones de/ }).click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText([/Ver detalles/, /Editar/, /Duplicar/, /Ajustar stock/, /Eliminar/]);
  await items.filter({ hasText: 'Duplicar' }).click();

  const dialog = page.getByRole('dialog', { name: 'Duplicar producto' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Qué copiar')).toBeVisible();
  await dialog.getByLabel('Código nuevo').fill(code);
  await dialog.getByRole('combobox', { name: /Industria/ }).click();
  await page.getByRole('option', { name: 'Japón' }).click();
  await dialog.getByRole('button', { name: 'Crear copia' }).click();
  // HU-INV-08 · the copy (it has a price) opens on its edit screen
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}\/edit$/);
  await page.goto('/inventory/products');

  // the copy shows the chosen industry's flag
  await search.fill(code);
  await expect(dataRows(page)).toHaveCount(1);
  await expect(dataRows(page).first()).toContainText(code);
  await expect(dataRows(page).first().locator('rs-flag')).toBeVisible();
  await expect(page.locator('rs-filter-chip')).toHaveCount(0);

  // the copy has no stock, so it can be deleted
  await dataRows(page).first().getByRole('button', { name: /Acciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  const confirm = page.getByRole('dialog', { name: `¿Eliminar ${code}?` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByText(`Producto eliminado: ${code}`)).toBeVisible();
  await expect(dataRows(page)).toHaveCount(0);
});

test('refuses to delete a product that has stock', async ({ page }) => {
  // Never click Eliminar on an arbitrary row: a product without stock would really be deleted. Target the seeded
  // 6206-2RS (every seeded product has stock rows) and make sure the row shown has stock before confirming.
  await page.getByRole('searchbox', { name: 'Buscar productos' }).fill('6206-2RS');
  const rows = dataRows(page).filter({ has: page.getByText('6206-2RS', { exact: true }) });
  await expect(rows.first()).toBeVisible();
  let target = null;
  for (let i = 0; i < (await rows.count()); i++) {
    const total = Number((await rows.nth(i).locator('.cell.num').first().innerText()).trim());
    if (total > 0) {
      target = rows.nth(i);
      break;
    }
  }
  expect(target, 'a seeded 6206-2RS with stock').not.toBeNull();

  await target!.getByRole('button', { name: /Acciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Eliminar' }).click();
  await page
    .getByRole('dialog', { name: /¿Eliminar/ })
    .getByRole('button', { name: 'Eliminar' })
    .click();
  await expect(page.getByText('No se puede eliminar: tiene stock registrado. Desactívalo en su lugar.')).toBeVisible();
  await expect(target!).toBeVisible();
});

/** HU-INV-08 · Duplicar from the product sheet, copying the equivalences; the copy opens on its edit screen. */
test('duplicates from the product sheet with the equivalences and deletes the copy', async ({ page }) => {
  const code = `E2E-EQ-${Date.now()}`;
  const search = page.getByRole('searchbox', { name: 'Buscar productos' });

  await search.fill('6205-2RS');
  const source = dataRows(page).filter({ has: page.getByText('6205-2RS', { exact: true }) }).first();
  await expect(source).toBeVisible();
  await source.getByRole('button', { name: /Acciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Ver detalles' }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}$/);

  await page.getByRole('button', { name: 'Duplicar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicar producto' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Código nuevo').fill(code);
  await dialog.getByRole('combobox', { name: /Industria/ }).click();
  await page.getByRole('option', { name: 'Japón' }).click();
  await dialog.getByRole('button', { name: 'Equivalencias' }).click();
  await dialog.getByRole('button', { name: 'Crear copia' }).click();

  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}\/edit$/);
  const copyId = /products\/([0-9a-f-]{36})\/edit/.exec(page.url())![1];

  try {
    // the copy is equivalent to the 3 equivalents of the source (6205-2RSR, 6205-DDU, 6205-2Z), plus itself as the original
    await page.goto(`/inventory/products/${copyId}/equivalents`);
    const rows = page.locator('rs-doc-table tbody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText(code);
    await expect(rows.nth(1)).toContainText('6205-2RSR');
  } finally {
    // the copy has no stock: delete it so the demo catalog stays as seeded
    await page.goto('/inventory/products');
    await search.fill(code);
    await expect(dataRows(page)).toHaveCount(1);
    await dataRows(page).first().getByRole('button', { name: /Acciones de/ }).click();
    await page.getByRole('menuitem', { name: 'Eliminar' }).click();
    await page.getByRole('dialog', { name: `¿Eliminar ${code}?` }).getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByText(`Producto eliminado: ${code}`)).toBeVisible();
  }
});
