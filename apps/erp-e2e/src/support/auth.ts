import { expect, Page } from '@playwright/test';

/** Seeded administrator (apps/api/prisma/seed.ts); override with the same variables the seed reads. */
const EMAIL = process.env['SEED_ADMIN_EMAIL'] ?? 'admin@rodalaser.local';
const PASSWORD = process.env['SEED_ADMIN_PASSWORD'] ?? 'Rodalaser.2026';

export async function login(page: Page) {
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
