import { expect, Page, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-17 · warehouses per branch: list (IN-14), new (IN-30a) and edit (IN-30b). Needs the demo data from `pnpm db:seed`
 * (Huayna Kapac with HK-01 as its main warehouse). A warehouse is never deleted, so each run creates one with its own code,
 * hands the main flag back to HK-01 at the end and leaves the new one inactive.
 */

const BRANCH = 'Huayna Kapac';
const SEEDED_MAIN = 'HK-01';
/** Unique per run: 2 to 12 characters, upper case, digits and dashes. */
const CODE = `E${Date.now().toString(36).toUpperCase().slice(-7)}`;

/** Chooses an option of an `rs-select` by its inputId (the combobox button) and the exact option label. */
async function choose(page: Page, inputId: string, label: string) {
  await page.locator(`#${inputId}`).click();
  await page.locator('li[role="option"]').filter({ hasText: label }).click();
}

const row = (page: Page, code: string) => page.locator('rs-doc-table tbody tr').filter({ has: page.getByText(code, { exact: true }) });
const mainPill = (page: Page, code: string) => row(page, code).locator('rs-status-pill', { hasText: 'Principal' });

async function search(page: Page, code: string) {
  await page.goto(`/inventory/warehouses?q=${code}`);
  await expect(row(page, code)).toBeVisible();
}

/** Opens the edit form of a warehouse from the list. */
async function edit(page: Page, code: string) {
  await search(page, code);
  await row(page, code).getByRole('button', { name: `Editar ${code}` }).click();
  await expect(page.getByRole('heading', { name: 'Editar almacén' })).toBeVisible();
}

/** Makes the warehouse of the open form the main one, confirming the swap that names the previous main. */
async function takeMain(page: Page, previous: string) {
  await page.locator('label', { hasText: 'Almacén principal de la sucursal' }).click();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Se quitará como principal a ${previous}.`);
  await dialog.getByRole('button', { name: 'Cambiar principal' }).click();
  await expect(page.getByText('Almacén actualizado').last()).toBeVisible();
  await expect(page).toHaveURL(/\/inventory\/warehouses$/);
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('lists the warehouses of every branch, with filters', async ({ page }) => {
  await page.goto('/inventory/products');
  await page.getByRole('link', { name: 'Almacenes' }).click();
  await expect(page).toHaveURL(/\/inventory\/warehouses$/);
  await expect(page.getByRole('heading', { name: 'Almacenes' })).toBeVisible();

  await expect(row(page, SEEDED_MAIN)).toContainText(BRANCH);
  await expect(mainPill(page, SEEDED_MAIN)).toBeVisible();

  await page.getByRole('searchbox', { name: 'Buscar almacenes' }).fill('no-such-warehouse');
  await expect(page.getByText('No encontramos almacenes')).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(row(page, SEEDED_MAIN)).toBeVisible();
});

test('creates a warehouse, makes it the main one, and gives the flag back', async ({ page }) => {
  await page.goto('/inventory/warehouses');
  await page.getByRole('button', { name: 'Nuevo almacén' }).first().click();
  await expect(page).toHaveURL(/\/inventory\/warehouses\/new$/);

  // required fields answer with inline messages and nothing is saved
  await page.getByRole('button', { name: 'Crear almacén' }).click();
  await expect(page.getByText('Ingresa el código del almacén.')).toBeVisible();

  // the code is accepted in lower case and saved in upper case; a code that exists is refused under the field
  await page.locator('#warehouse-code').fill(SEEDED_MAIN.toLowerCase());
  await page.locator('#warehouse-name').fill('Almacén de prueba');
  await choose(page, 'warehouse-branch', BRANCH);
  await page.getByRole('button', { name: 'Crear almacén' }).click();
  await expect(page.getByText('Ya existe un almacén con este código.')).toBeVisible();

  await page.locator('#warehouse-code').fill(CODE.toLowerCase());
  await page.getByRole('button', { name: 'Crear almacén' }).click();
  await expect(page.getByText('Almacén creado').last()).toBeVisible();
  await expect(page).toHaveURL(/\/inventory\/warehouses$/);

  await search(page, CODE);
  await expect(row(page, CODE)).toContainText(BRANCH);
  await expect(row(page, CODE)).toContainText('Activo');
  await expect(mainPill(page, CODE)).toHaveCount(0);

  // marking it as main takes the flag from HK-01
  await edit(page, CODE);
  await takeMain(page, SEEDED_MAIN);
  await expect(mainPill(page, CODE)).toBeVisible();
  await page.goto(`/inventory/warehouses?q=${SEEDED_MAIN}`);
  await expect(row(page, SEEDED_MAIN)).toBeVisible();
  await expect(mainPill(page, SEEDED_MAIN)).toHaveCount(0);

  // clean up: HK-01 is the main one again, and the new warehouse (empty, no longer main) is deactivated
  await edit(page, SEEDED_MAIN);
  await takeMain(page, CODE);
  await edit(page, CODE);
  await page.locator('label', { hasText: 'Estado del almacén' }).click();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(page.getByText('Almacén actualizado').last()).toBeVisible();
  await search(page, CODE);
  await expect(row(page, CODE)).toContainText('Inactivo');
  await search(page, SEEDED_MAIN);
  await expect(mainPill(page, SEEDED_MAIN)).toBeVisible();
});

test('does not let the main warehouse be deactivated', async ({ page }) => {
  await edit(page, SEEDED_MAIN);
  await expect(page.locator('#warehouse-active')).toBeDisabled();
  await expect(page.getByText('Para cambiar el principal, marca otro almacén')).toBeVisible();
});
