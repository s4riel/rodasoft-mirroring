import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-34 · selling on credit: a customer with a NIT and the credit flag, a term in days, the due date on the payment screen and
 * on the sale detail, and nothing in the drawer. Needs the demo data from `pnpm db:seed` (registers, the 6205 bearings with
 * stock and the administrator). The customer is created straight in the database (the flag is Management's, set on the Clientes
 * screen), and a shift cannot be closed from the app yet (HU-VEN-23), so the test closes the administrator's open shifts and drops
 * their open or paying carts and its customer before and after the run. The sale stays (a sale is never deleted).
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';
const run = Date.now().toString().slice(-8);
/** Unique per run, valid as a NIT (5 to 13 digits). */
const CREDIT_NIT = `66${run}`;
const CUSTOMER_NAME = `Constructora E2E ${run}`;
/** SIN catalog: 5 is the NIT. */
const NIT = 5;

const prisma = new PrismaClient();
let code = '';

async function reset() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (user) {
    await prisma.posCheckout.deleteMany({ where: { cashierId: user.id, status: { in: ['OPEN', 'PAYING'] } } });
    await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
  }
  // a customer with sales stays (the sale keeps its row): only an unused one can go
  await prisma.customer.deleteMany({ where: { documentNumber: CREDIT_NIT, sales: { none: {} } } });
}

test.beforeAll(async () => {
  await reset();
  const branch = await prisma.branch.findFirstOrThrow({ where: { name: BRANCH }, select: { companyId: true } });
  await prisma.customer.create({
    data: { companyId: branch.companyId, name: CUSTOMER_NAME, documentType: NIT, documentNumber: CREDIT_NIT, creditEnabled: true },
  });
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

/** Today in La Paz plus `days`, as `YYYY-MM-DD`. */
function dueDay(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** `dd/mm/aaaa`: the completed sale and the sale detail. */
function dueIn(days: number): string {
  const [year, month, day] = dueDay(days).split('-');
  return `${day}/${month}/${year}`;
}

/** `21 nov 2026`: the credit panel (Figma VP-04d). */
function dueShort(days: number): string {
  const [year, month, day] = dueDay(days).split('-');
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${Number(day)} ${months[Number(month) - 1]} ${year}`;
}

test('the cashier charges a customer with credit to 30 days, sees the due date, and the sale detail shows it', async ({ page }) => {
  await login(page);

  // open the register (HU-VEN-01)
  await page.goto('/sales/cash-register/open');
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await page.locator('#cash-float').fill('500,00');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page).toHaveURL(/\/sales\/pos$/);

  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  await page.keyboard.press('F2');
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  await search.fill(code);
  await expect(page.locator('rs-pos-result-row').first()).toContainText(code);
  await Promise.all([page.waitForResponse((r) => r.url().includes('/checkout/items') && r.request().method() === 'POST'), search.press('Enter')]);
  await expect(sale.locator('rs-pos-cart-line')).toHaveCount(1);
  const cartTotal = (await page.getByTestId('pos-total').textContent())?.trim() ?? '';

  // a final consumer cannot buy on credit: the chip is off and says what to do
  await page.keyboard.press('F9');
  const payment = page.getByRole('dialog', { name: 'Cobrar venta' });
  await expect(payment).toBeVisible();
  const creditChip = payment.locator('rs-filter-chip[label="Crédito"]');
  await expect(creditChip.getByRole('button')).toBeDisabled();
  await expect(creditChip).toHaveAttribute('title', 'Elige un cliente con NIT y crédito habilitado');
  await payment.getByRole('button', { name: 'Cancelar' }).click();
  await expect(payment).toHaveCount(0);

  // the customer with credit (F4, HU-VEN-05)
  await page.keyboard.press('F4');
  const customers = page.getByRole('dialog', { name: 'Cliente y datos de factura' });
  await customers.getByRole('searchbox').fill(CREDIT_NIT);
  await customers.getByRole('button', { pressed: false }).filter({ hasText: CUSTOMER_NAME }).click();
  await customers.getByRole('button', { name: `Usar ${CUSTOMER_NAME}` }).click();
  await expect(customers).toHaveCount(0);
  await expect(sale.locator('rs-pos-customer')).toContainText(CUSTOMER_NAME);

  // the chip is on; the panel asks for the term and writes the due date
  await page.keyboard.press('F9');
  await expect(payment).toBeVisible();
  await expect(creditChip.getByRole('button')).toBeEnabled();
  await creditChip.getByRole('button').click();
  const confirm = payment.getByTestId('credit-confirm');
  await expect(confirm).toBeDisabled();
  await expect(payment).toContainText('Sin límite');
  await payment.getByRole('button', { name: '30 días' }).click();
  await expect(payment.getByTestId('credit-due')).toHaveText(dueShort(30));
  await expect(payment.getByTestId('credit-balance')).toHaveText(cartTotal);
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // VP-16a: the balance and its due date instead of received and change
  const done = page.getByRole('dialog', { name: 'Venta completada' });
  await expect(done).toBeVisible();
  await expect(done.getByTestId('sale-credit')).toHaveText(cartTotal);
  await expect(done.getByTestId('sale-due')).toHaveText(dueIn(30));
  await expect(done.getByTestId('sale-received')).toHaveCount(0);

  // VP-02: the sale detail says when the credit falls due
  await done.getByRole('button', { name: 'Ver venta' }).click();
  await expect(page).toHaveURL(/\/sales\/history\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Pago' })).toBeVisible();
  await expect(page.locator('main')).toContainText(`Crédito · vence ${dueIn(30)}`);
});
