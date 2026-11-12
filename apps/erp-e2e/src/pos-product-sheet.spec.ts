import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-04 · technical sheet of a bearing inside the POS, and adding it to the sale from the sheet. Needs the demo data from
 * `pnpm db:seed`. Like the HU-VEN-03 e2e, it creates its own bearing (with stock) and opens the shift it needs directly in the
 * database, and removes everything afterwards.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';
const RUN = Date.now().toString(36).toUpperCase();
const CODE = `E2ES-${RUN}`;

const prisma = new PrismaClient();
let productId = '';

async function reset() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) return;
  const carts = await prisma.posCheckout.findMany({ where: { cashierId: user.id, status: 'OPEN' }, select: { id: true } });
  await prisma.posCheckoutItem.deleteMany({ where: { checkoutId: { in: carts.map((c) => c.id) } } });
  await prisma.posCheckout.deleteMany({ where: { id: { in: carts.map((c) => c.id) } } });
  await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
}

test.beforeAll(async () => {
  await reset();
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL }, select: { id: true } });
  const register = await prisma.cashRegister.findFirstOrThrow({
    where: { status: 'ACTIVE', branch: { name: BRANCH } },
    orderBy: { name: 'asc' },
    select: { id: true, companyId: true, warehouseId: true },
  });
  const { companyId } = register;
  await prisma.cashShift.create({ data: { number: `T-${Math.random().toString(36).slice(2, 10)}`, companyId, registerId: register.id, openingFloat: '500.00', openedById: user.id } });
  const category = await prisma.category.findFirstOrThrow({ where: { companyId, name: 'Rígidos de bolas' }, select: { id: true } });
  const brand = await prisma.brand.findFirstOrThrow({ where: { companyId, name: 'SKF' }, select: { id: true } });
  const product = await prisma.product.create({
    data: {
      companyId,
      sku: `E2ES-${RUN}`,
      manufacturerCode: CODE,
      brandId: brand.id,
      categoryId: category.id,
      name: 'Rodamiento rígido de bolas',
      salePrice: '245.00',
      cost: '100.0000',
      status: 'ACTIVE',
      dimensions: { create: { companyId, innerDiameter: '81', outerDiameter: '151', width: '34' } },
    },
  });
  productId = product.id;
  // Deliberate exception to "stock only through StockMovementService": e2e fixture row, removed in afterAll, like the seed.
  await prisma.stockLevel.create({ data: { companyId, productId, warehouseId: register.warehouseId, quantity: 10 } });
});

test.afterAll(async () => {
  await reset();
  await prisma.stockLevel.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.$disconnect();
});

test('the cashier opens the technical sheet and adds two units from it', async ({ page }) => {
  await login(page);
  await page.goto('/sales/pos');

  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  await page.getByRole('searchbox', { name: 'Buscar producto' }).fill(CODE);
  const row = page.locator('rs-pos-result-row').filter({ hasText: CODE });
  await row.getByRole('button', { name: 'Ver ficha técnica' }).click();

  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Dimensiones');
  await expect(sheet).toContainText('Stock por sucursal');
  await expect(sheet).toContainText('El costo no se muestra en ventas');

  await sheet.getByRole('button', { name: 'Sumar uno' }).click();
  await sheet.getByRole('button', { name: 'Agregar a la venta' }).click();

  await expect(sheet).toHaveCount(0);
  const line = sale.locator('rs-pos-cart-line');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(CODE);
  await expect(sale.getByTestId('pos-total')).toHaveText('Bs 490,00');
});
