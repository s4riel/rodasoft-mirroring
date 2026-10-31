/**
 * Base reference data of a company: countries of origin, brands, the category tree (roots and subcategories) and the
 * technical field definitions of the categories that have them. No products or stock. Idempotent (find-or-create / upsert),
 * so it can be re-run on any company and never touches what exists beyond the category icon and field definitions.
 * Used by `seed-staging.ts` (every staging company) and `seed-catalog.ts` (dev demo catalog). Display names are Spanish.
 */
import type { PrismaClient } from '@prisma/client';

/** ISO 3166-1 alpha-2 code and the name the ERP shows. */
export const REFERENCE_COUNTRIES: { code: string; name: string }[] = [
  { code: 'AT', name: 'Austria' },
  { code: 'BO', name: 'Bolivia' },
  { code: 'BR', name: 'Brasil' },
  { code: 'CN', name: 'China' },
  { code: 'DE', name: 'Alemania' },
  { code: 'ES', name: 'España' },
  { code: 'FR', name: 'Francia' },
  { code: 'IT', name: 'Italia' },
  { code: 'JP', name: 'Japón' },
  { code: 'KR', name: 'Corea del Sur' },
  { code: 'PL', name: 'Polonia' },
  { code: 'SE', name: 'Suecia' },
  { code: 'TH', name: 'Tailandia' },
  { code: 'UA', name: 'Ucrania' },
  { code: 'US', name: 'Estados Unidos' },
];

/**
 * Brands of the 2026 inventory and the demo catalog, with their country of origin (ISO code) when it is known.
 * A brand without country is created with none; it can be set later in the ERP.
 */
export const REFERENCE_BRANDS: { name: string; country?: string }[] = [
  { name: 'A&S' }, { name: 'ASAHI' }, { name: 'AYS', country: 'ES' }, { name: 'BCA' }, { name: 'C.V.JOINT' }, { name: 'C/S' },
  { name: 'CMB' }, { name: 'EBI' }, { name: 'FAG', country: 'DE' }, { name: 'FKC' }, { name: 'FMOGUL' }, { name: 'FYH' },
  { name: 'Fersa', country: 'ES' }, { name: 'GBM' }, { name: 'GMB', country: 'JP' }, { name: 'GMG' }, { name: 'Gates', country: 'US' },
  { name: 'IBK' }, { name: 'ICH' }, { name: 'IJK' }, { name: 'IKO', country: 'JP' }, { name: 'ILJIN', country: 'KR' },
  { name: 'INA', country: 'DE' }, { name: 'IRB' }, { name: 'ISB', country: 'IT' }, { name: 'JBS' }, { name: 'JIB' },
  { name: 'KBC', country: 'KR' }, { name: 'KML' }, { name: 'KOYO', country: 'JP' }, { name: 'LBLT' }, { name: 'LK' }, { name: 'LYZ' },
  { name: 'MBA' }, { name: 'MBS', country: 'KR' }, { name: 'NACHI', country: 'JP' }, { name: 'NIS' }, { name: 'NKE', country: 'AT' },
  { name: 'NSK', country: 'JP' }, { name: 'NTN', country: 'JP' }, { name: 'NWO' }, { name: 'PEER', country: 'US' }, { name: 'PFI' },
  { name: 'PREC' }, { name: 'ROLL', country: 'US' }, { name: 'SACHS', country: 'DE' }, { name: 'SJB' }, { name: 'SKF', country: 'SE' },
  { name: 'SNR', country: 'FR' }, { name: 'T2' }, { name: 'TAM' }, { name: 'THOMP' }, { name: 'TIMKEN', country: 'US' },
  { name: 'TL', country: 'ES' }, { name: 'TORR' }, { name: 'TOYO' }, { name: 'VALEO', country: 'KR' }, { name: 'ZKL' },
  { name: 'ZSG', country: 'CN' }, { name: 'ZVL-LSA' },
];

/** `icon` is a name from the ERP icon set (libs/ui icons.ts). Roots are shown in this order. */
export const REFERENCE_CATEGORIES: { name: string; icon: string; children: string[] }[] = [
  {
    name: 'Rodamientos',
    icon: 'bearing',
    children: [
      'Rígidos de bolas',
      'Rodillos cilíndricos',
      'Rodillos cónicos',
      'Esféricos de rodillos',
      'Oscilantes de bolas',
      'Contacto angular',
      'Axiales de bolas',
      'Agujas',
      'Rótulas',
      'Ruedas y cubos',
      'Embrague',
      'Poleas y tensores',
      'Dirección',
      'Aplicaciones especiales',
      'Kits y juegos',
      'Especiales',
    ],
  },
  { name: 'Retenes y sellos', icon: 'seal', children: [] },
  { name: 'Chumaceras y soportes', icon: 'warehouse', children: [] },
  { name: 'Manguitos', icon: 'package', children: [] },
  { name: 'Crucetas y tricetas', icon: 'wrench', children: [] },
  { name: 'Correas y poleas', icon: 'pulley', children: ['Correas en V', 'Correas dentadas'] },
  { name: 'Cadenas y piñones', icon: 'link', children: [] },
  { name: 'Lubricantes y grasas', icon: 'droplet', children: [] },
  { name: 'Herramientas', icon: 'wrench', children: [] },
  { name: 'Accesorios', icon: 'package', children: [] },
  { name: 'Acoples', icon: 'transfer', children: [] },
];

