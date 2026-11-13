import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';
import { invoiceOfSale, resetAdminShifts, sellableCode, sellOne } from './support/invoicing';

/**
 * HU-FAC-07, HU-FAC-08 · the SIAT rejects an invoice because the customer's NIT is not recognised. The detail shows the reason,
 * the customer can be corrected, the NIT is checked against the SIN and an exception can be asked from Management. The
 * simulated SIN rejects every NIT starting with `999`. Needs the demo data from `pnpm db:seed`.
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

test('a rejected NIT shows its reason, is corrected and verified with the SIN, and an exception can be asked', async ({ page }) => {
  await login(page);
  const number = await sellOne(page, code);
  const invoice = await invoiceOfSale(prisma, number);
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: 'REJECTED',
      customerDocumentType: 5,
      customerDocumentNumber: '9991234',
      nitVerifiedAt: null,
      nitException: false,
      rejectionCode: 1037,
      rejectionMessage: 'NIT INVALIDO',
      lastAttemptAt: new Date(),
    },
  });

  await page.goto(`/invoicing/invoices/${invoice.id}`);
  const note = page.getByTestId('invoice-rejected-note');
  await expect(note).toContainText('NIT INVALIDO');
  await expect(note).toContainText('Código 1037');

  // without a verified NIT it cannot be resent, and the page says what to do
  const fix = page.getByTestId('invoice-customer-fix');
  await expect(fix).toBeVisible();
  await expect(page.getByTestId('fix-resend')).toBeDisabled();

  // the SIN does not know the NIT
  await page.getByTestId('fix-verify').click();
  await expect(page.getByTestId('fix-verification')).toContainText('El SIN no reconoce el NIT');
  await expect(page.getByTestId('fix-resend')).toBeDisabled();

  // a NIT the SIN knows is verified and the invoice can be resent
  await page.locator('#fix-number').fill('1023456789');
  await page.getByTestId('fix-save').click();
  await page.getByTestId('fix-verify').click();
  await expect(page.getByTestId('fix-verification')).toContainText('NIT verificado');
  await expect(page.getByTestId('fix-resend')).toBeEnabled();
  const saved = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, select: { customerDocumentNumber: true, nitVerifiedAt: true } });
  expect(saved.customerDocumentNumber).toBe('1023456789');
  expect(saved.nitVerifiedAt).not.toBeNull();
});
