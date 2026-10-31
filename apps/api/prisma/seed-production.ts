/**
 * Production seed (Railway): the two real companies (Rodalaser and Rodamentin), their branches, warehouses, SIAT points
 * of sale, system roles, default settings, the base reference data (countries, brands, categories and technical fields)
 * and ONE administrator with access to both companies. No products, stock or documents. Idempotent (upsert): it can be
 * re-run; an existing administrator keeps its password.
 *
 * Run it from your PC against the public URL of the Railway database (see docs/deployment.md §3.5):
 *
 *   SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_PASSWORD='a strong password' \
 *   pnpm tsx --tsconfig tsconfig.base.json --env-file=.env.production apps/api/prisma/seed-production.ts
 *
 * Variables:
 *   DATABASE_URL          required; the public URL of the production database (not localhost).
 *   SEED_ADMIN_EMAIL      required.
 *   SEED_ADMIN_PASSWORD   required; at least 12 characters and not the development default.
 *   SEED_RODALASER_NIT, SEED_RODAMENTIN_NIT   optional; real NITs (placeholders otherwise, fix them in the ERP).
 */
import { BrandMode, PrismaClient } from '@prisma/client';
import { hash } from 'argon2';

import { seedAdminMembership, seedCompany, seedPermissions, type SeedCompany } from './seed-base';
import { seedReferenceData } from './seed-reference';

const DEV_DEFAULT_PASSWORD = 'Rodalaser.2026';

function fail(message: string): never {
  console.error(`\nProduction seed aborted: ${message}\n`);
  process.exit(1);
}

/** Validates the connection string and returns the host:port/db to print (never the credentials). */
function checkDatabaseUrl(raw: string | undefined): string {
  if (!raw) fail('DATABASE_URL is not set (check --env-file=.env.production).');
  if (raw.includes('${') || raw.includes('{{')) {
    fail(
      'DATABASE_URL still contains a Railway reference ("${{ ... }}"). Paste the real value of DATABASE_PUBLIC_URL.',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(
      'DATABASE_URL is not a valid URL. If the password has special characters (@ : / # ?) they must be percent-encoded.',
    );
  }
  if (!url.port) fail('DATABASE_URL has no port. Use the public host and port of the Railway TCP proxy.');
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    fail('DATABASE_URL points at localhost. This seed is for the production database on Railway.');
  }
  return `${url.hostname}:${url.port}${url.pathname}`;
}

const nit = (envVar: string, placeholder: string) => process.env[envVar]?.trim() || placeholder;

const COMPANIES: SeedCompany[] = [
  {
    slug: 'rodalaser',
    legalName: 'Rodalaser S.R.L.',
    tradeName: 'Rodalaser',
    nit: nit('SEED_RODALASER_NIT', '0000000001'), // TODO: real NIT
    brand: BrandMode.rodalaser,
    branches: [
      { code: 0, name: 'Huayna Kapac', warehouses: ['Principal', 'Depósito'] },
      { code: 1, name: 'Sacaba', warehouses: ['Principal', 'Depósito'] },
      { code: 2, name: 'Panamericana', warehouses: ['Principal', 'Depósito'] },
      { code: 3, name: 'Central', warehouses: ['Principal', 'Depósito'] },
    ],
  },
  {
    slug: 'rodamentin',
    legalName: 'Rodamentin',
    tradeName: 'Rodamentin',
    nit: nit('SEED_RODAMENTIN_NIT', '0000000002'), // TODO: real NIT
    brand: BrandMode.company2,
    branches: [{ code: 0, name: 'Casa matriz', warehouses: ['Principal'] }],
  },
];

async function main() {
  const target = checkDatabaseUrl(process.env.DATABASE_URL);

  const email = process.env.SEED_ADMIN_EMAIL?.trim();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email) fail('SEED_ADMIN_EMAIL is not set.');
  if (!password) fail('SEED_ADMIN_PASSWORD is not set.');
  if (password.length < 9) fail('SEED_ADMIN_PASSWORD must have at least 8 characters.');
  if (password === DEV_DEFAULT_PASSWORD) fail('SEED_ADMIN_PASSWORD cannot be the development default.');

  console.log(`Seeding production database ${target} ...`);
  const prisma = new PrismaClient();
  try {
    await seedPermissions(prisma);

    const existing = await prisma.user.findUnique({ where: { email } });
    const admin =
      existing ??
      (await prisma.user.create({
        data: { email, name: 'Administrador', passwordHash: await hash(password) },
      }));

    for (const c of COMPANIES) {
      const company = await seedCompany(prisma, c);
      await seedReferenceData(prisma, company.id);
      await seedAdminMembership(prisma, company, admin);
      console.log(`  ✓ ${c.tradeName}`);
    }

    console.log(
      `\nProduction seed done. Administrator: ${email} ${existing ? '(already existed: password unchanged)' : '(password from SEED_ADMIN_PASSWORD)'}`,
    );
    console.log(
      'Next: sign in, change the password, and set the real NITs. Then close the database public access.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
