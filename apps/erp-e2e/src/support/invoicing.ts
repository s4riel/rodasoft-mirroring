import { PrismaClient } from '@prisma/client';
import { expect, type Page } from '@playwright/test';

/**
 * Shared by the invoicing E2E specs. A sale is made through the real POS (so the invoice is created by the app), and the test
 * then puts that invoice in the state it needs straight in the database: the SIAT is simulated and the worker may not run
 * during E2E, so the SIAT's answer is what the test decides, not what a queue happens to do.
 */

export const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
export const BRANCH = 'Huayna Kapac';

export async function resetAdminShifts(prisma: PrismaClient) {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) return;
  await prisma.posCheckout.deleteMany({ where: { cashierId: user.id, status: { in: ['OPEN', 'PAYING'] } } });
  await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
}

/** The code of a 6205 bearing with stock in the register warehouse of the demo branch. */
export async function sellableCode(prisma: PrismaClient): Promise<string> {
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
  return level.product.manufacturerCode;
}

/** Opens the register, sells one unit in cash and returns the number of the sale. */
export async function sellOne(page: Page, code: string): Promise<string> {
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
  await done.getByTestId('sale-new').click();
  return number;
}

/** Waits for the invoice the sale created (it is made in the same transaction as the sale). */
export async function invoiceOfSale(prisma: PrismaClient, saleNumber: string) {
  const sale = await prisma.sale.findFirstOrThrow({ where: { number: saleNumber }, select: { id: true } });
  return prisma.invoice.findUniqueOrThrow({ where: { saleId: sale.id } });
}
