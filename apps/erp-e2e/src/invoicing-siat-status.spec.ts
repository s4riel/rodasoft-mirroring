import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-FAC-13 · the SIAT system status: every point of sale shows the health of its codes, "Renovar CUFD" gets a new CUFD from the
 * (simulated) SIAT, and "Probar conexión" records the connection. With `invoicing.simulatorMode` OFFLINE the renewal is refused and
 * the old CUFD is kept. The administrator holds `invoicing.settings.manage`. Needs the demo data from `pnpm db:seed`.
 */

const prisma = new PrismaClient();
const MODE_KEY = 'invoicing.simulatorMode';
let companyId = '';

async function resetMode() {
  if (companyId) await prisma.companySetting.deleteMany({ where: { companyId, key: MODE_KEY } });
}

test.beforeAll(async () => {
  companyId = (await prisma.company.findFirstOrThrow({ where: { slug: 'rodalaser' }, select: { id: true } })).id;
  await resetMode();
});

test.afterAll(async () => {
  await resetMode();
  await prisma.$disconnect();
});

test('renews the CUFD of a point of sale and tests the connection; offline refuses the renewal and keeps the old CUFD', async ({ page }) => {
  await login(page);
  const point = await prisma.siatPointOfSale.findFirstOrThrow({ where: { companyId }, orderBy: [{ branch: { code: 'asc' } }, { code: 'asc' }], select: { id: true, code: true } });

  await page.goto('/invoicing/status');
  await expect(page.getByRole('heading', { name: 'Estado del sistema SIAT', level: 1 })).toBeVisible();
  await expect(page.getByTestId('siat-headline')).toBeVisible();
  await expect(page.locator('rs-doc-table tbody tr').first()).toBeVisible();

  // online: the renewal stores a new CUFD that expires in about a day
  const firstRow = page.locator('rs-doc-table tbody tr').first();
  await firstRow.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Renovar CUFD' }).click();
  await expect(page.getByText(`CUFD del punto de venta ${point.code} renovado`)).toBeVisible();
  const renewed = await prisma.siatPointOfSale.findUniqueOrThrow({ where: { id: point.id }, select: { cufd: true, cufdExpiresAt: true } });
  expect(renewed.cufd).toMatch(/^SIMCUFD-/);
  expect((renewed.cufdExpiresAt as Date).getTime()).toBeGreaterThan(Date.now() + 20 * 3_600_000);

  // test the connection: it is recorded as online
  await page.getByTestId('siat-test-connection').click();
  await expect(page.getByText('El SIAT responde: conexión en línea')).toBeVisible();
  await expect(page.getByTestId('siat-headline')).toContainText('SIAT en línea');

  // offline: the connection test says so and the renewal is refused, keeping the CUFD it had
  await prisma.companySetting.upsert({
    where: { companyId_key: { companyId, key: MODE_KEY } },
    create: { companyId, key: MODE_KEY, value: 'OFFLINE' },
    update: { value: 'OFFLINE' },
  });
  await page.getByTestId('siat-test-connection').click();
  await expect(page.getByTestId('siat-headline')).toContainText('Error de conexión con el SIAT');
  await firstRow.getByRole('button').last().click();
  await page.getByRole('menuitem', { name: 'Renovar CUFD' }).click();
  await expect(page.getByText('El SIAT no responde en este momento').first()).toBeVisible();
  expect((await prisma.siatPointOfSale.findUniqueOrThrow({ where: { id: point.id }, select: { cufd: true } })).cufd).toBe(renewed.cufd);
});
