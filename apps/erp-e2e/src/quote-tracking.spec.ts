import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-17 and HU-VEN-18 · a draft quote is sent by e-mail (the sending is logged and the quote is "Enviada"), its validity
 * passes and the detail says it expired, and renewing it brings it back to "Enviada" with a new validity.
 * Needs the demo data from `pnpm db:seed`. It creates its own customer and quote and removes them afterwards.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const CUSTOMER = 'Cliente E2E Seguimiento';

const prisma = new PrismaClient();
let companyId = '';
let quoteId = '';

async function cleanup() {
  if (!companyId) return;
  await prisma.quote.deleteMany({ where: { companyId, customer: { name: CUSTOMER } } });
  await prisma.customer.deleteMany({ where: { companyId, name: CUSTOMER } });
}

test.beforeAll(async () => {
  const membership = await prisma.membership.findFirstOrThrow({
    where: { user: { email: EMAIL }, company: { slug: 'rodalaser' } },
    select: { companyId: true, userId: true },
  });
  companyId = membership.companyId;
  await cleanup();
  const product = await prisma.product.findFirstOrThrow({ where: { companyId, status: 'ACTIVE' }, orderBy: { manufacturerCode: 'asc' } });
  const customer = await prisma.customer.create({
    data: { companyId, name: CUSTOMER, documentType: 1, documentNumber: '55443322', email: 'seguimiento@e2e.test', phone: '70000000' },
  });
  const quote = await prisma.quote.create({
    data: {
      companyId,
      number: `COT-E2E${Date.now().toString().slice(-6)}`,
      customerId: customer.id,
      status: 'DRAFT',
      validUntil: new Date(Date.now() + 7 * 86_400_000),
      subtotal: product.salePrice,
      total: product.salePrice,
      createdById: membership.userId,
      items: { create: [{ companyId, productId: product.id, quantity: 1, unitPrice: product.salePrice, lineTotal: product.salePrice, sortOrder: 0 }] },
    },
  });
  quoteId = quote.id;
});

test.afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test('a quote is sent, expires and is renewed', async ({ page }) => {
  await login(page);
  await page.goto(`/sales/quotes/${quoteId}`);
  await expect(page.getByText('Borrador').first()).toBeVisible();

  // send it by e-mail: it becomes "Enviada" and the sending is on the log
  await page.getByTestId('quote-send').click();
  await page.getByRole('button', { name: 'Correo' }).click();
  await page.getByTestId('quote-send-confirm').click();
  await expect(page.getByText('Enviada').first()).toBeVisible();
  await expect(page.getByText('seguimiento@e2e.test')).toBeVisible();
  expect(await prisma.outboxEvent.count({ where: { companyId, type: 'sales.quote-email' } })).toBeGreaterThan(0);

  // the days go by: the detail says it expired even though the nightly job has not run
  await prisma.quote.update({ where: { id: quoteId }, data: { validUntil: new Date(Date.now() - 3 * 86_400_000) } });
  await page.reload();
  await expect(page.getByText('La cotización venció')).toBeVisible();
  await expect(page.getByTestId('quote-send')).toHaveCount(0);

  // renewing brings it back to "Enviada" with a new validity
  await page.getByTestId('quote-renew').click();
  await page.getByTestId('quote-renew-confirm').click();
  await expect(page.getByText('La cotización venció')).toHaveCount(0);
  await expect(page.getByText('Enviada').first()).toBeVisible();
  const renewed = await prisma.quote.findUniqueOrThrow({ where: { id: quoteId } });
  expect(renewed.status).toBe('SENT');
  expect(renewed.validUntil.getTime()).toBeGreaterThan(Date.now());
});
