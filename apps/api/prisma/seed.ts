/**
 * Datos iniciales: 2 empresas, sucursales y almacenes, catálogo de permisos, roles y un administrador.
 * Idempotente: se puede correr varias veces (upsert).
 *
 *   pnpm db:seed
 *
 * Variables opcionales: SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD.
 * Los datos de la 2.ª empresa son provisionales hasta la Fase 0.
 */
import { PrismaClient, BrandMode } from '@prisma/client';
import { hash } from 'argon2';
import { DEFAULT_ROLES, PERMISSIONS, type Permission } from '@rodasoft/domain';

const prisma = new PrismaClient();

const EMPRESAS = [
  {
    slug: 'rodalaser',
    razonSocial: 'Rodalaser S.R.L.',
    nombreComercial: 'Rodalaser',
    nit: '0000000001', // TODO Fase 0: NIT real
    brand: BrandMode.rodalaser,
    sucursales: [
      { codigo: 0, nombre: 'Huayna Kapac', almacenes: ['Principal', 'Depósito'] },
      { codigo: 1, nombre: 'Sacaba', almacenes: ['Principal', 'Depósito'] },
      { codigo: 2, nombre: 'Panamericana', almacenes: ['Principal', 'Depósito'] },
    ],
  },
  {
    slug: 'empresa2',
    razonSocial: 'Empresa 2 (por definir)',
    nombreComercial: 'Empresa 2',
    nit: '0000000002', // TODO Fase 0: nombre, NIT y sucursales de la 2.ª empresa
    brand: BrandMode.empresa2,
    sucursales: [{ codigo: 0, nombre: 'Casa matriz', almacenes: ['Principal'] }],
  },
];

const prefijo = (nombre: string) =>
  nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 3);

async function main() {
  // 1. Catálogo de permisos (fuente: libs/domain)
  for (const [clave, descripcion] of Object.entries(PERMISSIONS)) {
    await prisma.permiso.upsert({
      where: { clave },
      update: { descripcion, modulo: clave.split('.')[0] },
      create: { clave, descripcion, modulo: clave.split('.')[0] },
    });
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@rodalaser.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Rodalaser.2026';
  const admin = await prisma.usuario.upsert({
    where: { email: adminEmail },
    update: {},
    create: { email: adminEmail, nombre: 'Administrador', passwordHash: await hash(adminPassword) },
  });

  for (const e of EMPRESAS) {
    const empresa = await prisma.empresa.upsert({
      where: { slug: e.slug },
      update: { razonSocial: e.razonSocial, nombreComercial: e.nombreComercial, brand: e.brand },
      create: {
        slug: e.slug,
        razonSocial: e.razonSocial,
        nombreComercial: e.nombreComercial,
        nit: e.nit,
        brand: e.brand,
        siatConfig: { create: {} },
      },
    });

    // 2. Sucursales, almacenes y puntos de venta SIAT (0 por sucursal)
    for (const s of e.sucursales) {
      const sucursal = await prisma.sucursal.upsert({
        where: { empresaId_codigo: { empresaId: empresa.id, codigo: s.codigo } },
        update: { nombre: s.nombre },
        create: { empresaId: empresa.id, codigo: s.codigo, nombre: s.nombre },
      });
      for (const [i, nombre] of s.almacenes.entries()) {
        const codigo = `${prefijo(s.nombre)}-${String(i + 1).padStart(2, '0')}`;
        await prisma.almacen.upsert({
          where: { empresaId_codigo: { empresaId: empresa.id, codigo } },
          update: { nombre },
          create: { empresaId: empresa.id, sucursalId: sucursal.id, codigo, nombre, esPrincipal: i === 0 },
        });
      }
      await prisma.puntoVentaSiat.upsert({
        where: { empresaId_sucursalId_codigo: { empresaId: empresa.id, sucursalId: sucursal.id, codigo: 0 } },
        update: {},
        create: { empresaId: empresa.id, sucursalId: sucursal.id, codigo: 0, nombre: `Caja 1 · ${s.nombre}` },
      });
    }

    // 3. Roles por empresa con sus permisos
    for (const [clave, def] of Object.entries(DEFAULT_ROLES)) {
      const rol = await prisma.rol.upsert({
        where: { empresaId_clave: { empresaId: empresa.id, clave } },
        update: { nombre: def.nombre },
        create: { empresaId: empresa.id, clave, nombre: def.nombre, esSistema: true },
      });
      await prisma.rolPermiso.deleteMany({ where: { rolId: rol.id } });
      await prisma.rolPermiso.createMany({
        data: def.permisos.map((p: Permission) => ({ rolId: rol.id, permisoClave: p })),
        skipDuplicates: true,
      });
    }

    // 4. Administrador con acceso a todas las sucursales
    const rolAdmin = await prisma.rol.findUniqueOrThrow({
      where: { empresaId_clave: { empresaId: empresa.id, clave: 'admin' } },
    });
    await prisma.membresia.upsert({
      where: { empresaId_usuarioId: { empresaId: empresa.id, usuarioId: admin.id } },
      update: { rolId: rolAdmin.id, todasSucursales: true },
      create: { empresaId: empresa.id, usuarioId: admin.id, rolId: rolAdmin.id, todasSucursales: true },
    });
  }

  console.log(`✓ Seed listo. Administrador: ${adminEmail} / ${process.env.SEED_ADMIN_PASSWORD ? '(SEED_ADMIN_PASSWORD)' : adminPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
