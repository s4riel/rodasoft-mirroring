import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-07 and HU-VEN-11 · the walking skeleton: open the register, add a product, charge in cash, complete the sale, print
 * the ticket and start a new sale. Needs the demo data from `pnpm db:seed` (registers, the 6205 bearings with stock and the
 * administrator). A shift cannot be closed from the app yet (HU-VEN-23), so the test closes the administrator's open shifts
 * and drops their open or paying carts straight in the database before and after the run. The sale itself stays (a sale is
 * never deleted) and takes 2 units of one bearing from the register's warehouse: the seed has plenty.
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

test('the cashier charges in cash, sees the change, completes the sale, prints the ticket and starts a new sale', async ({ page, context }) => {
  // the print dialog would wait for a person: the ticket page only needs to call it
  await context.addInitScript(() => {
    window.print = () => undefined;
  });
  await login(page);

  // open the register (HU-VEN-01)
  await page.goto('/sales/cash-register/open');
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await page.locator('#cash-float').fill('500,00');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page).toHaveURL(/\/sales\/pos$/);

  const stockBefore = await stockOf();

  // search, Enter adds one, the stepper makes it two (HU-VEN-02)
  await page.keyboard.press('F2');
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  await search.fill(code);
  await expect(page.locator('rs-pos-result-row').first()).toContainText(code);
  await search.press('Enter');
  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  await expect(sale.locator('rs-pos-cart-line')).toHaveCount(1);
  await sale.getByRole('button', { name: 'Sumar uno' }).click();
  await expect(sale.locator('rs-pos-cart-line input')).toHaveValue('2');

  // F9 opens the payment with the total the cart shows
  const cartTotal = (await page.getByTestId('pos-total').textContent())?.trim();
  await page.keyboard.press('F9');
  const payment = page.getByRole('dialog', { name: 'Cobrar venta' });
  await expect(payment).toBeVisible();
  await expect(payment.getByTestId('pay-total')).toHaveText(cartTotal ?? '');

  // less than the total cannot be confirmed
  const confirm = payment.getByTestId('pay-confirm');
  await expect(confirm).toBeDisabled();
  await payment.getByRole('button', { name: '1', exact: true }).click();
  await expect(confirm).toBeDisabled();

  // a quick amount above the total gives change
  await payment.getByRole('button', { name: 'Borrar' }).click();
  await payment.locator('.quick rs-filter-chip button').nth(1).click();
  await expect(payment.getByTestId('pay-received')).not.toHaveText('Bs 0,00');
  await expect(payment.getByTestId('pay-change')).not.toHaveText('Bs 0,00');
  await expect(confirm).toBeEnabled();
  await page.keyboard.press('Enter');

  // VP-16a: the sale is saved with its number, and the invoice waits for the SIAT epic
  const done = page.getByRole('dialog', { name: 'Venta completada' });
  await expect(done).toBeVisible();
  await expect(done.getByTestId('sale-subtitle')).toContainText(/V-\d{6}/);
  await expect(done.getByTestId('sale-total')).toHaveText(cartTotal ?? '');
  await expect(done).toContainText('Factura pendiente de emisión');
  const number = (await done.getByTestId('sale-subtitle').textContent())?.match(/V-\d{6}/)?.[0] ?? '';

  // the ticket opens in its own tab, outside the shell
  const [ticket] = await Promise.all([context.waitForEvent('page'), done.getByRole('button', { name: 'Imprimir ticket' }).click()]);
  await expect(ticket).toHaveURL(/\/sales\/receipts\/[0-9a-f-]+\/print$/);
  await expect(ticket.locator('rs-receipt')).toContainText(number);
  await expect(ticket.locator('rs-receipt')).toContainText(code);
  await ticket.close();

  // a new sale: the cart is empty and the stock went down by the two units sold
  await page.keyboard.press('Enter');
  await expect(done).toHaveCount(0);
  await expect(sale.getByText('Agrega productos para empezar la venta')).toBeVisible();
  expect(await stockOf()).toBe(stockBefore - 2);
});
