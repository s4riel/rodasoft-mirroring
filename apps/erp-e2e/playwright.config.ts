import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against the real stack: Postgres (docker compose), the API and the ERP dev server.
 * Prerequisites: `pnpm dev:infra`, `pnpm db:migrate` and `pnpm db:seed` (demo catalog and admin user).
 * The company comes from the host name, so the tests run on `rodalaser.localhost`.
 */
const erpUrl = process.env['E2E_ERP_URL'] ?? 'http://rodalaser.localhost:4200';

export default defineConfig({
  testDir: './src',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: erpUrl,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'es-BO',
    timezoneId: 'America/La_Paz',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1080 } } }],
  webServer: [
    {
      command: 'pnpm nx serve api',
      cwd: '../..',
      url: 'http://localhost:3000/api/v1/health',
      reuseExistingServer: true,
      timeout: 240_000,
    },
    {
      command: 'pnpm nx serve erp',
      cwd: '../..',
      // readiness check from Node: `*.localhost` does not resolve outside the browser on Windows
      url: 'http://localhost:4200',
      reuseExistingServer: true,
      timeout: 240_000,
    },
  ],
});
