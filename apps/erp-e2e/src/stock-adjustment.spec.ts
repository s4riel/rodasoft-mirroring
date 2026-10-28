import { expect, Page, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-16 · quick stock adjustment from the product sheet (IN-17). Needs the demo catalog from `pnpm db:seed`. Each test
 * puts back what it takes, so the stock of the seeded catalog ends where it started; the adjustments stay in the history
 * of the 6205-2RS, which only adds movements.
 */

/** Chooses an option of an `rs-select` by its inputId (the combobox button) and the exact option label. */
async function choose(page: Page, inputId: string, label: string) {
  await page.locator(`#${inputId}`).click();
  await page.getByRole('dialog').getByRole('option', { name: label, exact: true }).click();
}

async function openSheet(page: Page) {
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
}

const BRANCH = 'Huayna Kapac';
const WAREHOUSE = 'Principal';
const confirm = (page: Page) => page.getByRole('dialog').getByRole('button', { name: 'Confirmar ajuste' });
const chip = (page: Page, label: string) => page.getByRole('dialog').locator('rs-filter-chip button', { hasText: label });

/**
 * Opens the dialog on the warehouse of the tests (the branch has several, so it also asks for the warehouse) and reads its
 * stock: a count of 0 makes the result note say "N → 0", which names the stock on hand. Leaves the count kind chosen.
 */
async function openOnWarehouse(page: Page): Promise<number> {
  await page.getByRole('button', { name: 'Ajustar stock' }).click();
  const dialog = page.getByRole('dialog');
  await choose(page, 'adjust-branch', BRANCH);
  await choose(page, 'adjust-warehouse', WAREHOUSE);
  await chip(page, 'Corrección de conteo').click();
  await dialog.locator('#adjust-quantity').fill('0');
  const note = dialog.locator('rs-note');
  await expect(note).toContainText('→ 0');
  return Number(/(\d+) → 0/.exec((await note.textContent()) ?? '')?.[1]);
}

/** Fills and sends the dialog; returns the number of the adjustment shown in the toast. */
async function adjust(page: Page, kind: 'Entrada' | 'Salida', quantity: string, reason: string): Promise<string> {
  await openOnWarehouse(page);
  await chip(page, kind).click();
  await page.getByRole('dialog').locator('#adjust-quantity').fill(quantity);
  await choose(page, 'adjust-reason', reason);
  await confirm(page).click();
  const toast = page.getByText(/Ajuste AJ-\d{6} registrado/).last();
  await expect(toast).toBeVisible();
  const match = /AJ-\d{6}/.exec((await toast.textContent()) ?? '');
  return match ? match[0] : '';
}

test.beforeEach(async ({ page }) => {
  await login(page);
  await openSheet(page);
});

test('adjusts the stock out of a branch with a reason and shows it in the movements', async ({ page }) => {
  const before = await openOnWarehouse(page);
  const dialog = page.getByRole('dialog');
  expect(before).toBeGreaterThanOrEqual(3);
  await dialog.locator('#adjust-quantity').fill('');
  await expect(dialog.getByText('Tipo de ajuste')).toBeVisible();
  await expect(dialog.locator('.subtitle')).toContainText(`Stock actual`);
  await expect(dialog.locator('rs-filter-chip button')).toHaveText(['Entrada', 'Salida', 'Corrección de conteo']);

  // nothing can be confirmed until kind, quantity and reason are set
  await expect(confirm(page)).toBeDisabled();
  await chip(page, 'Salida').click();
  await dialog.locator('#adjust-quantity').fill('3');
  await expect(confirm(page)).toBeDisabled();
  await choose(page, 'adjust-reason', 'Merma');
  await dialog.locator('#adjust-note').fill('Golpe durante el traslado');
  await expect(dialog.locator('rs-note')).toContainText(`Stock resultante: ${before - 3} piezas`);
  await expect(dialog.locator('rs-note')).toContainText(`${before} − 3.`);
  await confirm(page).click();

  const toast = page.getByText(/Ajuste AJ-\d{6} registrado/);
  await expect(toast).toBeVisible();
  const number = /AJ-\d{6}/.exec((await toast.textContent()) ?? '')?.[0] ?? '';
  await expect(dialog).toHaveCount(0);

  // the movements tab lists it as a signed outflow with the new balance
  await page.getByRole('tab', { name: 'Movimientos' }).click();
  const first = page.locator('rs-doc-table tbody tr').first();
  await expect(first).toContainText(`Ajuste ${number}`);
  await expect(first).toContainText('−3');
  await expect(first).toContainText(String(before - 3));

  // the stock per warehouse went down by the same three pieces
  await page.getByRole('tab', { name: 'Stock por almacén' }).click();
  const branchRow = page.locator('rs-doc-table tbody tr').filter({ hasText: BRANCH }).filter({ hasText: WAREHOUSE });
  await expect(branchRow).toContainText(String(before - 3));

  // put them back, so the seeded stock ends where it started
  await adjust(page, 'Entrada', '3', 'Error de conteo');
  await page.getByRole('tab', { name: 'Stock por almacén' }).click();
  await expect(branchRow).toContainText(String(before));
});

test('corrects the stock to a counted quantity and shows the difference', async ({ page }) => {
  const before = await openOnWarehouse(page);
  const dialog = page.getByRole('dialog');
  await dialog.locator('#adjust-quantity').fill(String(before));
  await choose(page, 'adjust-reason', 'Error de conteo');
  await expect(dialog).toContainText('El conteo es igual al stock actual');
  await expect(confirm(page)).toBeDisabled();

  await dialog.locator('#adjust-quantity').fill(String(before - 2));
  await expect(dialog.locator('rs-note')).toContainText(`${before} → ${before - 2} (−2).`);
  await confirm(page).click();
  await expect(page.getByText(/Ajuste AJ-\d{6} registrado/)).toBeVisible();

  // count back up to the seeded stock
  await openOnWarehouse(page);
  await dialog.locator('#adjust-quantity').fill(String(before));
  await choose(page, 'adjust-reason', 'Error de conteo');
  await confirm(page).click();
  await expect(dialog).toHaveCount(0);
});

test('asks for a comment when the reason is "Otro", and refuses more than the branch holds', async ({ page }) => {
  await openOnWarehouse(page);
  const dialog = page.getByRole('dialog');
  await chip(page, 'Salida').click();
  await dialog.locator('#adjust-quantity').fill('1');
  await choose(page, 'adjust-reason', 'Otro');
  await expect(confirm(page)).toBeDisabled();
  await dialog.locator('#adjust-note').fill('Muestra para un cliente');
  await expect(confirm(page)).toBeEnabled();

  await dialog.locator('#adjust-quantity').fill('9999999');
  await expect(dialog).toContainText('No hay stock suficiente en el almacén para esta salida.');
  await expect(confirm(page)).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
