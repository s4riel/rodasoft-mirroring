/**
 * Seed data: 2 companies, branches and warehouses, permission catalog, roles and an administrator.
 * Idempotent: can be run several times (upsert).
 *
 *   pnpm db:seed
 *
 * Optional variables: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD.
 * The 2nd company's data is provisional until Phase 0. Names (branches, warehouses) are display data in Spanish.
 */
import { PrismaClient, BrandMode } from '@prisma/client';
import { hash } from 'argon2';
import { COMPANY_SETTING_DEFAULTS, DEFAULT_ROLES, PERMISSIONS, type Permission } from '@rodasoft/domain';

import { seedCatalog } from './seed-catalog';

const prisma = new PrismaClient();

const COMPANIES = [
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

const prefix = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 3);

async function main() {
  // 1. Permission catalog (source: libs/domain)
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: { description, module: key.split('.')[0] },
      create: { key, description, module: key.split('.')[0] },
    });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@rodalaser.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Rodalaser.2026';
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, name: 'Administrador', passwordHash: await hash(adminPassword) },
  });

  for (const c of COMPANIES) {
    const company = await prisma.company.upsert({
      where: { slug: c.slug },
      update: { legalName: c.legalName, tradeName: c.tradeName, brand: c.brand },
      create: {
        slug: c.slug,
        legalName: c.legalName,
        tradeName: c.tradeName,
        nit: c.nit,
        brand: c.brand,
        siatSettings: { create: {} },
      },
    });

    // 2. Branches, warehouses and SIAT points of sale (code 0 per branch)
    for (const b of c.branches) {
      const branch = await prisma.branch.upsert({
        where: { companyId_code: { companyId: company.id, code: b.code } },
        update: { name: b.name },
        create: { companyId: company.id, code: b.code, name: b.name },
      });
      for (const [i, name] of b.warehouses.entries()) {
        const code = `${prefix(b.name)}-${String(i + 1).padStart(2, '0')}`;
        await prisma.warehouse.upsert({
          where: { companyId_code: { companyId: company.id, code } },
          update: { name },
          create: { companyId: company.id, branchId: branch.id, code, name, isMain: i === 0 },
        });
      }
      await prisma.siatPointOfSale.upsert({
        where: { companyId_branchId_code: { companyId: company.id, branchId: branch.id, code: 0 } },
        update: {},
        create: { companyId: company.id, branchId: branch.id, code: 0, name: `Caja 1 · ${b.name}` },
      });
    }

    // 3. Roles per company with their permissions
    for (const [key, def] of Object.entries(DEFAULT_ROLES)) {
      const role = await prisma.role.upsert({
        where: { companyId_key: { companyId: company.id, key } },
        update: { name: def.name },
        create: { companyId: company.id, key, name: def.name, isSystem: true },
      });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({
        data: def.permissions.map((p: Permission) => ({ roleId: role.id, permissionKey: p })),
        skipDuplicates: true,
      });
    }

    // 4. Company settings with their defaults (HU-INV-06). Thresholds without a value are not stored: the code reads the default.
    for (const key of ['inventory.skuPrefix', 'inventory.allowNegativeStock', 'inventory.import.maxRows', 'inventory.import.createMissingBrands'] as const) {
      await prisma.companySetting.upsert({
        where: { companyId_key: { companyId: company.id, key } },
        update: {},
        create: { companyId: company.id, key, value: COMPANY_SETTING_DEFAULTS[key] },
      });
    }

    // 5. Demo product catalog (Rodalaser only)
    if (c.slug === 'rodalaser') await seedCatalog(prisma, company.id, Number(process.env.SEED_BULK_PRODUCTS ?? 0));

    // 6. Administrator with access to every branch
    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { companyId_key: { companyId: company.id, key: 'admin' } },
    });
    await prisma.membership.upsert({
      where: { companyId_userId: { companyId: company.id, userId: admin.id } },
      update: { roleId: adminRole.id, allBranches: true },
      create: { companyId: company.id, userId: admin.id, roleId: adminRole.id, allBranches: true },
    });
  }

  console.log(`Seed done. Administrator: ${adminEmail} / ${process.env.SEED_ADMIN_PASSWORD ? '(SEED_ADMIN_PASSWORD)' : adminPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
