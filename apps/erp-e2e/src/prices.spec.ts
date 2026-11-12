import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-26 · Management consults and edits a product's price. Needs the demo data from `pnpm db:seed` (the 6205 bearings with
 * stock, a register per branch and the administrator, who holds `sales.prices.edit`). The price of one bearing goes up by Bs 10
 * and is put back afterwards, together with the history rows the test wrote; the administrator's shift opened to look at the POS
 * is closed in the database like the cash register spec does.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';

const prisma = new PrismaClient();
let productId = '';
let code = '';
let originalPrice = '';
let startedAt = new Date();

async function closeAdminShifts() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) return;
  await prisma.posCheckout.deleteMany({ where: { cashierId: user.id, status: { in: ['OPEN', 'PAYING'] } } });
  await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
}

test.beforeAll(async () => {
  await closeAdminShifts();
  startedAt = new Date();
  const register = await prisma.cashRegister.findFirstOrThrow({
    where: { status: 'ACTIVE', branch: { name: BRANCH } },
    orderBy: { name: 'asc' },
    select: { warehouseId: true },
  });
  const level = await prisma.stockLevel.findFirst({
    where: {
      warehouseId: register.warehouseId,
      quantity: { gte: 1 },
      product: { status: 'ACTIVE', manufacturerCode: { startsWith: '6205' }, salePrice: { gt: 0 } },
    },
    select: { product: { select: { id: true, manufacturerCode: true, salePrice: true } } },
    orderBy: { product: { manufacturerCode: 'asc' } },
  });
  if (!level) throw new Error('The seed has no priced 6205 bearing with stock in the register warehouse');
  productId = level.product.id;
  code = level.product.manufacturerCode;
  originalPrice = level.product.salePrice.toFixed(2);
});

test.afterAll(async () => {
  if (productId) {
    await prisma.priceChange.deleteMany({ where: { productId, createdAt: { gte: startedAt } } });
    await prisma.product.update({ where: { id: productId }, data: { salePrice: originalPrice } });
  }
  await closeAdminShifts();
  await prisma.$disconnect();
});

/** `245.00` as the ERP prints it: `Bs 245,00`. */
const bs = (amount: string) => {
  const [int, frac] = amount.split('.');
  return `Bs ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${frac}`;
};

test('Management edits a price in the dialog; the list, its history and the POS show the new price', async ({ page }) => {
  const newPrice = (Number(originalPrice) + 10).toFixed(2);
  await login(page);

  // VP-11: the list with its KPIs, found by code
  await page.goto('/sales/prices');
  await expect(page.getByRole('heading', { name: 'Precios y descuentos', level: 1 })).toBeVisible();
  await expect(page.getByText('Un solo precio de venta por producto y empresa.')).toBeVisible();
  await expect(page.locator('rs-kpi-card').filter({ hasText: 'Productos con precio' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar productos' }).fill(code);
  const row = page.locator('rs-doc-table tbody tr').filter({ hasText: code }).first();
  await expect(row).toContainText(bs(originalPrice));

  // VP-11b: the dialog previews the change and refuses the same price
  await row.getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Editar precio' }).click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`Editar precio · ${code}`) });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('price-subtitle')).toContainText(`precio actual ${bs(originalPrice)}`);
  await dialog.locator('#price-new').fill(originalPrice.replace('.', ','));
  await dialog.getByTestId('price-save').click();
  await expect(dialog).toContainText('El precio nuevo es igual al actual.');

  await dialog.locator('#price-new').fill(newPrice.replace('.', ','));
  await expect(dialog.getByTestId('price-change')).toContainText('+ Bs 10,00');
  await dialog.locator('#price-reason').fill('Nueva lista del proveedor');
  await dialog.getByTestId('price-save').click();
  await expect(page.getByText(`Precio de ${code} actualizado a ${bs(newPrice)}`)).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // the list shows the new price and, in "Última actualización", the change just made
  await expect(row).toContainText(bs(newPrice));
  await expect(row).toContainText(/\+\d+,\d %/);

  // one price per product: the column changed and the edit is recorded
  const stored = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
  expect(stored.salePrice.toFixed(2)).toBe(newPrice);
  const changes = await prisma.priceChange.findMany({ where: { productId, createdAt: { gte: startedAt } } });
  expect(changes).toHaveLength(1);
  expect(changes[0]).toMatchObject({ source: 'MANUAL', reason: 'Nueva lista del proveedor' });
  expect([changes[0].oldPrice.toFixed(2), changes[0].newPrice.toFixed(2)]).toEqual([originalPrice, newPrice]);
  expect(await prisma.auditLog.count({ where: { action: 'sales.price.update', entityId: productId, createdAt: { gte: startedAt } } })).toBe(1);

  // the POS reads the same price
  await page.goto('/sales/cash-register/open');
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await page.locator('#cash-float').fill('100,00');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page).toHaveURL(/\/sales\/pos$/);
  await page.keyboard.press('F2');
  await page.getByRole('searchbox', { name: 'Buscar producto' }).fill(code);
  await expect(page.locator('rs-pos-result-row').filter({ hasText: code }).first()).toContainText(bs(newPrice));
});
