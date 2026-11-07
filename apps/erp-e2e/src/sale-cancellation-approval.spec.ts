import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-15 · Management decides the cancellation of a sale: after asking for it (HU-VEN-14) the detail offers "Ver solicitud
 * (Gerencia)". Rejecting needs a reply and puts the sale back to paid with that reply; approving cancels the sale, returns the
 * stock to the warehouse and registers the refund in the open shift of the register. Needs the demo data from `pnpm db:seed`;
 * like the other sales flows it closes the administrator's open shifts and drops their open carts in the database before and
 * after. The administrator holds both permissions, so the same user asks and decides (self-approval is allowed).
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';

const prisma = new PrismaClient();
let code = '';
let productId = '';
let warehouseId = '';

async function reset() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) return;
  await prisma.posCheckout.deleteMany({ where: { cashierId: user.id, status: { in: ['OPEN', 'PAYING'] } } });
  await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
}

const onHand = async () => (await prisma.stockLevel.findFirstOrThrow({ where: { productId, warehouseId }, select: { quantity: true } })).quantity;

test.beforeAll(async () => {
  await reset();
  const register = await prisma.cashRegister.findFirstOrThrow({
    where: { status: 'ACTIVE', branch: { name: BRANCH } },
    orderBy: { name: 'asc' },
    select: { warehouseId: true },
  });
  warehouseId = register.warehouseId;
  const levels = await prisma.stockLevel.findMany({
    where: { warehouseId, product: { status: 'ACTIVE', manufacturerCode: { startsWith: '6205' } } },
    select: { quantity: true, reserved: true, product: { select: { id: true, manufacturerCode: true } } },
    orderBy: { product: { manufacturerCode: 'asc' } },
  });
  const level = levels.find((l) => l.quantity - l.reserved >= 4);
  if (!level) throw new Error('The seed has no 6205 bearing with at least 4 units in the register warehouse');
  code = level.product.manufacturerCode;
  productId = level.product.id;
});

test.afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

/** Opens the register and sells one unit in cash; returns the number of the sale, standing on its detail. */
async function sellOne(page: Page): Promise<string> {
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
  await expect(page.getByRole('heading', { name: `Venta ${number}`, exact: true })).toBeVisible();
  return number;
}

/** Asks for the cancellation of the sale on screen. */
async function askForCancellation(page: Page, number: string) {
  await page.getByTestId('sale-cancel-request').click();
  const dialog = page.getByRole('dialog', { name: `Solicitar anulación de la venta ${number}` });
  await dialog.getByRole('button', { name: 'Error en datos del cliente' }).click();
  await dialog.getByLabel('Comentario *').fill('El cliente pidió la factura a nombre de otra empresa');
  await dialog.getByTestId('cancellation-send').click();
  await expect(page.getByTestId('sale-cancel-pending')).toBeVisible();
}

test('Management rejects a request with a reply, then approves it: the sale is cancelled and the stock comes back', async ({ page }) => {
  await login(page);
  const before = await onHand();
  const number = await sellOne(page);
  expect(await onHand()).toBe(before - 1);
  await askForCancellation(page, number);

  // the request page shows what an approval will do
  await page.getByTestId('sale-cancel-review').click();
  await expect(page.getByRole('heading', { name: `Aprobar anulación · Venta ${number}` })).toBeVisible();
  await expect(page.locator('rs-status-pill', { hasText: 'Por aprobar' })).toBeVisible();
  await expect(page.getByTestId('review-comment')).toContainText('El cliente pidió la factura a nombre de otra empresa');
  await expect(page.getByTestId('review-impact')).toContainText('el stock (1 pieza) vuelve a');
  await expect(page.getByTestId('review-impact')).toContainText('se registra el reembolso de');

  // rejecting needs a reply for the cashier
  await page.getByTestId('review-reject').click();
  await expect(page.getByText('Escribe la respuesta para el cajero antes de rechazar.')).toBeVisible();
  await page.getByLabel(/Respuesta/).fill('La factura ya se entregó al cliente');
  await page.getByTestId('review-reject').click();

  // the sale is paid again and says why; nothing moved
  await expect(page.getByRole('heading', { name: `Venta ${number}`, exact: true })).toBeVisible();
  await expect(page.locator('rs-status-pill', { hasText: 'Pagada' }).first()).toBeVisible();
  await expect(page.getByTestId('sale-cancel-decision')).toContainText('Anulación rechazada');
  await expect(page.getByTestId('sale-cancel-decision')).toContainText('La factura ya se entregó al cliente');
  expect(await onHand()).toBe(before - 1);

  // asking again and approving cancels the sale
  await askForCancellation(page, number);
  await page.getByTestId('sale-cancel-review').click();
  await page.getByTestId('review-approve').click();
  await page.getByTestId('review-approve-confirm').click();

  await expect(page.getByRole('heading', { name: `Venta ${number}`, exact: true })).toBeVisible();
  await expect(page.locator('rs-status-pill', { hasText: 'Anulada' }).first()).toBeVisible();
  await expect(page.getByTestId('sale-cancel-decision')).toContainText('Venta anulada');
  await expect(page.getByTestId('sale-cancel-decision')).toContainText('1 pieza devuelta a');
  await expect(page.getByTestId('sale-cancel-decision')).toContainText('reembolso');
  await expect(page.getByText('Anulación aprobada · factura anulada')).toBeVisible();
  await expect(page.getByTestId('sale-cancel-request')).toHaveCount(0);
  expect(await onHand()).toBe(before);

  // it stays cancelled after a reload and the list shows the status
  await page.reload();
  await expect(page.locator('rs-status-pill', { hasText: 'Anulada' }).first()).toBeVisible();
  await page.goto('/sales/history');
  await expect(page.locator('rs-doc-table tbody tr').first()).toContainText('Anulada');
});
