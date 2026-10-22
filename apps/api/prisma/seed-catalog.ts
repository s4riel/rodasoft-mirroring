/**
 * Demo product catalog (decisions #38 and #52 use their default values: sample categories, brand
 * name as text, no logos). Idempotent. Display names (categories, products) are Spanish content.
 */
import type { PrismaClient } from '@prisma/client';

const COUNTRIES = [
  { code: 'SE', name: 'Suecia' },
  { code: 'JP', name: 'Japón' },
  { code: 'DE', name: 'Alemania' },
  { code: 'ES', name: 'España' },
  { code: 'US', name: 'Estados Unidos' },
];

// Flags per brand (DEMO), see docs/backlog/decisions.md
const BRANDS = [
  { name: 'SKF', country: 'SE' },
  { name: 'NSK', country: 'JP' },
  { name: 'FAG', country: 'DE' },
  { name: 'INA', country: 'DE' },
  { name: 'NTN', country: 'JP' },
  { name: 'Fersa', country: 'ES' },
  { name: 'Gates', country: 'US' },
];

const CATEGORIES: { name: string; icon: string; children: string[] }[] = [
  { name: 'Rodamientos', icon: 'circle', children: ['Rígidos de bolas', 'Rodillos cilíndricos', 'Rodillos cónicos', 'Esféricos de rodillos'] },
  { name: 'Retenes y sellos', icon: 'circle', children: [] },
  { name: 'Correas y poleas', icon: 'circle', children: ['Correas en V', 'Correas dentadas'] },
  { name: 'Cadenas y piñones', icon: 'circle', children: [] },
  { name: 'Lubricantes y grasas', icon: 'circle', children: [] },
  { name: 'Herramientas', icon: 'circle', children: [] },
  { name: 'Accesorios', icon: 'circle', children: [] },
  { name: 'Acoples', icon: 'circle', children: [] },
];

/** Bearings: code, subcategory, d, D, B (mm) */
const BEARINGS: [string, string, number, number, number][] = [
  ['6203-2RS', 'Rígidos de bolas', 17, 40, 12],
  ['6204-2RS', 'Rígidos de bolas', 20, 47, 14],
  ['6205-2RS', 'Rígidos de bolas', 25, 52, 15],
  ['6206-2RS', 'Rígidos de bolas', 30, 62, 16],
  ['6207-2RS', 'Rígidos de bolas', 35, 72, 17],
  ['6208-2RS', 'Rígidos de bolas', 40, 80, 18],
  ['6305-2RS', 'Rígidos de bolas', 25, 62, 17],
  ['6306-2RS', 'Rígidos de bolas', 30, 72, 19],
  ['NU206', 'Rodillos cilíndricos', 30, 62, 16],
  ['NU208', 'Rodillos cilíndricos', 40, 80, 18],
  ['NU210', 'Rodillos cilíndricos', 50, 90, 20],
  ['30205', 'Rodillos cónicos', 25, 52, 16.25],
  ['30206', 'Rodillos cónicos', 30, 62, 17.25],
  ['32008', 'Rodillos cónicos', 40, 68, 19],
  ['32010', 'Rodillos cónicos', 50, 80, 24],
  ['22210', 'Esféricos de rodillos', 50, 90, 23],
  ['22212', 'Esféricos de rodillos', 60, 110, 28],
  ['22215', 'Esféricos de rodillos', 75, 130, 31],
];

const OTHERS: [string, string, string][] = [
  ['Retenes y sellos', 'RET-3052', 'Retén 30x52x7'],
  ['Retenes y sellos', 'RET-4072', 'Retén 40x72x10'],
  ['Correas y poleas', 'A-45', 'Correa en V A45'],
  ['Correas y poleas', 'B-60', 'Correa en V B60'],
  ['Correas y poleas', 'POLEA-2A', 'Polea doble canal A'],
  ['Cadenas y piñones', 'CAD-80', 'Cadena de rodillos #80'],
  ['Cadenas y piñones', 'PIN-80-15', 'Piñón #80 15 dientes'],
  ['Lubricantes y grasas', 'GR-LGMT2', 'Grasa de uso general 400 g'],
  ['Lubricantes y grasas', 'GR-LGHP2', 'Grasa alta temperatura 400 g'],
  ['Herramientas', 'EXT-RODAM', 'Extractor de rodamientos'],
  ['Herramientas', 'KIT-INST', 'Kit de instalación de rodamientos'],
  ['Accesorios', 'MANG-6205', 'Manguito de fijación'],
  ['Accesorios', 'TAPA-6205', 'Tapa de rodamiento'],
  ['Acoples', 'ACO-L095', 'Acople elástico L095'],
];

