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
  await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items') && r.request().method() === 'POST'), search.press('Enter')]);
  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  await expect(sale.locator('rs-pos-cart-line')).toHaveCount(1);
  // F9 is ignored while the cart is still being saved, so wait for the server to answer the quantity change
  await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items/') && r.request().method() === 'PATCH'), sale.getByRole('button', { name: 'Sumar uno' }).click()]);
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
  // the focus went back to "Imprimir ticket" when the ticket tab closed, and Enter on a button presses it: click the button
  await done.getByTestId('sale-new').click();
  await expect(done).toHaveCount(0);
  await expect(sale.getByText('Agrega productos para empezar la venta')).toBeVisible();
  expect(await stockOf()).toBe(stockBefore - 2);
});

/**
 * HU-VEN-08 · the same walking skeleton paid by QR: the QR is drawn with the amount, the screen waits, the cashier reports the
 * payment and the sale completes without touching the cash register. It opens the register itself when it is closed, so it
 * does not depend on the cash sale above (Playwright restarts the worker, and `beforeAll` closes the shift, after a failure).
 */
test('the cashier charges by QR, sees the code with the amount, confirms the payment and completes the sale', async ({ page }) => {
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

  const stockBefore = await stockOf();
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const cashMovementsBefore = await prisma.cashMovement.count({ where: { userId: user.id } });

  await page.keyboard.press('F2');
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  await search.fill(code);
  await expect(page.locator('rs-pos-result-row').first()).toContainText(code);
  // F9 is ignored while the cart is still being saved, so wait for the server to answer the add
  await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items') && r.request().method() === 'POST'), search.press('Enter')]);
  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  await expect(sale.locator('rs-pos-cart-line')).toHaveCount(1);

  const cartTotal = (await page.getByTestId('pos-total').textContent())?.trim();
  await page.keyboard.press('F9');
  const payment = page.getByRole('dialog', { name: 'Cobrar venta' });
  await expect(payment).toBeVisible();

  // QR: the code is drawn with the total and the screen waits for the customer
  await payment.locator('.methods rs-filter-chip').filter({ hasText: 'QR' }).locator('button').click();
  await expect(payment.locator('rs-qr-code')).toBeVisible();
  await expect(payment.getByTestId('qr-amount')).toHaveText(cartTotal ?? '');
  await expect(payment.getByTestId('qr-waiting')).toBeVisible();

  // changing the method drops the QR and shows the keypad; choosing QR again opens a new one
  await payment.getByTestId('qr-change').click();
  await expect(payment.locator('rs-numpad')).toBeVisible();
  await payment.locator('.methods rs-filter-chip').filter({ hasText: 'QR' }).locator('button').click();
  await expect(payment.getByTestId('qr-waiting')).toBeVisible();

  // the cashier reports the payment: the sale completes by itself
  await payment.getByTestId('qr-received').click();
  const done = page.getByRole('dialog', { name: 'Venta completada' });
  await expect(done).toBeVisible();
  await expect(done.getByTestId('sale-total')).toHaveText(cartTotal ?? '');
  const number = (await done.getByTestId('sale-subtitle').textContent())?.match(/V-\d{6}/)?.[0] ?? '';

  // stock went down by the unit sold, the payment is a confirmed QR and the register got no cash
  expect(await stockOf()).toBe(stockBefore - 1);
  const stored = await prisma.sale.findFirstOrThrow({ where: { number }, include: { payments: true } });
  expect(stored.payments.map((p) => [p.method, p.providerStatus])).toEqual([['QR', 'CONFIRMED']]);
  expect(await prisma.cashMovement.count({ where: { userId: user.id } })).toBe(cashMovementsBefore);

  await done.getByTestId('sale-new').click();
  await expect(done).toHaveCount(0);
});

/**
 * HU-VEN-09 · the same walking skeleton paid with both methods: Bs 1 by QR and the rest in cash. The screen shows how much is
 * still uncovered, the QR part is confirmed by the cashier, and one sale is saved with two payments; only the cash reaches the
 * register. Like the QR test, it opens the register itself when it is closed.
 */
