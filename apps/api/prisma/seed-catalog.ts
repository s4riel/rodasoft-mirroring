/**
 * Demo product catalog (decisions #38 and #52 use their default values: sample categories, brand
 * name as text, no logos). Idempotent. Display names (categories, products) are Spanish content.
 */
import type { PrismaClient } from '@prisma/client';
import { normalizePair } from '@rodasoft/domain';

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
  // `icon` is a name from the ERP icon set (libs/ui icons.ts)
  { name: 'Rodamientos', icon: 'bearing', children: ['Rígidos de bolas', 'Rodillos cilíndricos', 'Rodillos cónicos', 'Esféricos de rodillos'] },
  { name: 'Retenes y sellos', icon: 'seal', children: [] },
  { name: 'Correas y poleas', icon: 'pulley', children: ['Correas en V', 'Correas dentadas'] },
  { name: 'Cadenas y piñones', icon: 'link', children: [] },
  { name: 'Lubricantes y grasas', icon: 'droplet', children: [] },
  { name: 'Herramientas', icon: 'wrench', children: [] },
  { name: 'Accesorios', icon: 'package', children: [] },
  { name: 'Acoples', icon: 'transfer', children: [] },
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

/** Units other than the default `UN` (piece) for the demo products that are not sold by the piece. */
const UNIT_OF: Record<string, string> = { 'CAD-80': 'M', 'KIT-INST': 'JGO' };

/**
 * Equivalents of the 6205-2RS (25 × 52 × 15, same type): code, brand and the specifications that differ from the
 * original. The load capacities are pinned so a link is EXACT unless a seal or cage differs (HU-INV-04).
 */
