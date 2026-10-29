/**
 * Creates what the inventory needs before the import can accept its rows (unknown brand or category = row error, #33):
 * the countries, the brands (with the country the inventory gives them) and the categories. Idempotent: what exists is
 * left alone. It only reports by default; nothing is written without --apply.
 *
 * Usage: npx tsx --tsconfig tsconfig.base.json --env-file=.env tools/migrate-inventory-2026/prepare-reference-data.ts <inventario.csv> <company-slug> [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeImportText } from '@rodasoft/domain';
import { prepare } from './pipeline';

const [csvPath, slug, ...flags] = process.argv.slice(2);
const apply = flags.includes('--apply');
if (!csvPath || !slug) throw new Error('Usage: prepare-reference-data.ts <inventario.csv> <company-slug> [--apply]');

/** Country text of the inventory (already repaired) -> ISO code and the name the ERP shows. */
const COUNTRIES: Record<string, { code: string; name: string }> = {
  JAPÓN: { code: 'JP', name: 'Japón' },
  AUSTRIA: { code: 'AT', name: 'Austria' },
  ESPAÑA: { code: 'ES', name: 'España' },
  ITALY: { code: 'IT', name: 'Italia' },
  GERMANY: { code: 'DE', name: 'Alemania' },
  USA: { code: 'US', name: 'Estados Unidos' },
  FRANCIA: { code: 'FR', name: 'Francia' },
  KOREA: { code: 'KR', name: 'Corea del Sur' },
  BRAZIL: { code: 'BR', name: 'Brasil' },
  UKRAINE: { code: 'UA', name: 'Ucrania' },
  BOLIVIA: { code: 'BO', name: 'Bolivia' },
  POLAND: { code: 'PL', name: 'Polonia' },
  THAILAND: { code: 'TH', name: 'Tailandia' },
  CHINA: { code: 'CN', name: 'China' },
};
/** NN = "no name": the inventory does not know the country. */
const UNKNOWN_COUNTRY = new Set(['NN', '']);

const categoryRules: { category: string; subcategory: string | null; icon: string }[] = JSON.parse(
  readFileSync(join(__dirname, 'category-map.json'), 'utf8'),
).rules;

async function main() {
  const prisma = new PrismaClient();
  try {
    const company = await prisma.company.findUnique({ where: { slug } });
    if (!company) throw new Error(`No company with slug "${slug}"`);
    const companyId = company.id;
    const data = prepare(csvPath);
    const plan: string[] = [];

    // brands -> dominant known country of their rows
    const votes = new Map<string, Map<string, number>>();
    for (const row of data.all) {
      const m = votes.get(row.brand) ?? new Map<string, number>();
      if (!UNKNOWN_COUNTRY.has(row.country)) m.set(row.country, (m.get(row.country) ?? 0) + 1);
      votes.set(row.brand, m);
    }
    const countryOfBrand = (brand: string): string | null => {
      const best = [...(votes.get(brand) ?? [])].sort((a, b) => b[1] - a[1])[0];
      return best ? best[0] : null;
    };
    const unmapped = new Set<string>();
    for (const row of data.all) if (!UNKNOWN_COUNTRY.has(row.country) && !COUNTRIES[row.country]) unmapped.add(row.country);
    if (unmapped.size) throw new Error(`Countries without a mapping: ${[...unmapped].join(', ')}`);

    // countries
    const countryId = new Map<string, string>();
    for (const c of Object.values(COUNTRIES)) {
      const found = await prisma.country.findUnique({ where: { companyId_code: { companyId, code: c.code } } });
      if (found) countryId.set(c.code, found.id);
      else {
        plan.push(`country  + ${c.code} ${c.name}`);
        if (apply) countryId.set(c.code, (await prisma.country.create({ data: { companyId, ...c } })).id);
      }
    }

    // brands: matched without caring for case or accents, as the importer does
    const existingBrands = new Map((await prisma.brand.findMany({ where: { companyId } })).map((b) => [normalizeImportText(b.name), b]));
    for (const name of [...new Set(data.all.map((r) => r.brand))].sort()) {
      if (existingBrands.has(normalizeImportText(name))) continue;
      const country = countryOfBrand(name);
      plan.push(`brand    + ${name}${country ? ` (${COUNTRIES[country].name})` : ' (sin país)'}`);
      if (apply) {
        const code = country ? COUNTRIES[country].code : null;
        await prisma.brand.create({ data: { companyId, name, countryId: code ? (countryId.get(code) ?? null) : null } });
      }
    }

    // categories: the bearings root must come from the seed, because its technical fields decide that it is a bearing
    const roots = await prisma.category.findMany({ where: { companyId, parentId: null } });
    const rootByName = new Map(roots.map((c) => [normalizeImportText(c.name), c]));
    const bearingsRoot = rootByName.get('rodamientos');
    if (!bearingsRoot) throw new Error('The company has no "Rodamientos" category with its technical fields: run the catalog seed first');
    const wanted = new Map<string, { category: string; subcategory: string | null; icon: string }>();
    for (const r of categoryRules) wanted.set(`${r.category}|${r.subcategory ?? ''}`, r);
    let sortOrder = roots.length;
    for (const r of wanted.values()) {
      let root = rootByName.get(normalizeImportText(r.category));
      if (!root) {
        plan.push(`category + ${r.category}`);
        if (apply) {
          root = await prisma.category.create({ data: { companyId, parentId: null, name: r.category, icon: r.icon, sortOrder: sortOrder++ } });
          rootByName.set(normalizeImportText(r.category), root);
        }
      }
      if (!r.subcategory) continue;
      const children = root ? await prisma.category.findMany({ where: { companyId, parentId: root.id } }) : [];
      if (children.some((c) => normalizeImportText(c.name) === normalizeImportText(r.subcategory as string))) continue;
      plan.push(`category + ${r.category} > ${r.subcategory}`);
      if (apply && root) {
        await prisma.category.create({ data: { companyId, parentId: root.id, name: r.subcategory, icon: 'bearing', sortOrder: children.length } });
      }
    }

    console.log(`${apply ? 'APPLIED' : 'DRY RUN (nothing written, add --apply)'} for company "${slug}":`);
    console.log(plan.length ? plan.join('\n') : '(nothing to create)');
    console.log(`${plan.length} change(s)`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
