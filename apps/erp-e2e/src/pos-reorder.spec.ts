import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-33 · reorder the cart lines by dragging: every line has a handle, the notice is in the shortcuts, dragging the third line
 * to the top keeps the order after a reload and the receipt lists it first. Needs the demo data from `pnpm db:seed` (registers,
 * products with stock and the administrator). A shift cannot be closed from the app yet (HU-VEN-23), so the test closes the
 * administrator's open shifts and drops their open or paying carts before and after the run. The sale stays (a sale is never
 * deleted) and takes 1 unit of three products from the register's warehouse: the seed has plenty.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';

const prisma = new PrismaClient();
let codes: string[] = [];

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
  // three products whose code is not contained in another's, so each search finds its own first
  const levels = await prisma.stockLevel.findMany({
    where: { warehouseId: register.warehouseId, product: { status: 'ACTIVE', manufacturerCode: { startsWith: '62' } } },
    select: { quantity: true, reserved: true, product: { select: { manufacturerCode: true } } },
    orderBy: { product: { manufacturerCode: 'asc' } },
  });
  const available = levels.filter((l) => l.quantity - l.reserved >= 3).map((l) => l.product.manufacturerCode);
  const chosen: string[] = [];
  for (const candidate of available) {
    if (chosen.every((c) => !c.includes(candidate) && !candidate.includes(c))) chosen.push(candidate);
    if (chosen.length === 3) break;
  }
  if (chosen.length < 3) throw new Error('The seed has no three different 62xx products with stock in the register warehouse');
  codes = chosen;
});

test.afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

test('the cashier drags the third line to the top, the order survives a reload and the receipt lists it first', async ({ page, context }) => {
  await context.addInitScript(() => {
    window.print = () => undefined;
  });
  await login(page);

  await page.goto('/sales/cash-register/open');
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await page.locator('#cash-float').fill('500,00');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page).toHaveURL(/\/sales\/pos$/);

  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  for (const [index, code] of codes.entries()) {
    await page.keyboard.press('F2');
    await search.fill(code);
    await expect(page.locator('rs-pos-result-row').first()).toContainText(code);
    await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items') && r.request().method() === 'POST'), search.press('Enter')]);
    await expect(sale.locator('rs-pos-cart-line')).toHaveCount(index + 1);
  }

  const titles = () => sale.locator('rs-pos-cart-line .title').allTextContents();
  const order = async () => (await titles()).map((t) => t.split(' · ')[0].trim());
  expect(await order()).toEqual(codes);

  // every line has its handle, and the shortcuts say how to reorder
  for (const code of codes) await expect(sale.getByRole('button', { name: `Arrastrar ${code}` })).toBeVisible();
  await expect(page.getByTestId('pos-shortcuts')).toContainText('Arrastrar para reordenar');

  // drag the grip of the third line above the first one
  const grip = (await sale.getByRole('button', { name: `Arrastrar ${codes[2]}` }).boundingBox())!;
  const first = (await sale.locator('rs-pos-cart-line').first().boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, first.y + 4, { steps: 20 });
  await Promise.all([page.waitForResponse((r) => r.url().endsWith('/checkout/items/order') && r.request().method() === 'PUT'), page.mouse.up()]);
  await expect.poll(order).toEqual([codes[2], codes[0], codes[1]]);

  // the server kept it
  await page.reload();
  await expect(sale.locator('rs-pos-cart-line')).toHaveCount(3);
  expect(await order()).toEqual([codes[2], codes[0], codes[1]]);

  // charge: the receipt lists the dragged line first
  await page.keyboard.press('F9');
  const payment = page.getByRole('dialog', { name: 'Cobrar venta' });
  await expect(payment).toBeVisible();
  await payment.locator('.quick rs-filter-chip button').nth(1).click();
  await page.keyboard.press('Enter');
  const done = page.getByRole('dialog', { name: 'Venta completada' });
  await expect(done).toBeVisible();
  const [ticket] = await Promise.all([context.waitForEvent('page'), done.getByRole('button', { name: 'Imprimir ticket' }).click()]);
  await expect(ticket.locator('rs-receipt')).toContainText(codes[2]);
  const lines = await ticket.locator('rs-receipt .item .description').allTextContents();
  expect(lines.map((l) => l.split(' · ')[0].trim())).toEqual([codes[2], codes[0], codes[1]]);
  await ticket.close();
});
