import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { currentVatBookPeriod, Decimal, vatBookFileName } from '@rodasoft/domain';
import { login } from './support/auth';

/**
 * HU-FAC-18, 19, 20 · the VAT books. The sales book shows the 13 % fiscal debit of the valid invoices of the La Paz month (the test
 * checks it against the database); the purchases book shows an observed purchase that adds no credit until its NIT is verified in the
 * dialog; and the export downloads the open month as a draft file. The purchases are created by the test (`source = E2E`) and removed
 * after. Needs the demo data from `pnpm db:seed`.
 */

const prisma = new PrismaClient();
const period = currentVatBookPeriod(new Date());
let companyId = '';
let createdIds: string[] = [];

/** The La Paz month as [start, end) instants. */
function monthRange(p: string): { gte: Date; lt: Date } {
  const [year, month] = p.split('-').map(Number);
  return { gte: new Date(Date.UTC(year, month - 1, 1, 4)), lt: new Date(Date.UTC(year, month, 1, 4)) };
}

test.beforeAll(async () => {
  companyId = (await prisma.company.findFirstOrThrow({ where: { slug: 'rodalaser' }, select: { id: true } })).id;
});

test.afterAll(async () => {
  await prisma.purchaseBookEntry.deleteMany({ where: { companyId, source: 'E2E' } });
  await prisma.$disconnect();
});

test('the sales book shows the fiscal debit of the valid invoices of the month, and the open period is a draft', async ({ page }) => {
  await login(page);
  const invoices = await prisma.invoice.findMany({
    where: { companyId, status: { in: ['VALID', 'CANCELLATION_PENDING'] }, issuedAt: monthRange(period) },
    select: { total: true },
  });
  const debit = invoices.reduce((sum, i) => sum.add(Decimal.of(i.total.toFixed(2)).percent('13')), Decimal.zero());
  const credited = await prisma.creditNote.aggregate({ where: { companyId, status: 'VALID', issuedAt: monthRange(period) }, _sum: { vatAdjusted: true } });
  const net = debit.sub(Decimal.of((credited._sum.vatAdjusted ?? 0).toString()));

  await page.goto('/invoicing/books');
  await expect(page.getByRole('heading', { name: 'Libro de ventas', level: 1 })).toBeVisible();
  await expect(page.getByTestId('book-draft-note')).toContainText('Lo que exportes ahora sale como borrador');
  await expect(page.getByTestId('book-kpis')).toContainText(net.format());
});

test('an observed purchase adds no credit until its NIT is verified; then it does', async ({ page }) => {
  const observed = await prisma.purchaseBookEntry.create({
    data: {
      companyId,
      period,
      date: new Date(),
      // the simulated SIN does not know the NITs that start with 999
      supplierNit: '9991234567',
      supplierName: 'Proveedor Observado E2E',
      authorizationCode: 'E2E',
      invoiceNumber: '990221',
      total: '1200.00',
      vatCredit: '156.00',
      status: 'OBSERVED',
      observation: 'NIT INVALIDO',
      source: 'E2E',
    },
  });
  createdIds = [observed.id];
  await login(page);
  await page.goto('/invoicing/books?book=purchases');
  await expect(page.getByRole('heading', { name: 'Libro de compras', level: 1 })).toBeVisible();
  const row = page.locator('rs-doc-table tbody tr').filter({ hasText: '990221' });
  await expect(row).toContainText('Observada');
  await expect(page.getByTestId('book-observed-note')).toBeVisible();

  // a NIT the SIN does not know stays observed
  await row.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Verificar NIT' }).click();
  await expect(page.getByRole('heading', { name: 'Compra 990221 · observada', level: 1 })).toBeVisible();
  await expect(page.getByText('Con el NIT correcto, esta compra suma Bs 156,00 de crédito fiscal')).toBeVisible();
  await page.getByTestId('purchase-nit-verify').click();
  await expect(page.getByText('El SIAT no reconoce este NIT')).toBeVisible();

  // a corrected NIT validates it: it becomes valid and adds its credit
  await page.locator('#purchase-nit').fill('1020304132');
  await page.getByTestId('purchase-nit-verify').click();
  await expect(page.getByTestId('purchase-valid-note')).toBeVisible();
  await page.getByTestId('purchase-save').click();
  await expect(page).toHaveURL(/\/invoicing\/books\?book=purchases/);
  await expect(page.locator('rs-doc-table tbody tr').filter({ hasText: '990221' })).toContainText('Válida');
  const saved = await prisma.purchaseBookEntry.findUniqueOrThrow({ where: { id: observed.id } });
  expect(saved).toMatchObject({ status: 'VALID', supplierNit: '1020304132' });
  expect(saved.nitVerifiedAt).not.toBeNull();
});

test('exports the open month of the sales book as a draft XLSX', async ({ page }) => {
  await login(page);
  await page.goto('/invoicing/books');
  await page.getByTestId('book-export').click();
  const dialog = page.getByRole('dialog', { name: 'Exportar libro' });
  await expect(dialog.getByTestId('export-file-name')).toHaveText(vatBookFileName('SALES', period, 'XLSX', true));
  const [download] = await Promise.all([page.waitForEvent('download'), dialog.getByTestId('export-confirm').click()]);
  expect(download.suggestedFilename()).toBe(`libro-ventas-${period}-BORRADOR.xlsx`);
  expect((await download.createReadStream()) !== null).toBe(true);
});
