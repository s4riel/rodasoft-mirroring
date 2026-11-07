import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-10 · paying by card: the terminal declines (VP-12), the cashier retries and the second attempt is approved, which
 * completes the sale; and a decline can end with "Volver a la venta". Needs the demo data from `pnpm db:seed`. A shift cannot
 * be closed from the app yet (HU-VEN-23), so the test closes the administrator's open shifts and drops their open or paying
 * carts straight in the database before and after the run. The completed sale stays (a sale is never deleted) and takes one
 * unit of one bearing from the register's warehouse.
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

const stockOf = async () => (await prisma.stockLevel.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId } } })).quantity;

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
    select: { productId: true, quantity: true, reserved: true, product: { select: { manufacturerCode: true } } },
    orderBy: { product: { manufacturerCode: 'asc' } },
  });
  const level = levels.find((l) => l.quantity - l.reserved >= 4);
  if (!level) throw new Error('The seed has no 6205 bearing with at least 4 units in the register warehouse');
  code = level.product.manufacturerCode;
  productId = level.productId;
});

test.afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

/** Logs in, opens the register when it is closed, adds one bearing and opens "Cobrar venta" on the card screen. */
async function startCardPayment(page: Page) {
  await login(page);
  await page.goto('/sales/pos');
  const closed = page.getByRole('dialog', { name: 'Caja cerrada' });
  await expect(closed.or(page.getByRole('searchbox', { name: 'Buscar producto' }))).toBeVisible();
  if (await closed.isVisible()) {
    await page.goto('/sales/cash-register/open');
    await page.locator('#cash-register').click();
    await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
    await page.locator('#cash-float').fill('500,00');
    await page.getByRole('button', { name: 'Abrir caja' }).click();
    await expect(page).toHaveURL(/\/sales\/pos$/);
  }

  await page.keyboard.press('F2');
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  await search.fill(code);
  await expect(page.locator('rs-pos-result-row').first()).toContainText(code);
  // F9 is ignored while the cart is still being saved, so wait for the server to answer the add
  await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items') && r.request().method() === 'POST'), search.press('Enter')]);
  await expect(page.getByRole('complementary', { name: 'Venta actual' }).locator('rs-pos-cart-line')).toHaveCount(1);

  const cartTotal = (await page.getByTestId('pos-total').textContent())?.trim() ?? '';
  await page.keyboard.press('F9');
  const payment = page.getByRole('dialog', { name: 'Cobrar venta' });
  await expect(payment).toBeVisible();
  await payment.locator('.methods rs-filter-chip').filter({ hasText: 'Tarjeta' }).locator('button').click();
  await expect(payment.getByTestId('card-waiting')).toBeVisible();
  await expect(payment.getByTestId('card-amount')).toHaveText(cartTotal);
  return { payment, cartTotal };
}

/** "Rechazado" with a reason, then the decline screen (VP-12). */
async function declineWith(payment: ReturnType<Page['getByRole']>, reason: string) {
  await payment.getByTestId('card-declined').click();
  // the native radio is drawn by the design system component: the option is chosen by its label
  await payment.locator('rs-radio').filter({ hasText: reason }).click();
  await payment.getByTestId('card-decline-confirm').click();
  await expect(payment.getByText('Tarjeta rechazada', { exact: true }).first()).toBeVisible();
  await expect(payment.getByTestId('card-decline-reason')).toHaveText(reason);
}

test('the terminal declines the card, the cashier retries and the approved attempt completes the sale', async ({ page }) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const cashMovementsBefore = await prisma.cashMovement.count({ where: { userId: user.id } });
  const { payment, cartTotal } = await startCardPayment(page);
  const stockBefore = await stockOf();

  // VP-12: the decline is shown with its reason and the attempt number, with "Reintentar cobro" in the footer
  await declineWith(payment, 'Fondos insuficientes');
  await expect(payment).toContainText('Intento 1');

  // retry: a new attempt, approved with the voucher's code, completes the sale by itself
  await payment.getByTestId('card-new').click();
  await expect(payment.getByTestId('card-waiting')).toBeVisible();
  await expect(payment).toContainText('Intento 2');
  await payment.getByTestId('card-approved').click();
  await payment.getByTestId('card-code').fill('a1b2c3');
  await payment.getByTestId('card-approve-confirm').click();

  const done = page.getByRole('dialog', { name: 'Venta completada' });
  await expect(done).toBeVisible();
  await expect(done.getByTestId('sale-total')).toHaveText(cartTotal);
  const number = (await done.getByTestId('sale-subtitle').textContent())?.match(/V-\d{6}/)?.[0] ?? '';

  // stock went down by the unit sold, the payment is the approved card with its code and the register got no cash
  expect(await stockOf()).toBe(stockBefore - 1);
  const stored = await prisma.sale.findFirstOrThrow({ where: { number }, include: { payments: true } });
  expect(stored.payments.map((p) => [p.method, p.providerStatus, p.reference])).toEqual([['CARD', 'CONFIRMED', 'A1B2C3']]);
  expect(await prisma.cashMovement.count({ where: { userId: user.id } })).toBe(cashMovementsBefore);
  // the declined attempt stays as history
  const attempts = await prisma.posCheckoutPayment.findMany({ where: { checkout: { sale: { number } }, method: 'CARD' }, orderBy: { createdAt: 'asc' } });
  expect(attempts.map((a) => [a.status, a.declineReason])).toEqual([
    ['DECLINED', 'INSUFFICIENT_FUNDS'],
    ['CONFIRMED', null],
  ]);

  await done.getByTestId('sale-new').click();
  await expect(done).toHaveCount(0);
});

test('after a decline the cashier goes back to the sale and the cart is still there', async ({ page }) => {
  const { payment } = await startCardPayment(page);
  const stockBefore = await stockOf();

  await declineWith(payment, 'Tarjeta rechazada');
  await payment.getByRole('button', { name: 'Cancelar' }).click();

  await expect(payment).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Venta actual' }).locator('rs-pos-cart-line')).toHaveCount(1);
  // nothing was sold
  expect(await stockOf()).toBe(stockBefore);
});
