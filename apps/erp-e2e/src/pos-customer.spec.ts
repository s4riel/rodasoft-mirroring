import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-05 + HU-VEN-37 · customer and invoice data at the POS. Needs the demo data from `pnpm db:seed` (registers, the 6205
 * bearings with stock and the administrator, who holds every permission). Management creates a customer with a 10 % discount
 * on the Clientes screen; the cashier then invoices a final consumer, picks that customer (the discount appears) and creates
 * another one on the spot. A shift cannot be closed from the app yet (HU-VEN-23), so the test closes the administrator's open
 * shifts and drops their open cart and the customers it created straight in the database before and after the run.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';
const run = Date.now().toString().slice(-8);
/** Unique per run, valid as a NIT (5 to 13 digits). */
const MANAGED_NIT = `77${run}`;
const QUICK_NIT = `88${run}`;

const prisma = new PrismaClient();
let code = '';

async function reset() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (user) {
    await prisma.posCheckout.deleteMany({ where: { cashierId: user.id, status: 'OPEN' } });
    await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
  }
  await prisma.customer.deleteMany({ where: { documentNumber: { in: [MANAGED_NIT, QUICK_NIT] } } });
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
  const level = levels.find((l) => l.quantity - l.reserved >= 2);
  if (!level) throw new Error('The seed has no 6205 bearing with stock in the register warehouse');
  code = level.product.manufacturerCode;
});

test.afterAll(async () => {
  await reset();
  await prisma.$disconnect();
});

test('Management sets a discount on a customer and the cashier invoices to them, to a final consumer and to a new customer', async ({ page }) => {
  await login(page);

  // Management: a customer with the credit flag and a 10 % discount
  await page.goto('/sales/customers');
  await page.getByRole('button', { name: 'Nuevo cliente' }).first().click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Número de documento').fill(MANAGED_NIT);
  await form.getByLabel('Nombre o razón social').fill(`Minera E2E ${run}`);
  await form.getByLabel('Descuento').click();
  await page.locator('li[role="option"]').filter({ hasText: 'Porcentaje' }).click();
  await form.getByLabel('Porcentaje').fill('10');
  await form.getByRole('button', { name: 'Crear cliente' }).click();
  await expect(page.getByText(`Cliente creado: Minera E2E ${run}.`)).toBeVisible();
  await expect(page.getByRole('table', { name: 'Clientes' })).toContainText('10 % de descuento');

  // open the register (HU-VEN-01) and add a product (HU-VEN-02)
  await page.goto('/sales/cash-register/open');
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await page.locator('#cash-float').fill('500,00');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page).toHaveURL(/\/sales\/pos$/);

  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  const customer = sale.locator('rs-pos-customer');
  await expect(customer).toContainText('Consumidor final');
  await expect(customer).toContainText('Sin NIT · factura a S/N');

  await page.keyboard.press('F2');
  const search = page.getByRole('searchbox', { name: 'Buscar producto' });
  await search.fill(code);
  await expect(page.locator('rs-pos-result-row').first()).toContainText(code);
  await search.press('Enter');
  await expect(sale.locator('rs-pos-cart-line')).toHaveCount(1);
  const total = sale.getByTestId('pos-total');
  const withoutDiscount = (await total.textContent())?.trim() ?? '';

  // F4 opens the customer search; picking the customer applies their discount at once
  await page.keyboard.press('F4');
  const dialog = page.getByRole('dialog', { name: 'Cliente y datos de factura' });
  await dialog.getByRole('searchbox').fill(MANAGED_NIT);
  await dialog.getByRole('button', { pressed: false }).filter({ hasText: `Minera E2E ${run}` }).click();
  await dialog.getByRole('button', { name: `Usar Minera E2E ${run}` }).click();
  await expect(dialog).toHaveCount(0);
  await expect(customer).toContainText(`Minera E2E ${run}`);
  await expect(customer).toContainText(`NIT ${MANAGED_NIT}`);
  await expect(sale.getByText('Descuento', { exact: true })).toBeVisible();
  await expect(total).not.toHaveText(withoutDiscount);

  // the customer and the discount survive a reload
  await page.reload();
  await expect(sale.locator('rs-pos-customer')).toContainText(`Minera E2E ${run}`);
  await expect(sale.getByTestId('pos-total')).not.toHaveText(withoutDiscount);

  // back to a final consumer: no discount
  await sale.getByRole('button', { name: 'Cambiar cliente' }).click();
  await page.getByRole('dialog', { name: 'Cliente y datos de factura' }).getByRole('button', { name: 'Consumidor final' }).click();
  await expect(sale.locator('rs-pos-customer')).toContainText('Consumidor final');
  await expect(sale.getByTestId('pos-total')).toHaveText(withoutDiscount);

  // a NIT that does not look like one is refused before it reaches the API; a valid one creates the customer and uses it
  await sale.getByRole('button', { name: 'Agregar NIT o cliente' }).click();
  const search2 = page.getByRole('dialog', { name: 'Cliente y datos de factura' });
  await search2.getByRole('button', { name: 'Nuevo cliente' }).click();
  await search2.getByLabel('Número de documento').fill('12a45');
  await search2.getByLabel('Nombre o razón social').fill(`Taller E2E ${run}`);
  await search2.getByRole('button', { name: 'Guardar y usar' }).click();
  await expect(search2).toContainText('NIT inválido');
  await search2.getByLabel('Número de documento').fill(QUICK_NIT);
  await search2.getByRole('button', { name: 'Guardar y usar' }).click();
  await expect(search2).toHaveCount(0);
  await expect(sale.locator('rs-pos-customer')).toContainText(`Taller E2E ${run}`);
  // quick creation never sets a discount: the total is the full price
  await expect(sale.getByTestId('pos-total')).toHaveText(withoutDiscount);
});
