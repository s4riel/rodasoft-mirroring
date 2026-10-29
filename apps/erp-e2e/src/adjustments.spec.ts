import { expect, Page, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-22 · adjustment documents: list (IN-27) and new adjustment (IN-08). Needs the demo catalog from `pnpm db:seed`.
 * An adjustment applies at once and cannot be undone, so the main test records a second one that reverses the first and
 * the stock of the seeded catalog ends where it started; both stay in the list and in the history of the two bearings.
 */

const WAREHOUSE = 'Huayna Kapac · Principal';
const FIRST = '6205-2RS';
const SECOND = '6204-2RS';

/** Chooses an option of an `rs-select` by its inputId (the combobox button) and the exact option label. */
async function choose(page: Page, inputId: string, label: string) {
  await page.locator(`#${inputId}`).click();
  await page.locator('li[role="option"]').filter({ hasText: label }).click();
}

const line = (page: Page, code: string) => page.locator('rs-doc-table tbody tr').filter({ has: page.getByText(code, { exact: true }) });

async function openNewAdjustment(page: Page) {
  await page.goto('/inventory/products');
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await expect(page).toHaveURL(/\/inventory\/adjustments$/);
  await page.getByRole('button', { name: 'Nuevo ajuste' }).first().click();
  await expect(page).toHaveURL(/\/inventory\/adjustments\/new$/);
  await choose(page, 'adjustment-warehouse', WAREHOUSE);
}

/** Types the code and presses Enter: the first match becomes a line. */
async function addProduct(page: Page, code: string) {
  await page.locator('#adjustment-search').fill(code);
  await page.locator('#adjustment-search').press('Enter');
  await expect(line(page, code)).toBeVisible();
}

/** Sets the kind and the quantity of the line of a product. */
async function setLine(page: Page, code: string, kind: 'Entrada' | 'Salida' | 'Conteo', quantity: string) {
  const row = line(page, code);
  await row.locator('rs-select button').click();
  await page.locator('li[role="option"]').filter({ hasText: kind }).click();
  await row.locator('input').fill(quantity);
}

/** Confirms and applies; returns the AJ- number shown in the toast. */
async function applyAdjustment(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Confirmar ajuste' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Aplicar ajuste' }).click();
  await expect(page).toHaveURL(/\/inventory\/adjustments$/);
  const toast = page.getByText(/AJ-\d{6} aplicado/).last();
  await expect(toast).toBeVisible();
  return /AJ-\d{6}/.exec((await toast.textContent()) ?? '')?.[0] ?? '';
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('records an adjustment with a reason and two lines, applies it at once and lists it as Aplicado', async ({ page }) => {
  await openNewAdjustment(page);
  await expect(page.getByText('Aún no hay productos en este ajuste', { exact: true })).toBeVisible();

  await addProduct(page, FIRST);
  await addProduct(page, SECOND);
  await setLine(page, FIRST, 'Salida', '1');
  await setLine(page, SECOND, 'Entrada', '1');
  await choose(page, 'adjustment-reason', 'Merma');
  await expect(page.locator('.summary')).toContainText('Piezas que cambian');

  const number = await applyAdjustment(page);
  expect(number).toMatch(/^AJ-\d{6}$/);

  // the list shows it applied, with the reason, and the detail opens read-only
  const row = page.locator('rs-doc-table tbody tr').filter({ has: page.getByText(number, { exact: true }) });
  await expect(row).toContainText('Merma');
  await expect(row).toContainText('Aplicado');
  await row.getByRole('link', { name: number }).click();
  await expect(page).toHaveURL(/\/inventory\/adjustments\/[0-9a-f-]{36}$/);
  await expect(page.getByText(FIRST, { exact: true })).toBeVisible();
  await expect(page.getByText('Aplicado automáticamente')).toBeVisible();

  // put the stock back with a second adjustment, so the seeded catalog ends where it started
  await openNewAdjustment(page);
  await addProduct(page, FIRST);
  await addProduct(page, SECOND);
  await setLine(page, FIRST, 'Entrada', '1');
  await setLine(page, SECOND, 'Salida', '1');
  await choose(page, 'adjustment-reason', 'Error de conteo');
  await applyAdjustment(page);
});

test('asks for the reason and the products before it lets an adjustment through', async ({ page }) => {
  await openNewAdjustment(page);
  await page.getByRole('button', { name: 'Confirmar ajuste' }).click();
  await expect(page.getByText('Elige el motivo del ajuste.').first()).toBeVisible();
  await expect(page.getByText('Agrega al menos un producto al ajuste.')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // the reason "Otro" needs a note
  await choose(page, 'adjustment-reason', 'Otro');
  await addProduct(page, FIRST);
  await setLine(page, FIRST, 'Entrada', '1');
  await page.getByRole('button', { name: 'Confirmar ajuste' }).click();
  await expect(page.getByText('Describe el motivo cuando eliges "Otro".')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('filters the list and shows the "Limpiar filtros" state when nothing matches', async ({ page }) => {
  await page.goto('/inventory/adjustments?q=ZZZ-NO-EXISTE');
  await expect(page.getByText('No encontramos ajustes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Limpiar filtros' }).click();
  await expect(page).toHaveURL(/\/inventory\/adjustments$/);
});
