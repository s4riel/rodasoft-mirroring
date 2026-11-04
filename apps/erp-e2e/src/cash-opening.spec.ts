import { PrismaClient } from '@prisma/client';
import { expect, test } from '@playwright/test';
import { login } from './support/auth';

/**
 * HU-VEN-01 · open the cash register. Needs the demo data from `pnpm db:seed` (a register per branch and the
 * administrator). A shift cannot be closed from the app yet (HU-VEN-23), so the test closes the administrator's open
 * shifts straight in the database before and after the run: it starts from "no open shift" every time.
 */

const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const BRANCH = 'Huayna Kapac';

const prisma = new PrismaClient();

async function closeAdminShifts() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (!user) return;
  await prisma.cashShift.updateMany({ where: { openedById: user.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } });
}

test.beforeAll(closeAdminShifts);
test.afterAll(async () => {
  await closeAdminShifts();
  await prisma.$disconnect();
});

test('the cashier finds the POS closed, opens the register with the float and sells from a POS without the modal', async ({ page }) => {
  await login(page);

  // without an open shift the POS shows "Caja cerrada" and is blocked behind the modal
  await page.goto('/sales/pos');
  const dialog = page.getByRole('dialog', { name: 'Caja cerrada' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Salir del POS' })).toBeVisible();

  // the modal cannot be dismissed with Escape
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page).toHaveURL(/\/sales\/cash-register\/open$/);
  await expect(page.getByRole('heading', { name: 'Apertura de caja', level: 1 })).toBeVisible();
  await expect(page.getByText('Fondo de caja: PENDIENTE del cliente.')).toBeVisible();

  // an empty float is refused before anything is sent
  await page.locator('#cash-register').click();
  await page.locator('li[role="option"]').filter({ hasText: BRANCH }).first().click();
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByText('Ingresa el efectivo inicial.')).toBeVisible();

  await page.locator('#cash-float').fill('500,00');
  await page.getByRole('button', { name: 'Abrir caja' }).click();

  // success: toast, and the POS has no modal any more
  await expect(page).toHaveURL(/\/sales\/pos$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Turno abierto')).toBeVisible();

  // the Caja tab now shows the shift instead of the opening form
  await page.goto('/sales/cash-register');
  await expect(page.getByRole('heading', { name: 'Turno abierto' })).toBeVisible();
  await expect(page.getByText('Bs 500,00')).toBeVisible();
});
