import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-12 and HU-VEN-13 · the sales history: after a cash sale, "Ver venta" opens its detail (products, payment, pending
 * invoice), Reimprimir adds "Comprobante reimpreso" to the history, and the sale is the first row of Ventas realizadas,
 * where the number search finds it. Needs the demo data from `pnpm db:seed`; like the walking skeleton it closes the
 * administrator's open shifts and drops their open carts straight in the database before and after the run.
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

test('a sale made at the POS shows in Ventas realizadas, opens its detail and records a reprint in its history', async ({ page, context }) => {
  // the print dialog would wait for a person: the ticket page only needs to call it
  await context.addInitScript(() => {
    window.print = () => undefined;
  });
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

  // Ver venta opens the detail: the product, the cash payment and the invoice that waits for SIAT
  await done.getByTestId('sale-view').click();
  await expect(page).toHaveURL(/\/sales\/history\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: `Venta ${number}` })).toBeVisible();
  await expect(page.getByText(code).first()).toBeVisible();
  await expect(page.getByText('Efectivo')).toBeVisible();
  await expect(page.getByText('Pendiente de emisión SIAT').first()).toBeVisible();
  await expect(page.getByText('Venta completada')).toBeVisible();

  // Reimprimir opens the ticket marked as a reprint, and the history says so after a reload
  const [ticket] = await Promise.all([context.waitForEvent('page'), page.getByTestId('sale-reprint').click()]);
  await expect(ticket).toHaveURL(/\/print\?reprint=1$/);
  await expect(ticket.locator('rs-receipt')).toContainText('REIMPRESIÓN');
  await ticket.close();
  await page.reload();
  await expect(page.getByText('Comprobante reimpreso')).toBeVisible();

  // the list: the sale is the first row and the number search finds it
  await page.goto('/sales/history');
  await expect(page.locator('rs-doc-table tbody tr').first()).toContainText(number);
  await page.getByRole('searchbox', { name: 'Buscar ventas' }).fill(number);
  await expect(page).toHaveURL(/q=V-/);
  await expect(page.locator('rs-doc-table')).toContainText('1–1 de 1 venta');
  await expect(page.locator('rs-doc-table')).toContainText(number);
});
