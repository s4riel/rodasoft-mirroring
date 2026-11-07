import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-14 · asking for the cancellation of a sale: after a cash sale, the detail offers "Solicitar anulación"; with a
 * reason and a comment the sale waits as "Anulación pendiente" (banner and history say so, and the sale cannot be asked
 * again), and "Retirar solicitud" puts it back to paid. Needs the demo data from `pnpm db:seed`; like the sales history
 * flow it closes the administrator's open shifts and drops their open carts straight in the database before and after.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';

const prisma = new PrismaClient();
let code = '';

async function reset() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) return;
  await prisma.posCheckout.deleteMany({ where: { cashierId: user.id, status: { in: ['OPEN', 'PAYING'] } } });
  await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
}

test.beforeAll(async () => {
  await reset();
  const register = await prisma.cashRegister.findFirstOrThrow({
    where: { status: 'ACTIVE', branch: { name: BRANCH } },
    orderBy: { name: 'asc' },
    select: { warehouseId: true },
  });
  const levels = await prisma.stockLevel.findMany({
    where: { warehouseId: register.warehouseId, product: { status: 'ACTIVE', manufacturerCode: { startsWith: '6205' } } },
    select: { quantity: true, reserved: true, product: { select: { manufacturerCode: true } } },
    orderBy: { product: { manufacturerCode: 'asc' } },
  });
  const level = levels.find((l) => l.quantity - l.reserved >= 4);
  if (!level) throw new Error('The seed has no 6205 bearing with at least 4 units in the register warehouse');
  code = level.product.manufacturerCode;
});

test.afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

test('a paid sale is asked to be cancelled, waits for Management and the request can be withdrawn', async ({ page }) => {
  await login(page);

  // open the register and sell one unit in cash
  await page.goto('/sales/cash-register/open');
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await page.locator('#cash-float').fill('500,00');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page).toHaveURL(/\/sales\/pos$/);

  await page.keyboard.press('F2');
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  await search.fill(code);
  await expect(page.locator('rs-pos-result-row').first()).toContainText(code);
  await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items') && r.request().method() === 'POST'), search.press('Enter')]);
  await expect(page.getByRole('complementary', { name: 'Venta actual' }).locator('rs-pos-cart-line')).toHaveCount(1);

  await page.keyboard.press('F9');
  const payment = page.getByRole('dialog', { name: 'Cobrar venta' });
  await expect(payment).toBeVisible();
  await payment.locator('.quick rs-filter-chip button').first().click();
  await page.keyboard.press('Enter');

  const done = page.getByRole('dialog', { name: 'Venta completada' });
  await expect(done).toBeVisible();
  const number = (await done.getByTestId('sale-subtitle').textContent())?.match(/V-\d{6}/)?.[0] ?? '';
  expect(number).not.toBe('');
  await done.getByTestId('sale-view').click();
  await expect(page.getByRole('heading', { name: `Venta ${number}` })).toBeVisible();
  await expect(page.locator('rs-status-pill').first()).toContainText('Pagada');

  // the dialog cannot be sent until a reason and a comment are given
  await page.getByTestId('sale-cancel-request').click();
  const dialog = page.getByRole('dialog', { name: `Solicitar anulación de la venta ${number}` });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('La factura sigue válida hasta que Gerencia apruebe');
  const send = dialog.getByTestId('cancellation-send');
  await expect(send).toBeDisabled();
  await dialog.getByRole('button', { name: 'Error en datos del cliente' }).click();
  await expect(send).toBeDisabled();
  await dialog.getByLabel('Comentario *').fill('El cliente pidió la factura a nombre de otra empresa');
  await expect(send).toBeEnabled();
  await send.click();

  // the sale waits for Management: pill, banner and history say so, and it cannot be asked again
  await expect(page.getByTestId('sale-cancel-pending')).toContainText('Anulación pendiente de aprobación');
  await expect(page.getByTestId('sale-cancel-pending')).toContainText('motivo: error en datos del cliente');
  await expect(page.locator('rs-status-pill').first()).toContainText('Anulación pendiente');
  await expect(page.getByText('Anulación solicitada · esperando a Gerencia')).toBeVisible();
  await expect(page.getByTestId('sale-cancel-request')).toHaveCount(0);

  // it stays pending after a reload, and the list shows the status
  await page.reload();
  await expect(page.getByTestId('sale-cancel-pending')).toBeVisible();
  await page.goto('/sales/history');
  await expect(page.locator('rs-doc-table tbody tr').first()).toContainText(number);
  await expect(page.locator('rs-doc-table tbody tr').first()).toContainText('Anulación pendiente');

  // withdrawing the request puts the sale back to paid and lets it be asked again
  await page.locator('rs-doc-table tbody tr').first().getByRole('link', { name: number }).click();
  await page.getByTestId('sale-cancel-withdraw').click();
  await page.getByTestId('sale-cancel-withdraw-confirm').click();
  await expect(page.getByTestId('sale-cancel-pending')).toHaveCount(0);
  await expect(page.locator('rs-status-pill').first()).toContainText('Pagada');
  await expect(page.getByText('Solicitud de anulación retirada')).toBeVisible();
  await expect(page.getByTestId('sale-cancel-request')).toBeVisible();
});
