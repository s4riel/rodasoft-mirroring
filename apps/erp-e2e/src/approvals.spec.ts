import { PrismaClient } from '@prisma/client';
import { expect, test, type Page } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-29 · The approvals inbox: Management finds a pending cancellation, return and cash expense in one place, grouped by
 * type, rejects the expense (the reply is required), approves the return, opens the cancellation on its own review page and
 * decides it there; the inbox ends empty. Needs the demo data from `pnpm db:seed`. The requests are made the way a cashier makes
 * them: the sale and its return and cancellation through the screens, and the cash expense straight in the database, because the
 * administrator holds the approval permission and an expense of their own would be posted at once. Like the other sales flows it
 * closes the administrator's open shifts and drops their open carts and pending requests in the database before and after.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';
const RETURN_LIMIT_KEY = 'sales.returnApprovalLimit';

const prisma = new PrismaClient();
let code = '';
let productId = '';
let warehouseId = '';
let companyId = '';
let adminId = '';

async function reset() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true, memberships: { select: { companyId: true }, take: 1 } } });
  if (!user) return;
  adminId = user.id;
  companyId = user.memberships[0]?.companyId ?? companyId;
  await prisma.posCheckout.deleteMany({ where: { cashierId: user.id, status: { in: ['OPEN', 'PAYING'] } } });
  // nothing the administrator asked for stays pending: the inbox of the next run starts clean
  await prisma.cashMovement.updateMany({ where: { userId: user.id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
  await prisma.approvalRequest.updateMany({ where: { requestedById: user.id, status: 'PENDING' }, data: { status: 'WITHDRAWN' } });
  await prisma.saleReturn.updateMany({ where: { createdById: user.id, status: 'PENDING_APPROVAL' }, data: { status: 'REJECTED' } });
  await prisma.sale.updateMany({ where: { createdById: user.id, status: 'CANCELLATION_PENDING' }, data: { status: 'COMPLETED' } });
  await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
  if (companyId) await prisma.companySetting.deleteMany({ where: { companyId, key: RETURN_LIMIT_KEY } });
}

/** A KPI card reads `Pendientes4`: the number after its label. */
const kpi = async (page: Page, id: string, label: string) => Number((await page.getByTestId(id).innerText()).replace(label, '').trim());

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
  const level = levels.find((l) => l.quantity - l.reserved >= 6);
  if (!level) throw new Error('The seed has no 6205 bearing with at least 6 units in the register warehouse');
  code = level.product.manufacturerCode;
  productId = level.product.id;
});

test.afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