const pad = (n: number) => `RL-${String(n).padStart(6, '0')}`;

export async function seedCatalog(prisma: PrismaClient, companyId: string, bulk = 0) {
  const countryId = new Map<string, string>();
  for (const c of COUNTRIES) {
    const row = await prisma.country.upsert({
      where: { companyId_code: { companyId, code: c.code } },
      update: { name: c.name },
      create: { companyId, ...c },
    });
    countryId.set(c.code, row.id);
  }

  const brandId = new Map<string, string>();
  for (const b of BRANDS) {
    const row = await prisma.brand.upsert({
      where: { companyId_name: { companyId, name: b.name } },
      update: { countryId: countryId.get(b.country) },
      create: { companyId, name: b.name, countryId: countryId.get(b.country) },
    });
    brandId.set(b.name, row.id);
  }

  // The (companyId, parentId, name) unique key has a nullable part, so roots use find-or-create.
  const categoryId = new Map<string, string>();
  const ensureCategory = async (name: string, parentId: string | null, sortOrder: number, icon = 'circle') => {
    const existing = await prisma.category.findFirst({ where: { companyId, parentId, name } });
    const row =
      existing ?? (await prisma.category.create({ data: { companyId, parentId, name, icon, sortOrder } }));
    categoryId.set(name, row.id);
    return row.id;
  };
  for (const [i, c] of CATEGORIES.entries()) {
    const rootId = await ensureCategory(c.name, null, i, c.icon);
    for (const [j, child] of c.children.entries()) await ensureCategory(child, rootId, j);
  }

  const warehouses = await prisma.warehouse.findMany({ where: { companyId }, select: { id: true } });
  const brandNames = BRANDS.map((b) => b.name);
  const rows: { code: string; category: string; name: string; dims?: [number, number, number] }[] = [
    ...BEARINGS.map(([code, category, d, D, B]) => ({
      code,
      category,
      name: `Rodamiento ${code}`,
      dims: [d, D, B] as [number, number, number],
    })),
    ...OTHERS.map(([category, code, name]) => ({ code, category, name })),
  ];

  let n = 0;
  const upsertProduct = async (r: (typeof rows)[number], brand: string) => {
    n += 1;
    const sku = pad(n);
    const price = (20 + ((n * 37) % 480)).toFixed(2);
    const product = await prisma.product.upsert({
      where: { companyId_brandId_manufacturerCode: { companyId, brandId: brandId.get(brand)!, manufacturerCode: r.code } },
      update: {},
      create: {
        companyId,
        sku,
        manufacturerCode: r.code,
        brandId: brandId.get(brand)!,
        categoryId: categoryId.get(r.category)!,
        name: r.name,
        salePrice: price,
        cost: (Number(price) * 0.6).toFixed(4),
        status: n % 13 === 0 ? 'INACTIVE' : 'ACTIVE',
      },
    });
    if (r.dims) {
      const [d, D, B] = r.dims;
      await prisma.productDimension.upsert({
        where: { productId: product.id },
        update: {},
        create: { productId: product.id, companyId, innerDiameter: d, outerDiameter: D, width: B },
      });
    }
    for (const [i, w] of warehouses.entries()) {
      await prisma.stockLevel.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: w.id } },
        update: {},
        create: { companyId, productId: product.id, warehouseId: w.id, quantity: (n * 7 + i * 5) % 40 },
      });
    }
  };

  for (const [i, r] of rows.entries()) await upsertProduct(r, brandNames[i % brandNames.length]);

  // Performance fixture: SEED_BULK_PRODUCTS=5000 pnpm db:seed
  if (bulk > 0) {
    const bearingsId = categoryId.get('Rígidos de bolas')!;
    const data = Array.from({ length: bulk }, (_, i) => ({
      companyId,
      sku: `BULK-${String(i + 1).padStart(6, '0')}`,
      manufacturerCode: `BULK-${i + 1}`,
      brandId: brandId.get(brandNames[i % brandNames.length])!,
      categoryId: bearingsId,
      name: `Rodamiento de prueba ${i + 1}`,
      salePrice: (10 + (i % 300)).toFixed(2),
    }));
    await prisma.product.createMany({ data, skipDuplicates: true });
  }
}
