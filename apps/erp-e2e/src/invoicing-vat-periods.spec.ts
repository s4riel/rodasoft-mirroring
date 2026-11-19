import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { currentVatBookPeriod, nextVatPeriod, previousVatPeriod, vatBookFileName } from '@rodasoft/domain';
import { login } from './support/auth';

/**
 * HU-FAC-21 · closing a VAT period. Last month has an observed purchase (created by the test, `source = E2E`): closing is blocked and
 * the dialog says which; the purchase NIT is verified with the SIN; the period closes; its export is final (no "BORRADOR"); and the
 * period is reopened with a reason. The periods before last month are closed by the test so the order rule does not get in the way,
 * and everything the test wrote is removed after. Needs the demo data from `pnpm db:seed`.
 */

const prisma = new PrismaClient();
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const label = (period: string) => {
  const [year, month] = period.split('-');
  const name = MONTHS[Number(month) - 1];
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${year}`;
};

const current = currentVatBookPeriod(new Date());
const last = previousVatPeriod(current);
let companyId = '';
let insertedPeriods: string[] = [];

test.beforeAll(async () => {
  companyId = (await prisma.company.findFirstOrThrow({ where: { slug: 'rodalaser' }, select: { id: true } })).id;
  // every period before last month is closed, so only the rules of last month are under test
  const [invoice, purchase, stored] = await Promise.all([
    prisma.invoice.aggregate({ where: { companyId }, _min: { issuedAt: true } }),
    prisma.purchaseBookEntry.aggregate({ where: { companyId, source: { not: 'E2E' } }, _min: { period: true } }),
    prisma.vatPeriod.aggregate({ where: { companyId }, _min: { period: true } }),
  ]);
  const candidates = [invoice._min.issuedAt ? currentVatBookPeriod(invoice._min.issuedAt) : null, purchase._min.period, stored._min.period].filter((p): p is string => p !== null);
  const first = candidates.sort()[0] ?? last;
  for (let period = first; period < last; period = nextVatPeriod(period)) {
    const exists = await prisma.vatPeriod.findFirst({ where: { companyId, period } });
    if (exists) continue;
    await prisma.vatPeriod.create({ data: { companyId, period, status: 'CLOSED', closedAt: new Date(), salesTotal: '0.00', fiscalDebit: '0.00', purchasesTotal: '0.00', vatCredit: '0.00' } });
    insertedPeriods.push(period);
  }
  await prisma.vatPeriod.deleteMany({ where: { companyId, period: last } });
});

test.afterAll(async () => {
  await prisma.purchaseBookEntry.deleteMany({ where: { companyId, source: 'E2E' } });
  await prisma.vatPeriod.deleteMany({ where: { companyId, period: { in: [last, ...insertedPeriods] } } });
  await prisma.$disconnect();
});

test('a blocked close shows what is pending; after fixing it the period closes, exports as final and can be reopened', async ({ page }) => {
  await prisma.purchaseBookEntry.create({
    data: {
      companyId,
      period: last,
      date: new Date(`${last}-10T12:00:00Z`),
      // the simulated SIN does not know the NITs that start with 999
      supplierNit: '9991234567',
      supplierName: 'Proveedor Cierre E2E',
      authorizationCode: 'E2E',
      invoiceNumber: '990331',
      total: '800.00',
      vatCredit: '104.00',
      status: 'OBSERVED',
      observation: 'NIT INVALIDO',
      source: 'E2E',
    },
  });
  await login(page);

  // blocked: the dialog lists the observed purchase and the button stays disabled
  await page.goto('/invoicing/books/periods');
  await expect(page.getByRole('heading', { name: 'Períodos del libro IVA', level: 1 })).toBeVisible();
  const row = page.locator('rs-doc-table tbody tr').filter({ hasText: label(last) });
  await expect(row).toContainText('Abierto');
  await row.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Cerrar período' }).click();
  const closeDialog = page.getByRole('dialog', { name: `No se puede cerrar ${label(last)}` });
  await expect(closeDialog.getByTestId('close-blockers')).toContainText('1 compra observada');
  await expect(closeDialog.getByTestId('close-purchases')).toContainText('Proveedor Cierre E2E');
  await expect(closeDialog.getByTestId('close-confirm')).toHaveCount(0);
  await expect(closeDialog.getByTestId('close-see-pending')).toBeVisible();
  await closeDialog.getByRole('button', { name: 'Volver' }).click();

  // fix it: a corrected NIT validates the purchase
  await page.goto(`/invoicing/books?book=purchases&period=${last}`);
  await page.locator('rs-doc-table tbody tr').filter({ hasText: '990331' }).getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Verificar NIT' }).click();
  await page.locator('#purchase-nit').fill('1020304132');
  await page.getByTestId('purchase-nit-verify').click();
  await expect(page.getByTestId('purchase-valid-note')).toBeVisible();
  await page.getByTestId('purchase-save').click();
  await expect(page).toHaveURL(/\/invoicing\/books\?book=purchases/);

  // now it closes
  await page.goto('/invoicing/books/periods');
  const again = page.locator('rs-doc-table tbody tr').filter({ hasText: label(last) });
  await again.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Cerrar período' }).click();
  const dialog = page.getByRole('dialog', { name: `Cerrar ${label(last)}` });
  await expect(dialog.getByTestId('close-ready')).toBeVisible();
  await dialog.getByTestId('close-confirm').click();
  await expect(page.locator('rs-doc-table tbody tr').filter({ hasText: label(last) })).toContainText('Cerrado');
  expect((await prisma.vatPeriod.findFirstOrThrow({ where: { companyId, period: last } })).status).toBe('CLOSED');

  // its export is final
  await page.goto(`/invoicing/books?period=${last}`);
  await expect(page.getByTestId('book-draft-note')).toHaveCount(0);
  await page.getByTestId('book-export').click();
  const exportDialog = page.getByRole('dialog', { name: 'Exportar libro' });
  await expect(exportDialog.getByTestId('export-file-name')).toHaveText(vatBookFileName('SALES', last, 'XLSX', false));
  const [download] = await Promise.all([page.waitForEvent('download'), exportDialog.getByTestId('export-confirm').click()]);
  expect(download.suggestedFilename()).toBe(`libro-ventas-${last}.xlsx`);

  // reopen it with a reason
  await page.goto('/invoicing/books/periods');
  const closed = page.locator('rs-doc-table tbody tr').filter({ hasText: label(last) });
  await closed.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Reabrir período' }).click();
  const reopen = page.getByRole('dialog', { name: `Reabrir ${label(last)}` });
  await reopen.locator('#reopen-reason').fill('Falta registrar una factura de compra');
  await reopen.getByTestId('reopen-confirm').click();
  await expect(page.locator('rs-doc-table tbody tr').filter({ hasText: label(last) })).toContainText('Abierto');
  expect(await prisma.auditLog.count({ where: { companyId, action: 'invoicing.period.reopen', entityId: last } })).toBeGreaterThan(0);
});
