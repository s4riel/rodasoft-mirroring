import { expect, Page, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-18 · transfers: list (IN-05) and editor (IN-06a to IN-06d). Needs the demo catalog from `pnpm db:seed`, whose
 * products have stock in every warehouse. Sending takes pieces out of the origin and there is no way back until receipts
 * exist (HU-INV-21), so each run moves 1 piece of 6206-2RS from Huayna Kapac to Sacaba and leaves that transfer in transit.
 */

const ORIGIN = 'Huayna Kapac · Principal';
const DESTINATION = 'Sacaba · Principal';
const SEARCHED = '6205-2RS';
const PASTED = '6206-2RS';
const PASTED_TOO = '6207-2RS';

/** Chooses an option of an `rs-select` by its inputId (the combobox button) and the exact option label. */
async function choose(page: Page, inputId: string, label: string) {
  await page.locator(`#${inputId}`).click();
  await page.locator('li[role="option"]').filter({ hasText: label }).click();
}

const line = (page: Page, code: string) => page.locator('rs-doc-table tbody tr').filter({ has: page.getByText(code, { exact: true }) });
const modal = (page: Page) => page.getByRole('dialog');

async function newTransfer(page: Page) {
  await page.goto('/inventory/products');
  await page.getByRole('link', { name: 'Transferencias' }).click();
  await expect(page).toHaveURL(/\/inventory\/transfers$/);
  await page.getByRole('button', { name: 'Nueva transferencia' }).first().click();
  await expect(page).toHaveURL(/\/inventory\/transfers\/new$/);
  await choose(page, 'transfer-origin', ORIGIN);
  await choose(page, 'transfer-destination', DESTINATION);
}

/** The stock of the origin shown on the line, read from its "Stock origen" cell. */
async function stockOnLine(page: Page, code: string): Promise<number> {
  const cell = line(page, code).locator('td').nth(2);
  return Number((await cell.innerText()).replace(/\D/g, ''));
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('a new transfer without products shows the illustrated empty state and cannot be sent', async ({ page }) => {
  await newTransfer(page);
  await expect(page.getByText('Aún no hay productos en esta transferencia', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pegar lista de códigos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Importar Excel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enviar transferencia' })).toBeDisabled();
});

test('builds a transfer by search and paste, sends it, and the stock leaves the origin', async ({ page }) => {
  await newTransfer(page);

  // IN-06a · search by code and Enter adds the first result
  await page.getByRole('searchbox', { name: 'Buscar por código, marca o medida' }).fill(SEARCHED);
  await page.getByRole('searchbox', { name: 'Buscar por código, marca o medida' }).press('Enter');
  await expect(line(page, SEARCHED)).toBeVisible();

  // IN-06b · paste a list: the unknown code is flagged and left out
  await page.getByRole('button', { name: 'Pegar lista de códigos' }).click();
  await modal(page).getByRole('textbox', { name: 'Lista de productos' }).fill(`${PASTED}, 1\n${PASTED_TOO}, 2\nNO-SUCH-CODE, 1`);
  await modal(page).getByRole('button', { name: 'Revisar' }).click();
  await expect(modal(page)).toContainText('No encontrado');
  await expect(modal(page)).toContainText('Reconocidos');
  await modal(page).getByRole('button', { name: 'Agregar 2 productos' }).click();

  await expect(line(page, PASTED)).toBeVisible();
  await expect(line(page, PASTED_TOO)).toBeVisible();
  await expect(line(page, 'NO-SUCH-CODE')).toHaveCount(0);
  const before = await stockOnLine(page, PASTED);

  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page.getByText('Borrador guardado').last()).toBeVisible();
  await expect(page).toHaveURL(/\/inventory\/transfers\/[0-9a-f-]{36}\/edit$/);

  // IN-06 · send: back to the list, where it is in transit
  await page.getByRole('button', { name: 'Enviar transferencia' }).click();
  await expect(page).toHaveURL(/\/inventory\/transfers$/);
  await expect(page.getByText(/enviada: el stock salió del origen/).last()).toBeVisible();
  await expect(page.locator('rs-doc-table tbody tr').first()).toContainText('En tránsito');
  await expect(page.locator('rs-doc-table tbody tr').first()).toContainText('Huayna Kapac');

  // the origin stock went down and the destination shows the pieces on their way
  await page.goto(`/inventory/products?search=${PASTED}`);
  const row = page
    .locator('rs-product-table .row:not(.header):not(.footer)')
    .filter({ has: page.getByText(PASTED, { exact: true }) })
    .first();
  await row.getByRole('button', { name: /Acciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Ver detalles' }).click();
  await page.getByRole('tab', { name: 'Stock por almacén' }).click();
  const origin = page.locator('rs-doc-table tbody tr').filter({ hasText: 'Huayna Kapac' }).filter({ hasText: 'Principal' });
  await expect(origin).toContainText(String(before - 1));
  const destination = page.locator('rs-doc-table tbody tr').filter({ hasText: 'Sacaba' }).filter({ hasText: 'Principal' });
  // earlier runs left their piece in transit too, so the figure only has to be at least this run's piece
  await expect(destination).toContainText(/En tránsito: [1-9]\d*/);
});

test('asks before leaving a draft with unsaved changes', async ({ page }) => {
  await newTransfer(page);
  await page.getByRole('searchbox', { name: 'Buscar por código, marca o medida' }).fill(SEARCHED);
  await page.getByRole('searchbox', { name: 'Buscar por código, marca o medida' }).press('Enter');
  await expect(line(page, SEARCHED)).toBeVisible();

  await page.getByRole('link', { name: 'Productos' }).first().click();
  await expect(modal(page)).toContainText('Tienes cambios sin guardar');
  await modal(page).getByRole('button', { name: 'Seguir editando' }).click();
  await expect(page).toHaveURL(/\/inventory\/transfers\/new$/);
  await expect(line(page, SEARCHED)).toBeVisible();
});

test('ticks several found products and adds them with one button', async ({ page }) => {
  await newTransfer(page);
  await page.getByRole('searchbox', { name: 'Buscar por código, marca o medida' }).fill('6205');

  const results = page.locator('.results-list input[type="checkbox"]');
  await expect(results.first()).toBeVisible();
  expect(await results.count()).toBeGreaterThanOrEqual(2);
  const add = page.getByRole('button', { name: /Agregar seleccionados/ });
  await expect(add).toBeDisabled();

  await results.nth(0).check();
  await results.nth(1).check();
  await expect(page.getByText('2 seleccionados')).toBeVisible();
  await add.click();

  await expect(page.locator('rs-doc-table tbody tr')).toHaveCount(2);
  await expect(page.locator('.results')).toHaveCount(0);
});
