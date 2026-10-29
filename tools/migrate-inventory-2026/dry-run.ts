/**
 * Offline check of the generated files with the importer's own domain rules (`validateImportRows`), without a database:
 * the brands, categories and the HK-01 warehouse are taken from what prepare-reference-data.ts would create.
 * Usage: npx tsx --tsconfig tsconfig.base.json tools/migrate-inventory-2026/dry-run.ts <outDir>
 */
import ExcelJS from 'exceljs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyImportRow,
  type ImportLookups,
  type ImportRow,
  mapImportHeaders,
  normalizeImportText,
  summarizeImport,
  validateImportRows,
} from '@rodasoft/domain';

const [outDir] = process.argv.slice(2);
if (!outDir) throw new Error('Usage: dry-run.ts <outDir>');

const rules: { category: string; subcategory: string | null }[] = JSON.parse(readFileSync(join(__dirname, 'category-map.json'), 'utf8')).rules;

function lookupsFor(brands: Set<string>): ImportLookups {
  const known = new Map<string, Set<string>>();
  for (const r of rules) {
    const key = normalizeImportText(r.category);
    const subs = known.get(key) ?? new Set<string>();
    if (r.subcategory) subs.add(normalizeImportText(r.subcategory));
    known.set(key, subs);
  }
  return {
    brandId: (name) => (brands.has(normalizeImportText(name)) ? normalizeImportText(name) : null),
    category: (category, subcategory) => {
      const subs = known.get(normalizeImportText(category));
      if (!subs) return 'CATEGORY_NOT_FOUND';
      if (subcategory.trim() && !subs.has(normalizeImportText(subcategory))) return 'SUBCATEGORY_NOT_FOUND';
      // the bearings root carries the step-2 fields, so every bearing needs d, D and B; nothing else is required
      return { id: `${category}|${subcategory}`, rules: [], isBearing: normalizeImportText(category) === 'rodamientos' };
    },
    warehouse: (code) => (code === 'HK-01' ? { id: 'hk01', code, active: true, allowed: true } : null),
    existing: () => null,
  };
}

async function main() {
  const brands = new Set<string>();
  for (const line of readFileSync(join(outDir, 'revision-marcas.csv'), 'utf8').split('\n').slice(1)) {
    const name = /^"([^"]*)"/.exec(line)?.[1];
    if (name) brands.add(normalizeImportText(name));
  }
  const lookups = lookupsFor(brands);
  let total = 0;
  let bad = 0;
  const byCode = new Map<string, number>();
  const seen = new Set<string>();
  for (const file of readdirSync(outDir).filter((f) => /^productos-importar-\d+\.xlsx$/.test(f)).sort()) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(join(outDir, file));
    const sheet = book.worksheets[0];
    const headers = (sheet.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ''));
    const map = mapImportHeaders(headers, []);
    if (map.missing.length) throw new Error(`${file}: missing columns ${map.missing.join(', ')}`);
    const rows: ImportRow[] = [];
    for (let n = 2; n <= sheet.rowCount; n++) {
      const row = emptyImportRow(n);
      for (const c of map.columns) {
        const v = sheet.getRow(n).getCell(c.index + 1).value;
        const text = v === null || v === undefined ? '' : String(v);
        if (c.kind === 'fixed') row[c.field] = text;
        else if (c.kind === 'stock') row.stock[c.warehouseCode] = text;
      }
      rows.push(row);
    }
    const results = validateImportRows(rows, lookups, 'create_only');
    const summary = summarizeImport(results);
    for (const r of results) {
      const key = `${r.brandId}|${normalizeImportText(r.code)}`;
      if (seen.has(key)) byCode.set('DUPLICATE_ACROSS_FILES', (byCode.get('DUPLICATE_ACROSS_FILES') ?? 0) + 1);
      seen.add(key);
      for (const e of r.errors) byCode.set(e.code, (byCode.get(e.code) ?? 0) + 1);
    }
    console.log(`${file}: ${summary.total} rows, ${summary.valid} valid, ${summary.withError} with error, ${summary.pieces} pieces, Bs ${summary.value}`);
    total += summary.total;
    bad += summary.withError;
    results.filter((r) => r.errors.length).slice(0, 5).forEach((r) => console.log('   row', r.rowNumber, r.code, r.errors.map((e) => `${e.field}:${e.code}`).join(',')));
  }
  console.log(`TOTAL ${total} rows, ${bad} with error`, [...byCode]);
}

void main();
