import { expect, Page, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-INV-21 · receive a transfer piece by piece: Por recibir (IN-24a), the receipt (IN-24b) and the differences (IN-07).
 * Needs the demo catalog from `pnpm db:seed`. Each run sends 4 pieces of 6206-2RS and 2 of 6207-2RS from Huayna Kapac to
 * Sacaba, receives them in two steps and closes the receipt with 1 surplus piece of 6207-2RS, which leaves a pending adjustment.
 */

const ORIGIN = 'Huayna Kapac · Principal';
const DESTINATION = 'Sacaba · Principal';
const FIRST = '6206-2RS';
const SECOND = '6207-2RS';

async function choose(page: Page, inputId: string, label: string) {
  await page.locator(`#${inputId}`).click();
  await page.locator('li[role="option"]').filter({ hasText: label }).click();
}

const modal = (page: Page) => page.getByRole('dialog');
const received = (page: Page, code: string) => page.getByRole('textbox', { name: `Piezas recibidas de ${code}` });

/** Sends a two-product transfer from the origin to the destination and leaves it in transit. */
async function sendTransfer(page: Page) {
  await page.goto('/inventory/transfers/new');
  await choose(page, 'transfer-origin', ORIGIN);
  await choose(page, 'transfer-destination', DESTINATION);
  await page.getByRole('button', { name: 'Pegar lista de códigos' }).click();
  await modal(page).getByRole('textbox', { name: 'Lista de productos' }).fill(`${FIRST}, 4\n${SECOND}, 2`);
  await modal(page).getByRole('button', { name: 'Revisar' }).click();
  await modal(page).getByRole('button', { name: 'Agregar 2 productos' }).click();
  await page.getByRole('button', { name: 'Guardar borrador' }).click();
  await expect(page).toHaveURL(/\/inventory\/transfers\/[0-9a-f-]{36}\/edit$/);
  await page.getByRole('button', { name: 'Enviar transferencia' }).click();
  await expect(page).toHaveURL(/\/inventory\/transfers$/);
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('receives a transfer in two steps, closes it with a surplus and leaves a pending adjustment', async ({ page }) => {
  await sendTransfer(page);

  // IN-24a · Por recibir lists it as in transit
  await page.getByRole('button', { name: 'Por recibir' }).click();
  await expect(page).toHaveURL(/\/inventory\/transfers\/incoming$/);
  const first = page.locator('rs-doc-table tbody tr').first();
  await expect(first).toContainText('En tránsito');
  const number = (await first.locator('a.number').innerText()).trim();
  await first.getByRole('link', { name: number }).click();
  await expect(page.getByText('En tránsito').first()).toBeVisible();
  // IN-24b · "Recibir Productos" turns the same table into the receipt, without leaving the detail
  await page.getByRole('button', { name: 'Recibir Productos' }).click();
  await expect(page).not.toHaveURL(/\/receive/);
  await expect(page.getByRole('button', { name: 'Recibir todo' })).toBeVisible();

  // first step: 2 of the 4 pieces of the first product
  await received(page, FIRST).fill('2');
  await page.getByRole('button', { name: 'Registrar recepción' }).click();
  await expect(page.getByText('Recepción registrada').last()).toBeVisible();
  await expect(page.getByText('Recibida parcialmente').first()).toBeVisible();

  // second step: everything else is counted with "Recibir todo", and the second product also has a surplus piece
  await page.getByRole('button', { name: 'Recibir Productos' }).click();
  await page.getByRole('button', { name: 'Recibir todo' }).click();
  await page.getByRole('button', { name: 'Finalizar recepción' }).click();

  // IN-07 · no shortage, only the surplus typed here
  await expect(modal(page)).toContainText('Diferencias de la recepción');
  await expect(modal(page)).toContainText('Sin diferencias');
  await choose(page, 'surplus-product', SECOND);
  await modal(page).locator('#surplus-quantity').fill('1');
  await expect(modal(page)).toContainText('Sobrante');
  await expect(modal(page)).toContainText('Se generará un ajuste pendiente de aprobación');
  await modal(page).getByRole('button', { name: 'Confirmar' }).click();

  // the detail: received, with the banner of the adjustment
  await expect(page).toHaveURL(/\/inventory\/transfers\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Recibida', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Ajuste pendiente AJ-\d+/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recibir Productos' })).toHaveCount(0);
});

test('cancels a transfer that is in transit and its pieces go back to the origin', async ({ page }) => {
  await sendTransfer(page);

  await page.locator('rs-doc-table tbody tr').first().locator('a.number').click();
  await expect(page.getByText('En tránsito').first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar transferencia' }).click();
  await expect(modal(page)).toContainText('¿Cancelar la transferencia?');
  await modal(page).getByRole('button', { name: 'Cancelar transferencia' }).click();

  await expect(page.getByText(/Las piezas volvieron a/).last()).toBeVisible();
  await expect(page.getByText('Cancelada', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancelar transferencia' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Recibir Productos' })).toHaveCount(0);
});
