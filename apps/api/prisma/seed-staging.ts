/**
 * Local staging seed: Rodalaser (main) and Rodamentin, each with its own administrator, and no business data
 * (no products, stock or documents) but with the base reference data of `seed-reference.ts`: countries, categories,
 * subcategories and their technical fields. Idempotent (upsert).
 *
 *   pnpm staging:db:seed   (prisma db seed with SEED_PROFILE=staging, dispatched by seed.ts)
 *
 * Passwords come from STAGING_RODALASER_ADMIN_PASSWORD and STAGING_RODAMENTIN_ADMIN_PASSWORD (.env.staging).
 * When one is missing a random password is generated and printed once; an existing user keeps its password.
 */
import { randomBytes } from 'node:crypto';

import { BrandMode, type PrismaClient } from '@prisma/client';
import { hash } from 'argon2';

import { seedAdminMembership, seedCompany, seedPermissions, type SeedCompany } from './seed-base';
import { seedReferenceData } from './seed-reference';

const COMPANIES: (SeedCompany & { admin: { email: string; name: string; passwordVar: string } })[] = [
  {
    slug: 'rodalaser',
    legalName: 'Rodalaser S.R.L.',
    tradeName: 'Rodalaser',
    nit: '0000000001',
    brand: BrandMode.rodalaser,
    branches: [
      { code: 0, name: 'Huayna Kapac', warehouses: ['Principal', 'Depósito'] },
      { code: 1, name: 'Sacaba', warehouses: ['Principal', 'Depósito'] },
      { code: 2, name: 'Panamericana', warehouses: ['Principal', 'Depósito'] },
    ],
    admin: { email: 'admin@rodalaser.local', name: 'Administrador Rodalaser', passwordVar: 'STAGING_RODALASER_ADMIN_PASSWORD' },
  },
  {
    slug: 'rodamentin',
    legalName: 'Rodamentin',
    tradeName: 'Rodamentin',
    nit: '0000000002',
    brand: BrandMode.company2,
    branches: [{ code: 0, name: 'Casa matriz', warehouses: ['Principal'] }],
    admin: { email: 'admin@rodamentin.local', name: 'Administrador Rodamentin', passwordVar: 'STAGING_RODAMENTIN_ADMIN_PASSWORD' },
  },
];

export async function seedStaging(prisma: PrismaClient): Promise<void> {
  if (!process.env.DATABASE_URL?.includes('staging')) {
    throw new Error('Refusing to run the staging seed: DATABASE_URL does not point at a staging database');
  }
  await seedPermissions(prisma);

  for (const c of COMPANIES) {
    const company = await seedCompany(prisma, c);
    await seedReferenceData(prisma, company.id);

    const existing = await prisma.user.findUnique({ where: { email: c.admin.email } });
    let password = process.env[c.admin.passwordVar];
    const generated = !existing && !password;
    if (generated) password = randomBytes(12).toString('base64url');
    const admin =
      existing ??
      (await prisma.user.create({
        data: { email: c.admin.email, name: c.admin.name, passwordHash: await hash(password as string) },
      }));
    await seedAdminMembership(prisma, company, admin);

    const shown = generated ? password : existing ? '(unchanged)' : `(${c.admin.passwordVar})`;
    console.log(`${c.tradeName}: ${c.admin.email} / ${shown}`);
  }
  console.log('Staging seed done.');
}

