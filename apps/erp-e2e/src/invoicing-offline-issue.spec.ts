import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';
import { invoiceOfSale, resetAdminShifts, sellableCode, sellOne } from './support/invoicing';

/**
 * HU-FAC-01, HU-FAC-02 · the SIAT does not answer. There is no contingency: the invoice stays "No facturada en SIAT", nothing
 * is retried by itself, the list warns about it and who may issue can do it by hand. The test makes the sale in the POS and
 * leaves its invoice PENDING with an "unavailable" error, which is what the worker leaves after an offline attempt. Needs the
 * demo data from `pnpm db:seed`.
 */

const prisma = new PrismaClient();
let code = '';

test.beforeAll(async () => {
  await resetAdminShifts(prisma);
  code = await sellableCode(prisma);
});

test.afterAll(async () => {
  await resetAdminShifts(prisma);
  await prisma.$disconnect();
});

test('an invoice the SIAT did not answer stays unissued, the list says so and it can be issued by hand', async ({ page }) => {
  await login(page);
  const number = await sellOne(page, code);
  const invoice = await invoiceOfSale(prisma, number);
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: 'PENDING', number: null, cuf: null, issuedAt: null, lastError: 'SIAT_UNAVAILABLE', lastAttemptAt: new Date() },
  });

  // the list warns that there are invoices without issuing, and the sidebar counts them
  await page.goto('/invoicing');
  await expect(page.getByTestId('invoice-not-issued-note')).toBeVisible();
  await expect(page.locator('rs-doc-table tbody tr').filter({ hasText: number }).first()).toContainText('No facturada en SIAT');

  // the detail explains it and offers to issue
  await page.goto(`/invoicing/invoices/${invoice.id}`);
  await expect(page.getByTestId('invoice-pending-note')).toContainText('El SIAT no respondió');
  await expect(page.getByTestId('invoice-issue')).toBeVisible();
  await expect(page.getByTestId('invoice-download-pdf')).toHaveCount(0);

  // nothing retried by itself: a moment later it is still pending in the database
  const stillPending = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { status: true } });
  expect(stillPending.status).toBe('PENDING');
});
