import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-20 · an order is dispatched and invoiced in parts: the first dispatch gives part of one line, the order shows
 * "Despacho parcial" with the balance pending, the second dispatch gives the rest and completes it. Each dispatch leaves a
 * sale with its invoice and takes the units out of the warehouse. Needs the demo data from `pnpm db:seed`. It creates its own
 * customer, order and stock level, and removes them (and the movements they wrote) afterwards.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const CUSTOMER = 'Cliente E2E Despacho';
const ORDER_NUMBER = 'PED-E2E-0001';

const prisma = new PrismaClient();
let companyId = '';
let productId = '';
let warehouseId = '';
let orderId = '';
let previousLevel: { quantity: number; reserved: number } | null = null;

async function cleanup() {
  if (!companyId) return;
  const customer = await prisma.customer.findFirst({ where: { companyId, name: CUSTOMER }, select: { id: true } });
  if (customer) {
    const sales = await prisma.sale.findMany({ where: { companyId, customerId: customer.id }, select: { id: true, number: true } });
    await prisma.$transaction(async (tx) => {
      // the immutability trigger blocks DELETE on stock_movements; cleanup bypasses it inside its own transaction
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.stockMovement.deleteMany({ where: { companyId, refType: 'SALE', refNumber: { in: sales.map((s) => s.number) } } });
    });
    await prisma.dispatch.deleteMany({ where: { companyId, order: { customerId: customer.id } } });
    await prisma.salesOrder.deleteMany({ where: { companyId, customerId: customer.id } });
    await prisma.invoice.deleteMany({ where: { companyId, saleId: { in: sales.map((s) => s.id) } } });
    await prisma.sale.deleteMany({ where: { companyId, customerId: customer.id } });
    await prisma.customer.delete({ where: { id: customer.id } });
  }
  await prisma.outboxEvent.deleteMany({ where: { companyId, type: { in: ['sale.completed', 'sales.order.dispatched'] }, payload: { path: ['orderNumber'], equals: ORDER_NUMBER } } });
}

test.beforeAll(async () => {
  const membership = await prisma.membership.findFirstOrThrow({ where: { user: { email: EMAIL }, company: { slug: 'rodalaser' } }, select: { companyId: true, userId: true } });
  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { status: 'ACTIVE', companyId: membership.companyId },
    orderBy: [{ isMain: 'desc' }, { name: 'asc' }],
    select: { id: true, branchId: true, companyId: true },
  });
  companyId = warehouse.companyId;
  warehouseId = warehouse.id;
  await cleanup();

  const product = await prisma.product.findFirstOrThrow({ where: { companyId, status: 'ACTIVE' }, orderBy: { manufacturerCode: 'asc' } });
  productId = product.id;
  const existing = await prisma.stockLevel.findUnique({ where: { productId_warehouseId: { productId, warehouseId } } });
  previousLevel = existing ? { quantity: existing.quantity, reserved: existing.reserved } : null;
  // 6 on the shelf and all of them reserved for the order below
  await prisma.stockLevel.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    create: { companyId, productId, warehouseId, quantity: 6, reserved: 6 },
    update: { quantity: 6, reserved: 6 },
  });
  const customer = await prisma.customer.create({ data: { companyId, name: CUSTOMER, documentType: 1, documentNumber: '99887755' } });
  const order = await prisma.salesOrder.create({
    data: {
      companyId,
      number: ORDER_NUMBER,
      customerId: customer.id,
      branchId: warehouse.branchId,
      warehouseId,
      subtotal: '600.00',
      total: '600.00',
      createdById: membership.userId,
      items: { create: [{ companyId, productId, quantity: 6, unitPrice: '100.00', lineTotal: '600.00', reservedQuantity: 6, sortOrder: 0 }] },
    },
    select: { id: true },
  });
  orderId = order.id;
});

test.afterAll(async () => {
  await cleanup();
  if (productId) {
    if (previousLevel) await prisma.stockLevel.update({ where: { productId_warehouseId: { productId, warehouseId } }, data: previousLevel });
    else await prisma.stockLevel.deleteMany({ where: { productId, warehouseId } });
  }
  await prisma.$disconnect();
});

test('an order is dispatched and invoiced in two parts, and the balance waits on the order', async ({ page }) => {
  await login(page);
  await page.goto(`/sales/orders/${orderId}`);
  await expect(page.getByText(`Pedido ${ORDER_NUMBER}`).first()).toBeVisible();

  // first dispatch: 4 of the 6 pieces
  await page.getByTestId('order-dispatch').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Se factura ahora (6 piezas)')).toBeVisible();
  await dialog.getByRole('button', { name: 'Quitar una pieza' }).click();
  await dialog.getByRole('button', { name: 'Quitar una pieza' }).click();
  await expect(dialog.getByText('Se factura ahora (4 piezas)')).toBeVisible();
  await expect(dialog.getByTestId('dispatch-remaining')).toContainText('Las 2 piezas faltantes quedan en el pedido');
  await expect(dialog.getByTestId('dispatch-total')).toContainText('400,00');
  await dialog.getByTestId('dispatch-send').click();

  // the order shows a partial dispatch with the balance pending, and the dispatch with its invoice
  await expect(page.getByText('Despacho parcial').first()).toBeVisible();
  await expect(page.getByText('Pendiente 2')).toBeVisible();
  await expect(page.getByText('DSP-000')).toBeVisible();
  const level = await prisma.stockLevel.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId } } });
  expect(level).toMatchObject({ quantity: 2, reserved: 2 });
  const first = await prisma.sale.findFirstOrThrow({ where: { companyId, customer: { name: CUSTOMER } }, include: { invoice: true } });
  expect(first).toMatchObject({ origin: 'ORDER', shiftId: null });
  expect(first.invoice?.status).toBe('PENDING');
  expect(first.total.toFixed(2)).toBe('400.00');

  // second dispatch: what is left
  await page.getByTestId('order-dispatch').click();
  await expect(dialog.getByText('Se factura ahora (2 piezas)')).toBeVisible();
  await dialog.getByTestId('dispatch-send').click();
  await expect(page.getByText('despachado y facturado por completo')).toBeVisible();
  await expect(page.getByTestId('order-dispatch')).toHaveCount(0);

  const done = await prisma.stockLevel.findUniqueOrThrow({ where: { productId_warehouseId: { productId, warehouseId } } });
  expect(done).toMatchObject({ quantity: 0, reserved: 0 });
  const sales = await prisma.sale.findMany({ where: { companyId, customer: { name: CUSTOMER } } });
  expect(sales).toHaveLength(2);
  expect(sales.reduce((sum, s) => sum + Number(s.total), 0)).toBe(600);

  // the sale of a dispatch links back to its order
  await page.goto('/sales/history');
  await page.getByRole('link', { name: sales[0].number }).first().click();
  await expect(page.getByTestId('sale-order')).toContainText(ORDER_NUMBER);
});