test('the cashier splits the payment between QR and cash and completes one sale with both payments', async ({ page }) => {
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

  const stockBefore = await stockOf();
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const cashMovementsBefore = await prisma.cashMovement.count({ where: { userId: user.id } });

  await page.keyboard.press('F2');
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  await search.fill(code);
  await expect(page.locator('rs-pos-result-row').first()).toContainText(code);
  await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items') && r.request().method() === 'POST'), search.press('Enter')]);
  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  await expect(sale.locator('rs-pos-cart-line')).toHaveCount(1);

  const cartTotal = (await page.getByTestId('pos-total').textContent())?.trim();
  await page.keyboard.press('F9');
  const payment = page.getByRole('dialog', { name: 'Cobrar venta' });
  await expect(payment).toBeVisible();

  // Mixto: nothing is covered until the cashier types the QR part; the cash fills with the rest
  await payment.locator('.methods rs-filter-chip').filter({ hasText: 'Mixto' }).locator('button').click();
  await expect(payment.getByTestId('mix-remaining')).toHaveText(cartTotal ?? '');
  await payment.locator('#mix-qr-field').fill('1');
  await expect(payment.getByTestId('mix-remaining')).toHaveText('Bs 0,00');
  await expect(payment.locator('#mix-cash')).not.toHaveValue('');

  // "Confirmar cobro" opens the QR for the part only; the cashier reports it paid and the sale completes with both payments
  await payment.getByTestId('mix-confirm').click();
  await expect(payment.locator('rs-qr-code')).toBeVisible();
  await expect(payment.getByTestId('qr-amount')).toHaveText('Bs 1,00');
  await payment.getByTestId('qr-received').click();

  const done = page.getByRole('dialog', { name: 'Venta completada' });
  await expect(done).toBeVisible();
  await expect(done.getByTestId('sale-total')).toHaveText(cartTotal ?? '');
  const number = (await done.getByTestId('sale-subtitle').textContent())?.match(/V-\d{6}/)?.[0] ?? '';

  expect(await stockOf()).toBe(stockBefore - 1);
  const stored = await prisma.sale.findFirstOrThrow({ where: { number }, include: { payments: { orderBy: { method: 'asc' } } } });
  expect(stored.payments.map((p) => [p.method, p.providerStatus])).toEqual([
    ['CASH', null],
    ['QR', 'CONFIRMED'],
  ]);
  expect(stored.payments.find((p) => p.method === 'QR')?.amount.toFixed(2)).toBe('1.00');
  // only the cash line reaches the register
  expect(await prisma.cashMovement.count({ where: { userId: user.id } })).toBe(cashMovementsBefore + 1);

  await done.getByTestId('sale-new').click();
  await expect(done).toHaveCount(0);
});

/**
 * HU-VEN-35 · rounding shown "redondeado": with `sales.roundingMode` on `INTEGER`, a product priced with cents makes the totals
 * show a "Redondeo" row, the total is a whole number and the cash sale is charged exactly that total. The setting is put back
 * afterwards. It opens the register itself when it is closed, like the QR test.
 */
test('with the rounding on, the totals show the rounding and the sale is charged the rounded total', async ({ page }) => {
  const branch = await prisma.branch.findFirstOrThrow({ where: { name: BRANCH }, select: { companyId: true } });
  const key = { companyId_key: { companyId: branch.companyId, key: 'sales.roundingMode' } };
  const previous = await prisma.companySetting.findUnique({ where: key });

  // a product priced with cents, so the rounding has something to do
  const priced = await prisma.stockLevel.findMany({
    where: { warehouseId, product: { status: 'ACTIVE' } },
    select: { quantity: true, reserved: true, product: { select: { manufacturerCode: true, salePrice: true } } },
    orderBy: { product: { manufacturerCode: 'asc' } },
  });
  const withCents = priced.find((l) => l.quantity - l.reserved >= 1 && !l.product.salePrice.mod(1).isZero());
  test.skip(!withCents, 'The seed has no product priced with cents in the register warehouse');
  const roundedCode = withCents!.product.manufacturerCode;

  await prisma.companySetting.upsert({
    where: key,
    create: { companyId: branch.companyId, key: 'sales.roundingMode', value: 'INTEGER' },
    update: { value: 'INTEGER' },
  });
  try {
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
    await search.fill(roundedCode);
    await expect(page.locator('rs-pos-result-row').first()).toContainText(roundedCode);
    await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items') && r.request().method() === 'POST'), search.press('Enter')]);
    const sale = page.getByRole('complementary', { name: 'Venta actual' });
    await expect(sale.locator('rs-pos-cart-line')).toHaveCount(1);

    // the row says it is the rounding, and the total is a whole number of bolivianos
    await expect(sale.getByTestId('pos-adjustment-label')).toHaveText('Redondeo');
    const total = (await sale.getByTestId('pos-total').textContent())?.trim() ?? '';
    expect(total).toMatch(/^Bs [\d.]+,00$/);

    // the server charges exactly that total
    await page.keyboard.press('F9');
    const payment = page.getByRole('dialog', { name: 'Cobrar venta' });
    await expect(payment).toBeVisible();
    await expect(payment.getByTestId('pay-total')).toHaveText(total);
    await payment.locator('.quick rs-filter-chip').first().click();
    await page.keyboard.press('Enter');
    const done = page.getByRole('dialog', { name: 'Venta completada' });
    await expect(done).toBeVisible();
    await expect(done.getByTestId('sale-total')).toHaveText(total);
    await done.getByTestId('sale-new').click();
  } finally {
    if (previous) await prisma.companySetting.update({ where: key, data: { value: previous.value as never } });
    else await prisma.companySetting.deleteMany({ where: { companyId: branch.companyId, key: 'sales.roundingMode' } });
  }
});
