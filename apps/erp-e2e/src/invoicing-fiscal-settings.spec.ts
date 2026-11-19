import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import ExcelJS from 'exceljs';
import { login } from './support/auth';

/**
 * HU-FAC-22…27 · the fiscal configuration: the summary with its checklist, syncing the SIN catalogues, registering a new point of
 * sale, homologating a product by Excel import, and the dialog to go to production (disabled while something is missing). Everything the
 * test writes is removed after. The last step only confirms PRODUCCIÓN when the whole stack is ready (a signature, a token and an API
 * started with `SIAT_ALLOW_SIMULATOR=true`); otherwise it checks that the dialog says what is missing and stays disabled. Needs the
 * demo data from `pnpm db:seed`.
 */

const prisma = new PrismaClient();
let companyId = '';
let productId = '';
let sku = '';
let createdPointName = '';

test.beforeAll(async () => {
  companyId = (await prisma.company.findFirstOrThrow({ where: { slug: 'rodalaser' }, select: { id: true } })).id;
  const product = await prisma.product.findFirstOrThrow({ where: { companyId, status: 'ACTIVE', sinProductCode: null }, select: { id: true, sku: true } });
  productId = product.id;
  sku = product.sku;
});

test.afterAll(async () => {
  await prisma.product.update({ where: { id: productId }, data: { sinProductCode: null, sinActivityCode: null, sinUnitCode: null } });
  if (createdPointName) {
    const point = await prisma.siatPointOfSale.findFirst({ where: { companyId, name: createdPointName }, select: { id: true } });
    if (point) {
      await prisma.cashRegister.deleteMany({ where: { pointOfSaleId: point.id } });
      await prisma.siatPointOfSale.delete({ where: { id: point.id } });
    }
    await prisma.simulatedSiatRecord.deleteMany({ where: { companyId, cuf: { startsWith: 'POS:' } } });
  }
  await prisma.$disconnect();
});

test('the summary links every section; catalogues sync; a point of sale is registered; a product is homologated by import', async ({ page }) => {
  await login(page);

  // summary and checklist
  await page.goto('/invoicing/settings');
  await expect(page.getByRole('heading', { name: 'Configuración fiscal', level: 1 })).toBeVisible();
  await expect(page.getByTestId('fiscal-kpis')).toBeVisible();
  for (const key of ['SIGNATURE', 'CREDENTIALS', 'CONNECTION', 'POINTS_OF_SALE', 'CATALOGS', 'ACTIVITY', 'HOMOLOGATION']) {
    await expect(page.getByTestId(`section-${key}`)).toBeVisible();
  }

  // catalogues
  await page.getByTestId('section-CATALOGS').click();
  await expect(page.getByRole('heading', { name: 'Actividades y leyendas', level: 1 })).toBeVisible();
  await page.getByTestId('catalogs-sync').click();
  await expect(page.getByTestId('catalogs-note')).toContainText('Sincronizado el');
  await page.getByTestId('catalog-LEGEND').click();
  await expect(page.getByTestId('catalog-entries')).toContainText('Ley N° 453');

  // a new point of sale, registered in the (simulated) SIAT
  createdPointName = `Caja E2E ${Date.now().toString().slice(-6)}`;
  await page.goto('/invoicing/settings/points-of-sale');
  await expect(page.getByRole('heading', { name: 'Puntos de venta SIAT', level: 1 })).toBeVisible();
  await page.getByTestId('pos-new').click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo punto de venta' });
  await dialog.locator('#pos-name').fill(createdPointName);
  // the branch comes first: the warehouses on offer are the ones of that branch
  const pickFirst = async (selector: string) => {
    await dialog.locator(selector).click();
    await page.getByRole('listbox').getByRole('option').first().click();
  };
  await pickFirst('#pos-branch');
  await pickFirst('#pos-type');
  await pickFirst('#pos-warehouse');
  await dialog.getByTestId('pos-save').click();
  await expect(page.locator('rs-doc-table tbody tr').filter({ hasText: createdPointName })).toContainText('Activo');
  const point = await prisma.siatPointOfSale.findFirstOrThrow({ where: { companyId, name: createdPointName }, include: { cashRegister: true } });
  expect(point.cuis).toMatch(/^SIMCUIS-/);
  expect(point.cashRegister).not.toBeNull();

  // homologate a pending product by Excel import
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Homologación');
  sheet.addRow(['SKU', 'CODIGO_SIN', 'UNIDAD']);
  sheet.addRow([sku, '84821', '58']);
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await page.goto('/invoicing/settings/homologation');
  await expect(page.getByRole('heading', { name: 'Homologación de productos', level: 1 })).toBeVisible();
  await page.getByTestId('homologation-import').click();
  const importDialog = page.getByRole('dialog', { name: 'Importar códigos SIN desde Excel' });
  await importDialog.locator('input[type="file"]').setInputFiles({ name: 'homologacion.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await expect(importDialog.getByTestId('import-ok')).toContainText('1 fila lista');
  await importDialog.getByTestId('import-apply').click();
  await expect.poll(async () => (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).sinProductCode).toBe('84821');
  expect(await prisma.product.findUniqueOrThrow({ where: { id: productId } })).toMatchObject({ sinActivityCode: '465900', sinUnitCode: 58 });
});

test('"Pasar a producción" says what is missing and stays disabled until everything is ready', async ({ page }) => {
  await login(page);
  const before = await prisma.siatSettings.findUnique({ where: { companyId }, select: { environment: true } });
  test.skip(before?.environment === 'PRODUCTION', 'The company is already in production');
  await page.goto('/invoicing/settings');
  const summary = await prisma.siatSettings.findUnique({ where: { companyId }, select: { signatureP12Encrypted: true, tokenEncrypted: true } });
  const ready = Boolean(summary?.signatureP12Encrypted && summary.tokenEncrypted) && process.env['SIAT_ALLOW_SIMULATOR'] === 'true';
  if (!ready) {
    // the button stays disabled and the note under the table says what is missing
    await expect(page.getByTestId('production-open')).toBeDisabled();
    await expect(page.getByTestId('test-note')).toContainText('No se puede pasar a producción todavía');
    return;
  }
  await page.getByTestId('production-open').click();
  const dialog = page.getByRole('dialog', { name: 'Pasar a producción' });
  await expect(dialog.getByTestId('production-confirm')).toBeDisabled();
  await dialog.locator('#production-word').fill('PRODUCCIÓN');
  await dialog.getByTestId('production-confirm').click();
  await expect(page.getByTestId('production-note')).toBeVisible();
  // there is no way back from the ERP: the test puts the demo company back in the test environment
  await prisma.siatSettings.update({ where: { companyId }, data: { environment: 'TEST', productionEnabledAt: null, productionEnabledById: null } });
});
