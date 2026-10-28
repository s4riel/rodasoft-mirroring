import { expect, type Page, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-13 · link equivalents with validations (Figma IN-15c, IN-15d, IN-15e). Needs the demo catalog from `pnpm db:seed`:
 * the 6205-2RS is already linked to 6205-DDU; 6204-2RSR (NTN) and 6204-2RS1 (INA) are equivalents of the 6204-2RS but not
 * of each other; 6207-2RS (NTN) and 6208-2RS (Fersa) are unlinked and differ in d × D × B. Every test that links also
 * unlinks, so the demo catalog the other specs count on is left as it was.
 */

type Side = 'origen' | 'equivalente';

/** Searches a product in the field of a side and chooses the first match. */
async function pick(page: Page, side: Side, code: string) {
  const search = page.getByRole('searchbox', { name: side === 'origen' ? 'Buscar rodamiento de origen' : 'Buscar rodamiento equivalente' });
  await search.fill(code);
  await page.locator('.result').filter({ hasText: code }).first().click();
  await expect(page.locator(side === 'origen' ? '#link-origin' : '#link-equivalent')).toContainText(code);
}

/** The origin and what it is already linked to are not offered as its equivalent: this code finds nothing. */
async function notOffered(page: Page, code: string) {
  await page.getByRole('searchbox', { name: 'Buscar rodamiento equivalente' }).fill(code);
  await expect(page.getByText('No encontramos productos con esa búsqueda.')).toBeVisible();
  await expect(page.locator('.result')).toHaveCount(0);
}

async function openLinkFromList(page: Page) {
  await page.goto('/inventory/equivalences');
  await expect(page.locator('rs-doc-table tbody tr').first()).toBeVisible();
  await page.getByRole('button', { name: 'Vincular equivalencias' }).click();
  await expect(page).toHaveURL(/\/inventory\/equivalences\/new$/);
  await expect(page.getByRole('heading', { name: 'Vincular equivalencia', level: 1 })).toBeVisible();
}

/** Unlinks the row that has both codes (a code alone can be on several links). */
async function unlink(page: Page, code: string, other: string) {
  await page.goto(`/inventory/equivalences?q=${code}`);
  const row = page.locator('rs-doc-table tbody tr').filter({ hasText: code }).filter({ hasText: other });
  await expect(row).toHaveCount(1);
  await row.getByRole('button', { name: 'Desvincular' }).click();
  const dialog = page.locator('rs-equivalence-unlink-dialog');
  await expect(dialog).toContainText('¿Desvincular equivalencia?');
  await dialog.getByRole('button', { name: 'Desvincular' }).click();
  await expect(page.getByText('Equivalencia desvinculada')).toBeVisible();
  await expect(page.locator('rs-doc-table tbody tr').filter({ hasText: code }).filter({ hasText: other })).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('shows the layout of the design: card, fields with their hints, the info note and the action bar (IN-15c)', async ({ page }) => {
  await openLinkFromList(page);
  await expect(page.getByText('Relaciona un rodamiento con su equivalente de otra marca y registra en qué se diferencian.')).toBeVisible();
  await expect(page.getByText('Datos de la equivalencia')).toBeVisible();
  for (const label of ['Rodamiento de origen', 'Rodamiento equivalente', 'Tipo de equivalencia', 'Registrada por', 'Diferencias observadas']) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('Se registra con usuario y fecha')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar equivalencia' })).toBeDisabled();
});

test('does not offer what is already linked, from the product sheet, and goes back to it (IN-15d)', async ({ page }) => {
  await page.goto('/inventory/products?search=6205-2RS');
  const row = page
    .locator('rs-product-table .row:not(.header):not(.footer)')
    .filter({ has: page.getByText('6205-2RS', { exact: true }) })
    .first();
  await row.getByRole('button', { name: /Acciones de/ }).click();
  await page.getByRole('menuitem', { name: 'Ver detalles' }).click();
  await page.getByRole('tab', { name: 'Equivalentes' }).click();
  await page.getByRole('button', { name: 'Vincular', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory\/equivalences\/new\?productId=/);

  // the product of the sheet is the origin and cannot be changed
  await expect(page.locator('#link-origin')).toContainText('6205-2RS');
  await expect(page.getByRole('searchbox', { name: 'Buscar rodamiento de origen' })).toHaveCount(0);

  // 6205-DDU is already an equivalent of the origin: it is not offered again
  await notOffered(page, '6205-DDU');
  await expect(page.getByRole('button', { name: 'Guardar equivalencia' })).toBeDisabled();

  await page.getByRole('button', { name: 'Cancelar' }).click();
  await expect(page).toHaveURL(/\/inventory\/products\/[0-9a-f-]{36}\/equivalents$/);
});

test('links two compatible products with notes, shows them, rejects the pair again and unlinks it (IN-15c)', async ({ page }) => {
  await openLinkFromList(page);
  await pick(page, 'origen', '6204-2RSR');
  await pick(page, 'equivalente', '6204-2RS1');
  await expect(page.locator('#link-type')).toContainText('Exacta');
  await page.locator('#link-notes').fill('Mismas medidas y sello.');

  await page.getByRole('button', { name: 'Guardar equivalencia' }).click();
  await expect(page.getByText('Equivalencia vinculada')).toBeVisible();
  await expect(page).toHaveURL(/\/inventory\/equivalences$/);

  await page.goto('/inventory/equivalences?q=6204-2RS1');
  const row = page.locator('rs-doc-table tbody tr').filter({ hasText: '6204-2RSR' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Exacta');

  // the pair is linked: from the other product it is not offered again
  await page.getByRole('button', { name: 'Vincular equivalencias' }).click();
  await pick(page, 'origen', '6204-2RS1');
  await notOffered(page, '6204-2RSR');
  await expect(page.getByRole('button', { name: 'Guardar equivalencia' })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancelar' }).click();

  await unlink(page, '6204-2RS1', '6204-2RSR');
});

test('classifies a link as a substitute and shows it as such in the list (IN-15c)', async ({ page }) => {
  await openLinkFromList(page);
  await pick(page, 'origen', '6204-2RSR');
  await pick(page, 'equivalente', '6204-2RS1');
  await page.locator('#link-type').click();
  await page.getByRole('option', { name: 'Sustituto' }).click();
  await expect(page.locator('#link-type')).toContainText('Sustituto');
  await page.getByRole('button', { name: 'Guardar equivalencia' }).click();
  await expect(page.getByText('Equivalencia vinculada')).toBeVisible();

  await page.goto('/inventory/equivalences?q=6204-2RS1');
  const row = page.locator('rs-doc-table tbody tr').filter({ hasText: '6204-2RSR' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Sustituto');

  await unlink(page, '6204-2RS1', '6204-2RSR');
});

test('blocks a pair whose measurements differ, with the message of the design and no way to force it (IN-15e)', async ({ page }) => {
  await openLinkFromList(page);
  await pick(page, 'origen', '6207-2RS');
  await pick(page, 'equivalente', '6208-2RS');

  await expect(page.getByText('Medidas: 35×72×17 mm (origen) frente a 40×80×18 mm (equivalente).')).toBeVisible();
  await expect(page.getByText('Las medidas no coinciden. Revisa el rodamiento equivalente antes de continuar.')).toBeVisible();
  await expect(page.getByText('No se pudo guardar')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar equivalencia' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Vincular de todos modos' })).toHaveCount(0);

  // another product clears the error
  await page.getByRole('button', { name: 'Cambiar el rodamiento equivalente' }).click();
  await expect(page.getByText('Las medidas no coinciden')).toHaveCount(0);
});
