/**
 * Shared seed steps for every environment: permission catalog, and per company its branches, warehouses, SIAT
 * points of sale, system roles and default settings. Idempotent (upsert). Used by `seed.ts` (dev) and
 * `seed-staging.ts` (local staging).
 */
import type { BrandMode, Company, PrismaClient, User } from '@prisma/client';
import { COMPANY_SETTING_DEFAULTS, DEFAULT_ROLES, PERMISSIONS, type Permission } from '@rodasoft/domain';

export interface SeedCompany {
  slug: string;
  legalName: string;
  tradeName: string;
  nit: string;
  brand: BrandMode;
  branches: { code: number; name: string; warehouses: string[] }[];
}

const prefix = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 3);

/** Permission catalog (source: libs/domain). */
export async function seedPermissions(prisma: PrismaClient): Promise<void> {
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      update: { description, module: key.split('.')[0] },
      create: { key, description, module: key.split('.')[0] },
    });
  }
}

/** Company with its branches, warehouses, points of sale, roles and default settings. */
export async function seedCompany(prisma: PrismaClient, c: SeedCompany): Promise<Company> {
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

  // Branches, warehouses and SIAT points of sale (code 0 per branch)
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

  // Roles per company with their permissions
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

  // Company settings with their defaults (HU-INV-06). Thresholds without a value are not stored: the code reads the default.
  for (const key of ['inventory.skuPrefix', 'inventory.allowNegativeStock', 'inventory.import.maxRows', 'inventory.import.createMissingBrands'] as const) {
    await prisma.companySetting.upsert({
      where: { companyId_key: { companyId: company.id, key } },
      update: {},
      create: { companyId: company.id, key, value: COMPANY_SETTING_DEFAULTS[key] },
    });
  }

  return company;
}

/** Administrator membership with access to every branch of the company. */
export async function seedAdminMembership(prisma: PrismaClient, company: Company, admin: User): Promise<void> {
  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { companyId_key: { companyId: company.id, key: 'admin' } },
  });
  await prisma.membership.upsert({
    where: { companyId_userId: { companyId: company.id, userId: admin.id } },
    update: { roleId: adminRole.id, allBranches: true },
    create: { companyId: company.id, userId: admin.id, roleId: adminRole.id, allBranches: true },
  });
}