/** Sells one unit in cash and returns the number of the sale, standing on its detail. The register must be open. */
async function sellOne(page: Page): Promise<string> {
  await page.goto('/sales/pos');
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

test('Management decides a return and an expense from the inbox and a cancellation from its own page: the inbox ends empty', async ({ page }) => {
  await prisma.companySetting.upsert({
    where: { companyId_key: { companyId, key: RETURN_LIMIT_KEY } },
    create: { companyId, key: RETURN_LIMIT_KEY, value: '0.01' },
    update: { value: '0.01' },
  });
  await login(page);

  // the register, and a first sale whose return waits for approval (the limit is Bs 0,01)
  await page.goto('/sales/cash-register/open');
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await page.locator('#cash-float').fill('500,00');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page).toHaveURL(/\/sales\/pos$/);
  const before = await onHand();

  await sellOne(page);
  await page.getByTestId('sale-return').click();
  await page.getByLabel('Motivo de la devolución').click();
  await page.locator('li[role="option"]').filter({ hasText: 'Producto con falla de fábrica' }).first().click();
  await page.locator('rs-qty-stepper button').last().click();
  await page.getByRole('group', { name: /Destino de/ }).getByRole('button', { name: 'A stock' }).click();
  await page.getByTestId('return-submit').click();
  await expect(page.getByRole('heading', { name: /^Devolución DEV-\d{6}$/ })).toBeVisible();
  await expect(page.locator('rs-status-pill', { hasText: 'Por aprobar' }).first()).toBeVisible();

  // a second sale, whose cancellation is asked for
  const cancelled = await sellOne(page);
  await page.getByTestId('sale-cancel-request').click();
  const ask = page.getByRole('dialog', { name: `Solicitar anulación de la venta ${cancelled}` });
  await ask.getByRole('button', { name: 'Error en datos del cliente' }).click();
  await ask.getByLabel('Comentario *').fill('El cliente pidió la factura a nombre de otra empresa');
  await ask.getByTestId('cancellation-send').click();
  await expect(page.getByTestId('sale-cancel-pending')).toBeVisible();

  // a cash expense above the limit, as a cashier without the approval permission would have requested it
  const shift = await prisma.cashShift.findFirstOrThrow({ where: { openedById: adminId, status: 'OPEN' } });
  const expense = await prisma.cashMovement.create({
    data: { companyId, shiftId: shift.id, type: 'EXPENSE', amount: '150.00', concept: 'SERVICES', reason: 'Reparación de la puerta', status: 'PENDING', userId: adminId },
  });
  const expenseRequest = await prisma.approvalRequest.create({
    data: { companyId, type: 'CASH_EXPENSE', subjectId: expense.id, requestedById: adminId, reason: 'SERVICES', requesterComment: 'Reparación de la puerta' },
  });
  const returnRequest = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'RETURN', requestedById: adminId, status: 'PENDING' } });

  // VP-25: the three groups, the KPIs and the badge of the tab
  await page.goto('/sales/approvals');
  await expect(page.getByRole('heading', { name: 'Aprobaciones', level: 1 })).toBeVisible();
  // the demo database may hold other days' decisions and other users' requests: the KPIs are read as differences
  await expect(page.getByTestId('approvals-group-CANCELLATION')).toContainText(cancelled);
  const start = {
    pending: await kpi(page, 'approvals-pending', 'Pendientes'),
    approved: await kpi(page, 'approvals-approved', 'Aprobadas hoy'),
    rejected: await kpi(page, 'approvals-rejected', 'Rechazadas hoy'),
  };
  expect(start.pending).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('approvals-group-CANCELLATION')).toContainText(cancelled);
  await expect(page.getByTestId('approvals-group-RETURN')).toContainText('Producto con falla de fábrica');
  await expect(page.getByTestId('approvals-group-CASH_EXPENSE')).toContainText('Reparación de la puerta');
  await expect(page.getByTestId('approvals-group-CASH_EXPENSE')).toContainText('−Bs 150,00');
  const nav = page.getByRole('navigation', { name: 'Secciones de ventas' });
  await expect(nav.getByRole('link', { name: /Aprobaciones/ })).toContainText(String(start.pending));
  // the chips filter without asking again
  await page.getByTestId('approvals-chip-RETURN').getByRole('button').click();
  await expect(page.getByTestId('approvals-group-CASH_EXPENSE')).toHaveCount(0);
  await page.getByTestId('approvals-chip-all').getByRole('button').click();
  await expect(page.getByTestId('approvals-group-CASH_EXPENSE')).toBeVisible();

  // rejecting the expense needs the reply; with it, the row leaves the inbox and the expense is rejected
  await page.getByTestId(`approval-reject-${expenseRequest.id}`).click();
  const decision = page.getByRole('dialog', { name: 'Rechazar gasto de caja' });
  await decision.getByTestId('decision-confirm').click();
  await expect(decision).toContainText('Escribe el motivo');
  await decision.getByTestId('decision-comment').fill('Falta el comprobante');
  await decision.getByTestId('decision-confirm').click();
  await expect(page.getByText('Solicitud rechazada')).toBeVisible();
  await expect(page.getByTestId(`approval-${expenseRequest.id}`)).toHaveCount(0);
  await expect.poll(() => kpi(page, 'approvals-pending', 'Pendientes')).toBe(start.pending - 1);
  await expect.poll(() => kpi(page, 'approvals-rejected', 'Rechazadas hoy')).toBe(start.rejected + 1);
  const rejected = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: expenseRequest.id } });
  expect(rejected).toMatchObject({ status: 'REJECTED', comment: 'Falta el comprobante', decidedById: adminId });
  expect((await prisma.cashMovement.findUniqueOrThrow({ where: { id: expense.id } })).status).toBe('REJECTED');

  // approving the return puts the piece back in the warehouse
  expect(await onHand()).toBe(before - 2);
  await page.getByTestId(`approval-approve-${returnRequest.id}`).click();
  await page.getByRole('dialog', { name: 'Aprobar devolución' }).getByTestId('decision-confirm').click();
  await expect(page.getByTestId(`approval-${returnRequest.id}`)).toHaveCount(0);
  await expect.poll(() => kpi(page, 'approvals-pending', 'Pendientes')).toBe(start.pending - 2);
  await expect.poll(() => kpi(page, 'approvals-approved', 'Aprobadas hoy')).toBe(start.approved + 1);
  expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: returnRequest.id } })).status).toBe('APPROVED');
  expect(await onHand()).toBe(before - 1);

  // the cancellation has no buttons here: "Ver detalle" opens its review page, where it is decided
  const cancellation = await prisma.approvalRequest.findFirstOrThrow({ where: { type: 'CANCELLATION', requestedById: adminId, status: 'PENDING' } });
  await expect(page.getByTestId(`approval-approve-${cancellation.id}`)).toHaveCount(0);
  await page.getByTestId(`approval-detail-${cancellation.id}`).click();
  await expect(page.getByRole('heading', { name: `Aprobar anulación · Venta ${cancelled}` })).toBeVisible();
  await page.getByTestId('review-approve').click();
  await page.getByTestId('review-approve-confirm').click();
  await expect(page.getByRole('heading', { name: `Venta ${cancelled}`, exact: true })).toBeVisible();

  // the three requests are gone and today's decisions are counted; with nobody else's request waiting, the inbox is empty
  await page.goto('/sales/approvals');
  await expect.poll(() => kpi(page, 'approvals-pending', 'Pendientes')).toBe(start.pending - 3);
  await expect.poll(() => kpi(page, 'approvals-approved', 'Aprobadas hoy')).toBe(start.approved + 2);
  await expect.poll(() => kpi(page, 'approvals-rejected', 'Rechazadas hoy')).toBe(start.rejected + 1);
  if (start.pending === 3) {
    await expect(page.getByTestId('approvals-empty')).toContainText('No hay solicitudes pendientes');
    await expect(page.getByRole('navigation', { name: 'Secciones de ventas' }).getByRole('link', { name: /Aprobaciones/ })).not.toContainText(/\d/);
  }
});
