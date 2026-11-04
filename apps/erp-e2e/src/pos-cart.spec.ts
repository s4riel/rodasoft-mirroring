import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-02 · build the sale at the POS. Needs the demo data from `pnpm db:seed` (registers, the 6205 bearings with stock
 * and the administrator). A shift cannot be closed from the app yet (HU-VEN-23), so the test closes the administrator's
 * open shifts and drops their open cart straight in the database before and after the run.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';

const prisma = new PrismaClient();
let code = '';

async function reset() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) return;
  await prisma.posCheckout.deleteMany({ where: { cashierId: user.id, status: 'OPEN' } });
  await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
}

test.beforeAll(async () => {
  await reset();
  // a 6205 bearing with at least 2 available in the warehouse of the register the test opens
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
  const level = levels.find((l) => l.quantity - l.reserved >= 2);
  if (!level) throw new Error('The seed has no 6205 bearing with stock in the register warehouse');
  code = level.product.manufacturerCode;
});

test.afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

test('the cashier searches, adds with Enter, changes the quantity, keeps the cart after a reload and removes it', async ({ page }) => {
  await login(page);

  // open the register (HU-VEN-01)
  await page.goto('/sales/cash-register/open');
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await page.locator('#cash-float').fill('500,00');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page).toHaveURL(/\/sales\/pos$/);

  // full screen: no sidebar
  await expect(page.getByRole('navigation', { name: 'Módulos' })).toHaveCount(0);
  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  await expect(sale.getByText('Agrega productos para empezar la venta')).toBeVisible();

  // F2 focuses the search; Enter adds the first result
  await page.keyboard.press('F2');
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  await expect(search).toBeFocused();
  await search.fill(code);
  const first = page.locator('rs-pos-result-row').first();
  await expect(first).toContainText(code);
  await expect(first).toContainText(/\d+ en /);
  const price = (await first.locator('.price').textContent())?.trim() ?? '';
  await search.press('Enter');

  const line = sale.locator('rs-pos-cart-line');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(code);
  const total = sale.getByTestId('pos-total');
  await expect(total).toHaveText(price);

  // quantity 2: the total follows at once
  await line.getByRole('button', { name: 'Sumar uno' }).click();
  await expect(line.getByRole('spinbutton')).toHaveValue('2');
  await expect(total).not.toHaveText(price);
  const doubled = (await total.textContent())?.trim() ?? '';
  await expect(sale.getByRole('button', { name: /Cobrar/ })).toBeDisabled();

  // the cart survives a reload
  await page.reload();
  await expect(sale.locator('rs-pos-cart-line')).toHaveCount(1);
  await expect(sale.locator('rs-pos-cart-line').getByRole('spinbutton')).toHaveValue('2');
  await expect(total).toHaveText(doubled);

  // remove: back to the empty cart
  await sale.getByRole('button', { name: `Quitar ${code}` }).click();
  await expect(sale.getByText('Agrega productos para empezar la venta')).toBeVisible();
  await expect(total).toHaveText('Bs 0,00');
});
