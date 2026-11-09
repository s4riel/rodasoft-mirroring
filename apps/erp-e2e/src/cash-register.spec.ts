import { PrismaClient } from '@prisma/client';
import { expect, Page, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-22 and HU-VEN-23 · the cash register during and at the end of a shift. Needs the demo data from `pnpm db:seed` (a
 * register per branch, the 6205 bearings with stock and the administrator). The test starts from "no open shift": it closes the
 * administrator's open shifts and withdraws their pending cash expenses straight in the database before and after the run. The
 * sale and the closed shift stay (they are never deleted); the sale takes 2 units of one bearing from the register's warehouse.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';
const LIMIT_KEY = 'sales.cashExpenseApprovalLimit';

const prisma = new PrismaClient();
let adminId = '';
let code = '';

async function reset() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true, memberships: { select: { companyId: true }, take: 1 } } });
  if (!user) return;
  adminId = user.id;
  await prisma.posCheckout.deleteMany({ where: { cashierId: user.id, status: { in: ['OPEN', 'PAYING'] } } });
  await prisma.cashMovement.updateMany({ where: { userId: user.id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
  await prisma.approvalRequest.updateMany({ where: { requestedById: user.id, type: 'CASH_EXPENSE', status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
  await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
  const companyId = user.memberships[0]?.companyId;
  if (companyId) await prisma.companySetting.deleteMany({ where: { companyId, key: LIMIT_KEY } });
}

test.beforeAll(async () => {
  await reset();
  const register = await prisma.cashRegister.findFirstOrThrow({
    where: { status: 'ACTIVE', branch: { name: BRANCH } },
    orderBy: { name: 'asc' },
    select: { warehouseId: true },
  });
  const level = await prisma.stockLevel.findFirst({
    where: { warehouseId: register.warehouseId, quantity: { gte: 6 }, product: { status: 'ACTIVE', manufacturerCode: { startsWith: '6205' } } },
    select: { product: { select: { manufacturerCode: true } } },
    orderBy: { product: { manufacturerCode: 'asc' } },
  });
  if (!level) throw new Error('The seed has no 6205 bearing with at least 6 units in the register warehouse');
  code = level.product.manufacturerCode;
});

test.afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

/** Opens the register with Bs 500 from the opening form and lands on the POS. */
async function openRegister(page: Page) {
  await page.goto('/sales/cash-register/open');
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await page.locator('#cash-float').fill('500,00');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page).toHaveURL(/\/sales\/pos$/);
}

/** One cash sale of two bearings, as the walking skeleton does it, and a new empty cart. */
async function sellInCash(page: Page) {
  await page.keyboard.press('F2');
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  await search.fill(code);
  await expect(page.locator('rs-pos-result-row').first()).toContainText(code);
  await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items') && r.request().method() === 'POST'), search.press('Enter')]);
  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items/') && r.request().method() === 'PATCH'), sale.getByRole('button', { name: 'Sumar uno' }).click()]);
  await page.keyboard.press('F9');
  const payment = page.getByRole('dialog', { name: 'Cobrar venta' });
  await payment.locator('.quick rs-filter-chip button').nth(1).click();
  await page.keyboard.press('Enter');
  const done = page.getByRole('dialog', { name: 'Venta completada' });
  await expect(done).toBeVisible();
  await done.getByTestId('sale-new').click();
  await expect(done).toHaveCount(0);
}

/** Fills the movement dialog; the concept is picked by its Spanish label. */
async function fillMovement(page: Page, opts: { amount: string; concept: string; detail?: string; receipt?: boolean }) {
  const dialog = page.getByRole('dialog', { name: 'Registrar movimiento de efectivo' });
  await expect(dialog).toBeVisible();
  await dialog.locator('#cash-movement-amount').fill(opts.amount);
  await dialog.locator('#cash-movement-concept').click();
  await page.locator('li[role="option"]').filter({ hasText: opts.concept }).first().click();
  if (opts.detail) await dialog.locator('#cash-movement-detail').fill(opts.detail);
  if (opts.receipt) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHNCZPQAAAABJRU5ErkJggg==', 'base64');
    await dialog.locator('input[type="file"]').setInputFiles({ name: 'recibo.png', mimeType: 'image/png', buffer: png });
    await expect(dialog).toContainText('recibo.png');
  }
  return dialog;
}

const kpi = (page: Page, label: string) => page.locator('rs-kpi-card').filter({ hasText: label });

test('the cashier registers an income and an expense with a receipt, sees the shift, closes counting a difference and finds the POS closed', async ({ page }) => {
  await login(page);
  await openRegister(page);
  await sellInCash(page);

  // VP-22: the shift with its KPIs, the sales per method and the cash calculation
  await page.goto('/sales/cash-register');
  await expect(page.getByRole('heading', { name: /turno abierto/i, level: 1 })).toBeVisible();
  await expect(kpi(page, 'Ventas del turno')).toContainText('1 venta');
  await expect(page.getByRole('heading', { name: 'Por forma de pago' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cálculo del efectivo' })).toBeVisible();
  const expectedBefore = (await kpi(page, 'Efectivo esperado en caja').locator('.value, [class*="value"]').first().textContent())?.trim();
  expect(expectedBefore).toMatch(/^Bs /);

  // VP-22b: an income, then an expense with a receipt; empty fields are refused before anything is sent
  await page.getByTestId('cash-add-income').click();
  let dialog = page.getByRole('dialog', { name: 'Registrar movimiento de efectivo' });
  await dialog.getByTestId('cash-movement-submit').click();
  await expect(dialog).toContainText('Elige un concepto.');
  dialog = await fillMovement(page, { amount: '50,00', concept: 'Cobro de saldo' });
  await dialog.getByTestId('cash-movement-submit').click();
  await expect(page.getByText('Ingreso registrado')).toBeVisible();
  await expect(kpi(page, 'Ingresos')).toContainText('Bs 50,00');

  await page.getByTestId('cash-add-expense').click();
  dialog = await fillMovement(page, { amount: '30,00', concept: 'Pago de flete', detail: 'Flete a Oruro', receipt: true });
  await dialog.getByTestId('cash-movement-submit').click();
  await expect(page.getByText('Egreso registrado')).toBeVisible();
  await expect(kpi(page, 'Egresos')).toContainText('Bs 30,00');
  const movements = page.locator('rs-doc-table').first();
  await expect(movements).toContainText('Cobro de saldo');
  await expect(movements).toContainText('Pago de flete');
  await expect(movements).toContainText('− Bs 30,00');
  // the expected cash moved by +50 − 30
  await expect(kpi(page, 'Efectivo esperado en caja')).not.toContainText(expectedBefore ?? '');

  // the receipt is available from the row menu
  await movements.locator('tbody tr').filter({ hasText: 'Pago de flete' }).getByRole('button').click();
  await expect(page.getByRole('menuitem', { name: 'Ver comprobante' })).toBeVisible();
  await page.keyboard.press('Escape');

  // VP-06: count a single bill of 200 (always short), justify it and leave Bs 100 in the register
  await page.getByTestId('cash-close').click();
  await expect(page).toHaveURL(/\/sales\/cash-register\/close$/);
  await expect(page.getByRole('heading', { name: 'Cierre y arqueo de caja', level: 1 })).toBeVisible();
  const bills = page.getByRole('spinbutton', { name: 'Cantidad de Billete de Bs 200,00' });
  await bills.fill('1');
  await bills.press('Tab');
  await expect(page.getByTestId('cash-closing-warning')).toContainText('Diferencia de');
  await expect(page.getByTestId('cash-closing-submit')).toHaveText('Cerrar caja y enviar a revisión');

  await page.locator('#cash-closing-float').fill('100,00');
  await page.getByTestId('cash-closing-submit').click();
  await expect(page.getByText('Explica la diferencia antes de cerrar la caja.')).toBeVisible();
  await page.locator('#cash-closing-comment').fill('Faltó contar el efectivo de la ventanilla');
  await page.getByTestId('cash-closing-submit').click();

  await expect(page).toHaveURL(/\/sales\/cash-register\/open$/);
  await expect(page.getByText('Caja cerrada y enviada a revisión')).toBeVisible();

  // the shift is closed for review, with the request for Accounting
  const shift = await prisma.cashShift.findFirstOrThrow({ where: { openedById: adminId }, orderBy: { openedAt: 'desc' } });
  expect(shift.status).toBe('CLOSED');
  expect(shift.closingFloat?.toFixed(2)).toBe('100.00');
  expect(shift.closingComment).toBe('Faltó contar el efectivo de la ventanilla');
  expect(await prisma.approvalRequest.count({ where: { type: 'CASH_DIFFERENCE', subjectId: shift.id, status: 'PENDING' } })).toBe(1);

  // the POS is closed, and the opening form compares against what the last close left
  await page.goto('/sales/pos');
  await expect(page.getByRole('dialog', { name: 'Caja cerrada' })).toBeVisible();
  await page.goto('/sales/cash-register/open');
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await expect(page.locator('.last-close-value')).toContainText('Bs 100,00 dejados en caja');
});

test('an expense above the limit waits for approval, blocks the closing, and Management approves it from the review page', async ({ page }) => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true, memberships: { select: { companyId: true }, take: 1 } } });
  const companyId = user.memberships[0].companyId;
  await prisma.companySetting.upsert({
    where: { companyId_key: { companyId, key: LIMIT_KEY } },
    create: { companyId, key: LIMIT_KEY, value: '100.00' },
    update: { value: '100.00' },
  });

  await login(page);
  await openRegister(page);
  const shift = await prisma.cashShift.findFirstOrThrow({ where: { openedById: user.id, status: 'OPEN' } });
  // the administrator holds the approval permission, so an expense of their own would be posted at once: this one is what a
  // cashier without that permission would have requested
  const expense = await prisma.cashMovement.create({
    data: { companyId, shiftId: shift.id, type: 'EXPENSE', amount: '150.00', concept: 'SERVICES', reason: 'Reparación de la puerta', status: 'PENDING', userId: user.id },
  });
  await prisma.approvalRequest.create({
    data: { companyId, type: 'CASH_EXPENSE', subjectId: expense.id, requestedById: user.id, reason: 'SERVICES', requesterComment: 'Reparación de la puerta' },
  });

  // VP-22: the pending expense shows its pill, stays out of the expected cash and warns that it blocks the closing
  await page.goto('/sales/cash-register');
  await expect(page.locator('rs-doc-table').first()).toContainText('Por aprobar');
  await expect(kpi(page, 'Efectivo esperado en caja')).toContainText('Bs 500,00');
  await expect(page.getByTestId('cash-pending-note')).toContainText('No podrás cerrar la caja');
  await page.goto('/sales/cash-register/close');
  await expect(page.getByTestId('cash-closing-blocked')).toBeVisible();

  // the review page: Management approves it, and the cash drops by the expense
  await page.goto(`/sales/cash-register/movements/${expense.id}`);
  await expect(page.getByRole('heading', { name: 'Egreso de caja', level: 1 })).toBeVisible();
  await expect(page.getByTestId('expense-approval')).toBeVisible();
  await page.getByTestId('expense-reject').click();
  await expect(page.getByText('Escribe la respuesta para el cajero antes de rechazar.')).toBeVisible();
  await page.locator('#expense-reply').fill('Autorizado');
  await page.getByTestId('expense-approve').click();
  await expect(page.getByText('Egreso aprobado')).toBeVisible();
  await expect(page.getByTestId('expense-decision')).toContainText('Aprobado por');
  await expect(page.getByTestId('expense-approval')).toHaveCount(0);

  await page.goto('/sales/cash-register');
  await expect(kpi(page, 'Efectivo esperado en caja')).toContainText('Bs 350,00');
  await expect(kpi(page, 'Egresos')).toContainText('Bs 150,00');
  await expect(page.getByTestId('cash-pending-note')).toHaveCount(0);
});