const EQUIVALENT_BASE = { dynamicLoad: 17.8, staticLoad: 10.8 };
const EQUIVALENTS_OF_6205: { code: string; brand: string; attrs: Record<string, unknown> }[] = [
  { code: '6205-2RSR', brand: 'NTN', attrs: {} },
  { code: '6205-DDU', brand: 'NSK', attrs: { seal: 'DDU (goma, sin contacto)' } },
  { code: '6205-2Z', brand: 'SKF', attrs: { seal: '2Z (metálico)', cage: 'Poliamida' } },
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

type AttributeSeed = {
  key: string;
  label: string;
  type: 'TEXT' | 'NUMBER' | 'ENUM' | 'BOOLEAN';
  /** 2 = Dimensions, 3 = Technical specifications (design-notes, product creation steps). */
  step: 2 | 3;
  unit?: string;
  options?: string[];
  required?: boolean;
};

/**
 * Seal fields (IN-03d, "Especificaciones"). All are step 3: the domain treats any step-2 definition as a bearing.
 * IN-03d shows material and lip type as text fields and only the spring as a list; the lists are samples until the client
 * confirms them (decision #52).
 */
const SEAL_ATTRIBUTES: AttributeSeed[] = [
  { key: 'innerDiameter', label: 'Ø Interior d', type: 'NUMBER', step: 3, unit: 'mm', required: true },
  { key: 'outerDiameter', label: 'Ø Exterior D', type: 'NUMBER', step: 3, unit: 'mm', required: true },
  { key: 'width', label: 'Ancho B', type: 'NUMBER', step: 3, unit: 'mm', required: true },
  { key: 'material', label: 'Material', type: 'TEXT', step: 3, required: true },
  { key: 'lipType', label: 'Tipo de labio', type: 'TEXT', step: 3 },
  { key: 'maxTemperature', label: 'Temperatura máxima', type: 'NUMBER', step: 3, unit: '°C' },
  { key: 'spring', label: 'Con resorte', type: 'ENUM', step: 3, options: ['Sí', 'No'] },
];

/**
 * Generic technical fields for every category that has none of its own (belts, chains, lubricants, tools, accessories and
 * couplings): the step looks the same everywhere and the real list per category comes with decision #52.
 */
const GENERIC_ATTRIBUTES: AttributeSeed[] = [
  { key: 'material', label: 'Material', type: 'TEXT', step: 3, required: true },
  { key: 'mainMeasure', label: 'Medida principal', type: 'TEXT', step: 3, required: true },
  { key: 'model', label: 'Tipo o modelo', type: 'TEXT', step: 3 },
  { key: 'capacity', label: 'Capacidad o presentación', type: 'TEXT', step: 3 },
  { key: 'technicalNotes', label: 'Observaciones técnicas', type: 'TEXT', step: 3 },
];

/** Bearing fields (design-notes §Product creation), in sheet order: step 2 feeds "Dimensiones", step 3 "Especificaciones técnicas". */
const BEARING_ATTRIBUTES: AttributeSeed[] = [
  { key: 'series', label: 'Serie de dimensiones', type: 'TEXT', step: 2 },
  { key: 'minRadius', label: 'Radio mínimo r', type: 'NUMBER', step: 2, unit: 'mm' },
  { key: 'boreType', label: 'Tipo de agujero', type: 'ENUM', step: 2, options: ['Cilíndrico', 'Cónico'] },
  { key: 'seal', label: 'Protección / sello', type: 'ENUM', step: 3, options: ['Abierto', '2RS (goma, contacto)', '2Z (metálico)'] },
  { key: 'internalClearance', label: 'Juego radial interno', type: 'ENUM', step: 3, options: ['C2', 'CN (normal)', 'C3', 'C4'] },
  { key: 'rows', label: 'Número de hileras', type: 'NUMBER', step: 3 },
  { key: 'material', label: 'Material de anillos y bolas', type: 'TEXT', step: 3 },
  { key: 'cage', label: 'Material de la jaula', type: 'ENUM', step: 3, options: ['Acero estampado', 'Poliamida', 'Latón'] },
  { key: 'toleranceClass', label: 'Clase de tolerancia', type: 'ENUM', step: 3, options: ['P0 · ABEC 1', 'P6 · ABEC 3', 'P5 · ABEC 5'] },
  { key: 'dynamicLoad', label: 'Carga dinámica C', type: 'NUMBER', step: 3, unit: 'kN' },
  { key: 'staticLoad', label: 'Carga estática C₀', type: 'NUMBER', step: 3, unit: 'kN' },
  { key: 'limitingSpeed', label: 'Velocidad límite', type: 'NUMBER', step: 3, unit: 'rpm' },
  { key: 'temperature', label: 'Temperatura de trabajo', type: 'TEXT', step: 3, unit: '°C' },
  { key: 'lubricant', label: 'Lubricante', type: 'TEXT', step: 3 },
];

const pad = (n: number) => `RL-${String(n).padStart(6, '0')}`;

/**
 * Demo catalog loader. It runs outside the application (no request, no transaction per movement), so it writes the demo
 * stock levels and their history rows directly instead of going through `StockMovementService`. It only inserts fixture
 * data into a development database; application code must never write stock this way.
 */
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
  const ensureCategory = async (name: string, parentId: string | null, sortOrder: number, icon = 'package') => {
    const existing = await prisma.category.findFirst({ where: { companyId, parentId, name } });
    const row = existing
      ? existing.icon === icon || parentId
        ? existing
        : await prisma.category.update({ where: { id: existing.id }, data: { icon } })
      : await prisma.category.create({ data: { companyId, parentId, name, icon, sortOrder } });
    categoryId.set(name, row.id);
    return row.id;
  };
  for (const [i, c] of CATEGORIES.entries()) {
    const rootId = await ensureCategory(c.name, null, i, c.icon);
    for (const [j, child] of c.children.entries()) await ensureCategory(child, rootId, j);
  }

  const bearingsRootId = categoryId.get('Rodamientos')!;
  for (const [sortOrder, a] of BEARING_ATTRIBUTES.entries()) {
    const data = { label: a.label, type: a.type, unit: a.unit ?? null, options: a.options ?? undefined, step: a.step, sortOrder, required: a.required ?? false };
    await prisma.attributeDefinition.upsert({
      where: { categoryId_key: { categoryId: bearingsRootId, key: a.key } },
      update: data,
      create: { companyId, categoryId: bearingsRootId, key: a.key, ...data },
    });
  }

  const specific = new Set(['Rodamientos', 'Retenes y sellos']);
  for (const category of CATEGORIES.filter((c) => !specific.has(c.name))) {
    const rootId = categoryId.get(category.name)!;
    for (const [sortOrder, a] of GENERIC_ATTRIBUTES.entries()) {
      const data = { label: a.label, type: a.type, unit: a.unit ?? null, options: a.options ?? undefined, step: a.step, sortOrder, required: a.required ?? false };
      await prisma.attributeDefinition.upsert({
        where: { categoryId_key: { categoryId: rootId, key: a.key } },
        update: data,
        create: { companyId, categoryId: rootId, key: a.key, ...data },
      });
    }
  }

  const sealsRootId = categoryId.get('Retenes y sellos')!;
  for (const [sortOrder, a] of SEAL_ATTRIBUTES.entries()) {
    const data = { label: a.label, type: a.type, unit: a.unit ?? null, options: a.options ?? undefined, step: a.step, sortOrder, required: a.required ?? false };
    await prisma.attributeDefinition.upsert({
      where: { categoryId_key: { categoryId: sealsRootId, key: a.key } },
      update: data,
      create: { companyId, categoryId: sealsRootId, key: a.key, ...data },
    });
  }

  const warehouses = await prisma.warehouse.findMany({
    where: { companyId },
    orderBy: [{ isMain: 'desc' }, { code: 'asc' }],
    select: { id: true, branchId: true },
  });
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
  const countryOfBrand = new Map(BRANDS.map((b) => [b.name, countryId.get(b.country)!]));
  const upsertProduct = async (
    r: (typeof rows)[number],
    brand: string,
    opts: { sku?: string; attrs?: Record<string, unknown> } = {},
  ) => {
    n += 1;
    const sku = opts.sku ?? pad(n);
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
        countryId: countryOfBrand.get(brand),
        name: r.name,
        salePrice: price,
        cost: (Number(price) * 0.6).toFixed(4),
        status: n % 13 === 0 ? 'INACTIVE' : 'ACTIVE',
      },
    });
    const unit = UNIT_OF[r.code];
    if (unit && product.unit !== unit) await prisma.product.update({ where: { id: product.id }, data: { unit } });
    if (r.dims) {
      // demo technical specifications for the sheet (IN-02a)
      await prisma.product.update({
        where: { id: product.id },
        data: {
          attributes: {
            series: r.code.slice(0, 2),
            minRadius: 1,
            boreType: 'Cilíndrico',
            seal: r.code.includes('2RS') ? '2RS (goma, contacto)' : 'Abierto',
            internalClearance: 'CN (normal)',
            rows: 1,
            material: 'Acero cromo (52100)',
            cage: 'Acero estampado',
            toleranceClass: 'P0 · ABEC 1',
            dynamicLoad: 14 + (n % 20) + 0.8,
            staticLoad: 7 + (n % 10) + 0.8,
            limitingSpeed: 13000 - (n % 8) * 500,
            temperature: '-30 a 110',
            lubricant: 'Grasa de litio',
            tariffCode: '8482.10.00',
            supplierName: 'Proveedor DEMO',
            sectors: 'Minería, Industria',
            ...(r.code === '6205-2RS' ? EQUIVALENT_BASE : {}),
            ...(opts.attrs ?? {}),
          },
        },
      });
      const [d, D, B] = r.dims;
      await prisma.productDimension.upsert({
        where: { productId: product.id },
        update: {},
        create: { productId: product.id, companyId, innerDiameter: d, outerDiameter: D, width: B },
      });
    }
    for (const [i, w] of warehouses.entries()) {
      // thresholds per warehouse (IN-23): the main warehouse has the shelf of the sample, the others a smaller one
      const threshold = i === 0 ? { minStock: 6, maxStock: 60, location: 'A-03-2' } : { minStock: 2, maxStock: 6, location: 'V-01-1' };
      await prisma.stockThreshold.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: w.id } },
        update: {},
        create: { companyId, productId: product.id, warehouseId: w.id, ...threshold },
      });
      const quantity = (n * 7 + i * 5) % 40;
      const level = await prisma.stockLevel.upsert({
        where: { productId_warehouseId: { productId: product.id, warehouseId: w.id } },
        update: {},
        create: { companyId, productId: product.id, warehouseId: w.id, quantity },
      });
      await seedMovementHistory(product.id, w.id, level.quantity, n + i);
    }
  };

  /**
   * A short history whose last balance equals the seeded level: initial stock, a purchase, a sale and a
   * shrinkage adjustment. Written directly because this is a fixture; runtime writes go through StockMovementService.
   */
  const seedMovementHistory = async (productId: string, warehouseId: string, endBalance: number, seq: number) => {
    if (await prisma.stockMovement.count({ where: { productId, warehouseId } })) return;
    const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const steps: { type: 'INITIAL' | 'PURCHASE_RECEIPT' | 'SALE' | 'ADJUSTMENT_OUT'; quantity: number; days: number; refType?: string; refNumber?: string; reason?: string }[] = [
      { type: 'INITIAL', quantity: endBalance + 2, days: 60 },
      { type: 'PURCHASE_RECEIPT', quantity: 8, days: 15, refType: 'PURCHASE', refNumber: `OC-${String(80 + seq).padStart(4, '0')}` },
      { type: 'SALE', quantity: -5, days: 10, refType: 'SALE', refNumber: `V-${String(230 + seq).padStart(5, '0')}` },
      { type: 'ADJUSTMENT_OUT', quantity: -5, days: 3, refType: 'ADJUSTMENT', refNumber: `AJ-${String(12 + seq).padStart(4, '0')}`, reason: 'Merma' },
    ];
    let balance = 0;
    for (const s of steps) {
      balance += s.quantity;
      await prisma.stockMovement.create({
        data: {
          companyId,
          productId,
          warehouseId,
          type: s.type,
          quantity: s.quantity,
          balanceAfter: balance,
          reason: s.reason ?? null,
          refType: s.refType ?? null,
          refNumber: s.refNumber ?? null,
          createdAt: daysAgo(s.days),
        },
      });
    }
  };

  for (const [i, r] of rows.entries()) await upsertProduct(r, brandNames[i % brandNames.length]);

  // Equivalents of the 6205-2RS from other brands, linked as direct pairs. New SKUs continue after the highest one.
  const original = await prisma.product.findFirst({ where: { companyId, manufacturerCode: '6205-2RS' }, select: { id: true } });
  if (original) {
    for (const eq of EQUIVALENTS_OF_6205) {
      const row = { code: eq.code, category: 'Rígidos de bolas', name: `Rodamiento ${eq.code}`, dims: [25, 52, 15] as [number, number, number] };
      const existing = await prisma.product.findFirst({ where: { companyId, brandId: brandId.get(eq.brand)!, manufacturerCode: eq.code } });
      let sku = existing?.sku;
      if (!sku) {
        const last = await prisma.product.findFirst({ where: { companyId, sku: { startsWith: 'RL-' } }, orderBy: { sku: 'desc' }, select: { sku: true } });
        sku = pad(Number(last?.sku.slice(3) ?? 0) + 1);
      }
      await upsertProduct(row, eq.brand, { sku, attrs: { ...EQUIVALENT_BASE, ...eq.attrs } });
      const other = await prisma.product.findFirstOrThrow({ where: { companyId, brandId: brandId.get(eq.brand)!, manufacturerCode: eq.code }, select: { id: true } });
      const [productAId, productBId] = normalizePair(original.id, other.id);
      await prisma.equivalence.upsert({
        where: { companyId_productAId_productBId: { companyId, productAId, productBId } },
        update: {},
        create: { companyId, productAId, productBId },
      });
    }
  }

  // Performance fixture: SEED_BULK_PRODUCTS=5000 pnpm db:seed
  if (bulk > 0) {
    const bearingsId = categoryId.get('Rígidos de bolas')!;
    const data = Array.from({ length: bulk }, (_, i) => ({
      companyId,
      sku: `BULK-${String(i + 1).padStart(6, '0')}`,
      manufacturerCode: `BULK-${i + 1}`,
      brandId: brandId.get(brandNames[i % brandNames.length])!,
      categoryId: bearingsId,
      countryId: countryId.get(BRANDS[i % brandNames.length].country),
      name: `Rodamiento de prueba ${i + 1}`,
      salePrice: (10 + (i % 300)).toFixed(2),
    }));
    await prisma.product.createMany({ data, skipDuplicates: true });
  }
}
