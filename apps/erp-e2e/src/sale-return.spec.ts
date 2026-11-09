import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-21 · Returns: sell a product in cash, register its return from the sale detail, and see the credit and debit note,
 * the refund and the stock. A piece sent "A stock" goes back to the warehouse; one sent "A merma" does not. With
 * `sales.returnApprovalLimit` set, the return waits for approval and the administrator (who holds both permissions) approves
 * it on its detail. Needs the demo data from `pnpm db:seed`; like the other sales flows it closes the administrator's open
 * shifts and drops their open carts in the database before and after.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';
const LIMIT_KEY = 'sales.returnApprovalLimit';

const prisma = new PrismaClient();
let code = '';
let productId = '';
let warehouseId = '';
let companyId = '';

async function reset() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) return;
  await prisma.posCheckout.deleteMany({ where: { cashierId: user.id, status: { in: ['OPEN', 'PAYING'] } } });
  await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
  if (companyId) await prisma.companySetting.deleteMany({ where: { companyId, key: LIMIT_KEY } });
}

const onHand = async () => (await prisma.stockLevel.findFirstOrThrow({ where: { productId, warehouseId }, select: { quantity: true } })).quantity;

test.beforeAll(async () => {
  const register = await prisma.cashRegister.findFirstOrThrow({
    where: { status: 'ACTIVE', branch: { name: BRANCH } },
    orderBy: { name: 'asc' },
    select: { warehouseId: true, companyId: true },
  });
  warehouseId = register.warehouseId;
  companyId = register.companyId;
  await reset();
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

test.beforeEach(reset);

test.afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

/** Opens the register (when it is not open) and sells one unit in cash; returns the number of the sale, standing on its detail. */
async function sellOne(page: Page, openRegister: boolean): Promise<string> {
  if (openRegister) {
    await page.goto('/sales/cash-register/open');
    await page.locator('#cash-register').click();
    await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
    await page.locator('#cash-float').fill('500,00');
    await page.getByRole('button', { name: 'Abrir caja' }).click();
  } else {
    await page.goto('/sales/pos');
  }
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

/** From the sale detail: opens the form with the sale, picks the reason and the destination of the piece, and sends it. */
async function registerReturn(page: Page, destination: 'A stock' | 'A merma') {
  await page.getByTestId('sale-return').click();
  await expect(page.getByRole('heading', { name: 'Nueva devolución' })).toBeVisible();
  await expect(page.getByTestId('return-sale-caption')).toBeVisible();

  await page.getByLabel('Motivo de la devolución').click();
  await page.locator('li[role="option"]').filter({ hasText: 'Producto con falla de fábrica' }).first().click();
  await page.locator('rs-qty-stepper button').last().click();
  await page.getByRole('group', { name: /Destino de/ }).getByRole('button', { name: destination }).click();
  await expect(page.getByTestId('return-note-info')).toContainText('Se emite una nota de crédito y débito');
  await page.getByTestId('return-submit').click();
}

test('registers a return to stock in cash: the note is pending, the refund is cash and the piece is back', async ({ page }) => {
  await login(page);
  const before = await onHand();
  const sale = await sellOne(page, true);
  expect(await onHand()).toBe(before - 1);

  await registerReturn(page, 'A stock');
  await expect(page.getByRole('heading', { name: /^Devolución DEV-\d{6}$/ })).toBeVisible();
  const number = (await page.getByRole('heading', { name: /^Devolución DEV-\d{6}$/ }).textContent())?.match(/DEV-\d{6}/)?.[0] ?? '';
  await expect(page.getByTestId('return-subtitle')).toContainText(sale);
  await expect(page.getByText('Nota de crédito y débito · Pendiente')).toBeVisible();
  await expect(page.locator('rs-kpi-card', { hasText: 'Reembolso' })).toContainText('Efectivo de caja');
  await expect(page.getByTestId('return-item').first()).toContainText('A stock');
  expect(await onHand()).toBe(before);

  // the list shows it and the sale detail links back to it
  await page.getByTestId('return-back').click();
  await expect(page.locator('rs-doc-table tbody tr').first()).toContainText(number);
  await page.goto('/sales/history');
  await page.locator('rs-doc-table tbody tr').first().getByRole('link').first().click();
  await expect(page.getByTestId('sale-returns')).toContainText(number);
  // nothing is left to return and the sale can no longer be cancelled
  await expect(page.getByTestId('sale-return')).toHaveCount(0);
  await expect(page.getByTestId('sale-cancel-request')).toHaveCount(0);
});

test('a piece sent to scrap does not come back to stock', async ({ page }) => {
  await login(page);
  const before = await onHand();
  await sellOne(page, true);
  expect(await onHand()).toBe(before - 1);

  await registerReturn(page, 'A merma');
  await expect(page.getByRole('heading', { name: /^Devolución DEV-\d{6}$/ })).toBeVisible();
  await expect(page.getByTestId('return-item').first()).toContainText('A merma');
  expect(await onHand()).toBe(before - 1);
});

test('above the approval limit the return waits for Management, who approves it on the detail', async ({ page }) => {
  await prisma.companySetting.upsert({
    where: { companyId_key: { companyId, key: LIMIT_KEY } },
    create: { companyId, key: LIMIT_KEY, value: '0.01' },
    update: { value: '0.01' },
  });
  await login(page);
  const before = await onHand();
  await sellOne(page, true);

  await registerReturn(page, 'A stock');
  await expect(page.getByRole('heading', { name: /^Devolución DEV-\d{6}$/ })).toBeVisible();
  await expect(page.locator('rs-status-pill', { hasText: 'Por aprobar' }).first()).toBeVisible();
  await expect(page.getByText('Nota de crédito y débito · Se emite al aprobar')).toBeVisible();
  expect(await onHand()).toBe(before - 1);

  await page.getByTestId('return-approve').click();
  await expect(page.getByTestId('return-decision')).toContainText('Aprobada por');
  await expect(page.getByText('Nota de crédito y débito · Pendiente')).toBeVisible();
  expect(await onHand()).toBe(before);
});
