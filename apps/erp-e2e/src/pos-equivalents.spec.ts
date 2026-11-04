import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-03 · equivalents of an out-of-stock product at the POS. Needs the demo data from `pnpm db:seed` (registers, brands,
 * the bearing categories and the administrator). The seed's stock is pseudo-random, so the test creates its own out-of-stock
 * bearing and one in-stock equivalent with differences, with measurements no seeded bearing has, and removes them afterwards.
 * A shift cannot be closed from the app yet (HU-VEN-23), so the test also closes the administrator's open shifts and drops
 * their open cart straight in the database, and opens the shift it needs the same way (HU-VEN-01 has its own e2e).
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';
const RUN = Date.now().toString(36).toUpperCase();
const ORIGINAL = `E2EQ-ORIG-${RUN}`;
const EQUIVALENT = `E2EQ-ALT-${RUN}`;
const NOTE = 'blindaje metálico en vez de sello';

const prisma = new PrismaClient();
const productIds: string[] = [];

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
  await prisma.cashShift.create({ data: { companyId, registerId: register.id, openingFloat: '500.00', openedById: user.id } });

  const category = await prisma.category.findFirstOrThrow({ where: { companyId, name: 'Rígidos de bolas' }, select: { id: true } });
  const skf = await prisma.brand.findFirstOrThrow({ where: { companyId, name: 'SKF' }, select: { id: true } });
  const fag = await prisma.brand.findFirstOrThrow({ where: { companyId, name: 'FAG' }, select: { id: true } });
  const dimensions = { innerDiameter: '77', outerDiameter: '150', width: '33' };
  const create = (code: string, brandId: string, seal: string, sku: string) =>
    prisma.product.create({
      data: {
        companyId,
        sku,
        manufacturerCode: code,
        brandId,
        categoryId: category.id,
        name: 'Rodamiento rígido de bolas',
        salePrice: '310.00',
        cost: '120.0000',
        status: 'ACTIVE',
        attributes: { seal },
        dimensions: { create: { companyId, ...dimensions } },
      },
    });
  const original = await create(ORIGINAL, skf.id, '2RS', `E2EQ-${RUN}-1`);
  const equivalent = await create(EQUIVALENT, fag.id, '2Z', `E2EQ-${RUN}-2`);
  productIds.push(original.id, equivalent.id);

  // Deliberate exception to "stock only through StockMovementService": e2e fixture row, removed in afterAll, like the seed
  // and the integration fixtures. The original has no stock here, the equivalent has 7.
  await prisma.stockLevel.create({ data: { companyId, productId: equivalent.id, warehouseId: register.warehouseId, quantity: 7 } });
  const [productAId, productBId] = original.id < equivalent.id ? [original.id, equivalent.id] : [equivalent.id, original.id];
  await prisma.equivalence.create({ data: { companyId, productAId, productBId, notes: NOTE, approvedAt: new Date() } });
});

test.afterAll(async () => {
  await reset();
  // the equivalence link goes with its products
  await prisma.stockLevel.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.$disconnect();
});

test('the cashier opens the equivalents of an out-of-stock product and adds one to the sale', async ({ page }) => {
  await login(page);
  await page.goto('/sales/pos');

  const sale = page.getByRole('complementary', { name: 'Venta actual' });
  await page.getByRole('searchbox', { name: 'Buscar producto' }).fill(ORIGINAL);
  const row = page.locator('rs-pos-result-row').filter({ hasText: ORIGINAL });
  await expect(row).toContainText('Agotado aquí');
  // an out-of-stock product is not added: its action is Equivalentes
  await expect(row.getByRole('button', { name: `Agregar ${ORIGINAL}` })).toHaveCount(0);

  await row.getByRole('button', { name: 'Equivalentes' }).click();
  const panel = page.locator('rs-pos-equivalents-panel');
  await expect(panel).toContainText(`Sin stock de ${ORIGINAL} en`);
  await expect(panel).toContainText('equivalentes disponibles');
  const equivalentRow = panel.locator('rs-pos-result-row').filter({ hasText: EQUIVALENT });
  await expect(equivalentRow).toContainText(`Con diferencias · ${NOTE} · FAG`);
  await expect(equivalentRow).toContainText(/7 en /);
  await expect(equivalentRow).toContainText('Bs 310,00');

  // a second click closes the panel
  await row.getByRole('button', { name: 'Equivalentes' }).click();
  await expect(panel).toHaveCount(0);
  await row.getByRole('button', { name: 'Equivalentes' }).click();
  await expect(panel).toBeVisible();

  // Agregar puts the equivalent in the cart
  await equivalentRow.getByRole('button', { name: `Agregar ${EQUIVALENT}` }).click();
  const line = sale.locator('rs-pos-cart-line');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(EQUIVALENT);
  await expect(sale.getByTestId('pos-total')).toHaveText('Bs 310,00');
});
