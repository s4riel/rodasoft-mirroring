import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-16 and HU-VEN-19 · a quote is created (customer, product search, quantity, validity), converted into an order in a
 * warehouse, and the order holds the stock: the product's reserved units grow, and cancelling the order gives them back.
 * Needs the demo data from `pnpm db:seed`. It creates its own customer and removes its quotes, orders and reservation.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const CUSTOMER = 'Cliente E2E Cotización';

const prisma = new PrismaClient();
let productId = '';
let code = '';
let warehouseName = '';
let warehouseId = '';
let companyId = '';
let previousLevel: { quantity: number; reserved: number } | null = null;

async function cleanup() {
  if (!companyId) return;
  const orders = await prisma.salesOrder.findMany({ where: { companyId, customer: { name: CUSTOMER } }, include: { items: true } });
  for (const order of orders) {
    if (order.status !== 'CANCELLED') {
      for (const item of order.items) {
        await prisma.stockLevel.updateMany({
          where: { productId: item.productId, warehouseId: order.warehouseId, reserved: { gte: item.reservedQuantity } },
          data: { reserved: { decrement: item.reservedQuantity } },
        });
      }
    }
  }
  await prisma.salesOrder.deleteMany({ where: { companyId, customer: { name: CUSTOMER } } });
  await prisma.quote.deleteMany({ where: { companyId, customer: { name: CUSTOMER } } });
  await prisma.customer.deleteMany({ where: { companyId, name: CUSTOMER } });
}

test.beforeAll(async () => {
  const membership = await prisma.membership.findFirstOrThrow({ where: { user: { email: EMAIL }, company: { slug: 'rodalaser' } }, select: { companyId: true } });
  const warehouse = await prisma.warehouse.findFirstOrThrow({
    // the editor and the conversion dialog preselect the first warehouse: main ones first, then by name
    where: { status: 'ACTIVE', companyId: membership.companyId },
    orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, companyId: true },
  });
  companyId = warehouse.companyId;
  warehouseId = warehouse.id;
  warehouseName = warehouse.name;
  await cleanup();
  // the seed may have no stock in that warehouse: the test sets its own level and puts the old one back afterwards
  const product = await prisma.product.findFirstOrThrow({ where: { companyId, status: 'ACTIVE' }, orderBy: { manufacturerCode: 'asc' } });
  productId = product.id;
  code = product.manufacturerCode;
  const existing = await prisma.stockLevel.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  previousLevel = existing ? { quantity: existing.quantity, reserved: existing.reserved } : null;
  await prisma.stockLevel.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    create: { companyId, productId, warehouseId, quantity: 6, reserved: 0 },
    update: { quantity: 6, reserved: 0 },
  });
  await prisma.customer.create({ data: { companyId, name: CUSTOMER, documentType: 1, documentNumber: '99887766' } });
});

test.afterAll(async () => {
  await cleanup();
  if (productId) {
    if (previousLevel) await prisma.stockLevel.update({ where: { productId_warehouseId: { productId, warehouseId } }, data: previousLevel });
    else await prisma.stockLevel.deleteMany({ where: { productId, warehouseId } });
  }
  await prisma.$disconnect();
});

test('a quote becomes an order that reserves the stock, and cancelling the order releases it', async ({ page }) => {
  // the editor preselects its own warehouse, so the reservation is counted over all warehouses of the product
  const reserved = async () => (await prisma.stockLevel.aggregate({ where: { productId }, _sum: { reserved: true } }))._sum.reserved ?? 0;
  const before = await reserved();
  await login(page);

  // new quote: customer, product, quantity
  await page.goto('/sales/quotes/new');
  await page.locator('#quote-customer').fill('E2E Cotización');
  await page.getByRole('button', { name: new RegExp(CUSTOMER) }).click();
  await page.locator('#quote-product').fill(code);
  // the result row of that exact code, once the search answers
  await page.locator('.result', { hasText: code }).first().click();
  await page.getByRole('button', { name: 'Más' }).click();
  await expect(page.getByTestId('quote-total')).not.toHaveText(/^Bs\s*0[,.]00$/);
  await page.getByTestId('quote-save').click();

  // the detail of the draft: a quote reserves nothing
  await expect(page).toHaveURL(/\/sales\/quotes\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Borrador')).toBeVisible();
  expect(await reserved()).toBe(before);

  // convert it in the main warehouse
  await page.getByTestId('quote-convert').click();
  await page.getByTestId('quote-convert-confirm').click();
  await expect(page).toHaveURL(/\/sales\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Reservado').first()).toBeVisible();
  await expect(page.getByText(`reservado en ${warehouseName}`)).toBeVisible();
  expect(await reserved()).toBe(before + 2);

  // the order is the first row of Pedidos
  await page.goto('/sales/orders');
  await expect(page.getByRole('link', { name: /^PED-/ }).first()).toBeVisible();

  // cancelling gives the units back
  await page.getByRole('link', { name: /^PED-/ }).first().click();
  await page.getByTestId('order-cancel').click();
  await page.locator('#order-cancel-reason').fill('Prueba E2E');
  await page.getByTestId('order-cancel-confirm').click();
  await expect(page.getByText('Anulado').first()).toBeVisible();
  expect(await reserved()).toBe(before);
});
