/**
 * Seed data: 2 companies, branches and warehouses, permission catalog, roles and an administrator.
 * Idempotent: can be run several times (upsert).
 *
 *   pnpm db:seed   (prisma db seed)
 *
 * Optional variables: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD. With SEED_PROFILE=staging (set in .env.staging) it runs
 * the empty local staging seed instead (`seed-staging.ts`).
 * The 2nd company's data is provisional until Phase 0. Names (branches, warehouses) are display data in Spanish.
 */
import { PrismaClient, BrandMode } from '@prisma/client';
import { hash } from 'argon2';

import { seedAdminMembership, seedCompany, seedPermissions, type SeedCompany } from './seed-base';
import { seedCatalog } from './seed-catalog';
import { seedStaging } from './seed-staging';

const prisma = new PrismaClient();

const COMPANIES: SeedCompany[] = [
  {
    slug: 'rodalaser',
    legalName: 'Rodalaser S.R.L.',
    tradeName: 'Rodalaser',
    nit: '0000000001', // TODO Phase 0: real NIT
    brand: BrandMode.rodalaser,
    branches: [
      { code: 0, name: 'Huayna Kapac', warehouses: ['Principal', 'Depósito'] },
      { code: 1, name: 'Sacaba', warehouses: ['Principal', 'Depósito'] },
      { code: 2, name: 'Panamericana', warehouses: ['Principal', 'Depósito'] },
    ],
  },
  {
    slug: 'company2',
    legalName: 'Empresa 2 (por definir)',
    tradeName: 'Empresa 2',
    nit: '0000000002', // TODO Phase 0: name, NIT and branches of the 2nd company
    brand: BrandMode.company2,
    branches: [{ code: 0, name: 'Casa matriz', warehouses: ['Principal'] }],
  },
];

async function main() {
  if (process.env.SEED_PROFILE === 'staging') return seedStaging(prisma);

  await seedPermissions(prisma);

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@rodalaser.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Rodalaser.2026';
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, name: 'Administrador', passwordHash: await hash(adminPassword) },
  });

  for (const c of COMPANIES) {
    const company = await seedCompany(prisma, c);
    // Demo product catalog (Rodalaser only)
    if (c.slug === 'rodalaser') await seedCatalog(prisma, company.id, Number(process.env.SEED_BULK_PRODUCTS ?? 0));
    await seedAdminMembership(prisma, company, admin);
  }

  console.log(`Seed done. Administrator: ${adminEmail} / ${process.env.SEED_ADMIN_PASSWORD ? '(SEED_ADMIN_PASSWORD)' : adminPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