export type AttributeSeed = {
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
export const SEAL_ATTRIBUTES: AttributeSeed[] = [
  { key: 'innerDiameter', label: 'Ø Interior d', type: 'NUMBER', step: 3, unit: 'mm', required: true },
  { key: 'outerDiameter', label: 'Ø Exterior D', type: 'NUMBER', step: 3, unit: 'mm', required: true },
  { key: 'width', label: 'Ancho B', type: 'NUMBER', step: 3, unit: 'mm', required: true },
  { key: 'material', label: 'Material', type: 'TEXT', step: 3, required: true },
  { key: 'lipType', label: 'Tipo de labio', type: 'TEXT', step: 3 },
  { key: 'maxTemperature', label: 'Temperatura máxima', type: 'NUMBER', step: 3, unit: '°C' },
  { key: 'spring', label: 'Con resorte', type: 'ENUM', step: 3, options: ['Sí', 'No'] },
];

/**
 * Generic technical fields for the categories that have none of their own (belts, chains, lubricants, tools, accessories
 * and couplings): the step looks the same everywhere and the real list per category comes with decision #52.
 * Chumaceras y soportes, Manguitos and Crucetas y tricetas have no definitions yet, so nothing is required of their products.
 */
export const GENERIC_ATTRIBUTES: AttributeSeed[] = [
  { key: 'material', label: 'Material', type: 'TEXT', step: 3, required: true },
  { key: 'mainMeasure', label: 'Medida principal', type: 'TEXT', step: 3, required: true },
  { key: 'model', label: 'Tipo o modelo', type: 'TEXT', step: 3 },
  { key: 'capacity', label: 'Capacidad o presentación', type: 'TEXT', step: 3 },
  { key: 'technicalNotes', label: 'Observaciones técnicas', type: 'TEXT', step: 3 },
];

/** Bearing fields (design-notes §Product creation), in sheet order: step 2 feeds "Dimensiones", step 3 "Especificaciones técnicas". */
export const BEARING_ATTRIBUTES: AttributeSeed[] = [
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

/** Roots with their own field list; every other root with fields gets the generic one. */
const ROOTS_WITHOUT_FIELDS = new Set(['Chumaceras y soportes', 'Manguitos', 'Crucetas y tricetas']);

export interface ReferenceData {
  /** Country id by ISO code. */
  countryId: Map<string, string>;
  /** Category id by name (roots and subcategories; the names do not repeat). */
  categoryId: Map<string, string>;
}

export async function seedReferenceData(prisma: PrismaClient, companyId: string): Promise<ReferenceData> {
  const countryId = new Map<string, string>();
  for (const c of REFERENCE_COUNTRIES) {
    const row = await prisma.country.upsert({
      where: { companyId_code: { companyId, code: c.code } },
      update: { name: c.name },
      create: { companyId, ...c },
    });
    countryId.set(c.code, row.id);
  }

  // an existing brand keeps the country it has; the seed only fills it when empty
  for (const b of REFERENCE_BRANDS) {
    const existing = await prisma.brand.findUnique({ where: { companyId_name: { companyId, name: b.name } } });
    const country = b.country ? countryId.get(b.country) : undefined;
    if (!existing) await prisma.brand.create({ data: { companyId, name: b.name, countryId: country ?? null } });
    else if (!existing.countryId && country) await prisma.brand.update({ where: { id: existing.id }, data: { countryId: country } });
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
  for (const [i, c] of REFERENCE_CATEGORIES.entries()) {
    const rootId = await ensureCategory(c.name, null, i, c.icon);
    for (const [j, child] of c.children.entries()) await ensureCategory(child, rootId, j);
  }

  const upsertFields = async (rootName: string, fields: AttributeSeed[]) => {
    const rootId = categoryId.get(rootName) as string;
    for (const [sortOrder, a] of fields.entries()) {
      const data = { label: a.label, type: a.type, unit: a.unit ?? null, options: a.options ?? undefined, step: a.step, sortOrder, required: a.required ?? false };
      await prisma.attributeDefinition.upsert({
        where: { categoryId_key: { categoryId: rootId, key: a.key } },
        update: data,
        create: { companyId, categoryId: rootId, key: a.key, ...data },
      });
    }
  };
  await upsertFields('Rodamientos', BEARING_ATTRIBUTES);
  await upsertFields('Retenes y sellos', SEAL_ATTRIBUTES);
  const specific = new Set(['Rodamientos', 'Retenes y sellos']);
  for (const c of REFERENCE_CATEGORIES) {
    if (!specific.has(c.name) && !ROOTS_WITHOUT_FIELDS.has(c.name)) await upsertFields(c.name, GENERIC_ATTRIBUTES);
  }

  return { countryId, categoryId };
}
