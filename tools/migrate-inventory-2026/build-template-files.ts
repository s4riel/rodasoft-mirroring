/**
 * Writes the inventory as files in the import template (the same sheet and headers as `plantilla-productos.xlsx`):
 *   productos-importar-01..N.xlsx  rows that can go through Productos > Importar
 *   pendientes.xlsx                rows that cannot yet, with the reason
 *   revision-*.csv, resumen.txt    what to review before loading
 * Usage: npx tsx --tsconfig tsconfig.base.json tools/migrate-inventory-2026/build-template-files.ts <inventario.csv> <plantilla.xlsx> <outDir>
 */
import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COST_SCALE, Decimal } from '@rodasoft/domain';
import { type PreparedRow, prepare } from './pipeline';

const STOCK_HEADER = 'Stock HK-01';
/** Rows per file: the import commit has a 120 s transaction, 1,000 products with stock fit comfortably. */
const ROWS_PER_FILE = 1000;

const [csvPath, templatePath, outDir] = process.argv.slice(2);
if (!csvPath || !templatePath || !outDir) throw new Error('Usage: build-template-files.ts <inventario.csv> <plantilla.xlsx> <outDir>');

const num = (text: string) => Number(text);
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n') + '\n';

async function templateHeaders(): Promise<string[]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(templatePath);
  const headers: string[] = [];
  book.worksheets[0].getRow(1).eachCell({ includeEmpty: true }, (cell, col) => (headers[col - 1] = String(cell.value ?? '')));
  return headers;
}

function templateRow(headers: string[], r: PreparedRow): (string | number | null)[] {
  const cells: Record<string, string | number | null> = {
    Código: r.code,
    Marca: r.brand,
    Categoría: r.category,
    Subcategoría: r.subcategory,
    Descripción: r.description,
    Precio: num(r.price),
    d: r.dimensions ? num(r.dimensions.d) : null,
    D: r.dimensions ? num(r.dimensions.D) : null,
    B: r.dimensions ? num(r.dimensions.B) : null,
    'Costo unitario': num(r.cost),
    [STOCK_HEADER]: r.quantity,
  };
  return headers.map((h) => cells[h] ?? null);
}

async function writeWorkbook(file: string, headers: string[], rows: (string | number | null)[][]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Productos');
  sheet.addRow(headers).font = { bold: true };
  rows.forEach((r) => sheet.addRow(r));
  headers.forEach((_, i) => (sheet.getColumn(i + 1).width = 18));
  await book.xlsx.writeFile(file);
}

const sum = (rows: readonly PreparedRow[], pick: (r: PreparedRow) => string) =>
  rows.reduce((total, r) => total.add(Decimal.of(pick(r), COST_SCALE)), Decimal.zero(COST_SCALE));

async function main() {
  mkdirSync(outDir, { recursive: true });
  const headers = await templateHeaders();
  if (!headers.includes(STOCK_HEADER)) throw new Error(`The template has no "${STOCK_HEADER}" column: ${headers.join(', ')}`);
  const data = prepare(csvPath);

  // files that go through the importer
  const files: string[] = [];
  for (let i = 0; i < data.ready.length; i += ROWS_PER_FILE) {
    const name = `productos-importar-${String(files.length + 1).padStart(2, '0')}.xlsx`;
    await writeWorkbook(join(outDir, name), headers, data.ready.slice(i, i + ROWS_PER_FILE).map((r) => templateRow(headers, r)));
    files.push(name);
  }
  await writeWorkbook(
    join(outDir, 'pendientes.xlsx'),
    [...headers, 'Motivo', 'Nro en inventario', 'Código original', 'Marca en inventario'],
    data.pending.map((r) => [...templateRow(headers, r), r.pendingReason, r.mergedFrom.join('+'), r.rawCode, r.fileBrand]),
  );

  // review tables
  const types = new Map<string, { category: string; sub: string; count: number }>();
  for (const r of data.source) {
    const t = types.get(r.productType) ?? { category: r.category, sub: r.subcategory ?? '', count: 0 };
    t.count++;
    types.set(r.productType, t);
  }
  writeFileSync(
    join(outDir, 'revision-categorias.csv'),
    csv([['Tipo en inventario', 'Categoría', 'Subcategoría', 'Filas'], ...[...types].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => [k, v.category, v.sub, v.count])]),
    'utf8',
  );

  const brands = new Map<string, { names: Set<string>; count: number; countries: Map<string, number> }>();
  for (const r of data.source) {
    const b = brands.get(r.brand) ?? { names: new Set<string>(), count: 0, countries: new Map<string, number>() };
    b.names.add(r.fileBrand);
    b.count++;
    b.countries.set(r.country, (b.countries.get(r.country) ?? 0) + 1);
    brands.set(r.brand, b);
  }
  writeFileSync(
    join(outDir, 'revision-marcas.csv'),
    csv([
      ['Marca en el ERP', 'Escrita en inventario como', 'Filas', 'Países en el inventario'],
      ...[...brands].sort((a, b) => b[1].count - a[1].count).map(([k, v]) => [k, [...v.names].join(' / '), v.count, [...v.countries].map(([c, n]) => `${c} (${n})`).join(', ')]),
    ]),
    'utf8',
  );
  writeFileSync(
    join(outDir, 'revision-duplicados.csv'),
    csv([['Marca', 'Código', 'Nro en inventario', 'Cantidad sumada'], ...data.duplicates.map((d) => [d.brand, d.code, d.mergedFrom.join('+'), d.quantity])]),
    'utf8',
  );
  const odd = data.all.filter((r) => r.notes.some((n) => n.startsWith('CODE_BRAND_DIFFERS') || n.startsWith('UNIT') || n.startsWith('PRICE_DIFFERS')));
  writeFileSync(
    join(outDir, 'revision-filas-dudosas.csv'),
    csv([['Nro', 'Código original', 'Código', 'Marca inventario', 'Marca ERP', 'Avisos'], ...odd.map((r) => [r.mergedFrom.join('+'), r.rawCode, r.code, r.fileBrand, r.brand, r.notes.join('; ')])]),
    'utf8',
  );
  // a spread sample of derived dimensions, to check against a catalog
  const derived = data.ready.filter((r) => r.dimensions);
  const step = Math.max(1, Math.floor(derived.length / 60));
  writeFileSync(
    join(outDir, 'muestra-medidas.csv'),
    csv([['Código', 'Marca', 'Subcategoría', 'd', 'D', 'B', 'Tabla'], ...derived.filter((_, i) => i % step === 0).flatMap((r) => (r.dimensions ? [[r.code, r.brand, r.subcategory ?? '', r.dimensions.d, r.dimensions.D, r.dimensions.B, r.dimensions.source]] : []))]),
    'utf8',
  );

  // totals: loaded + pending must equal the inventory file
  const qty = (rows: readonly PreparedRow[]) => rows.reduce((t, r) => t + r.quantity, 0);
  const bySub = new Map<string, { ready: number; pending: number }>();
  for (const r of data.all) {
    const k = `${r.category} > ${r.subcategory ?? '-'}`;
    const e = bySub.get(k) ?? { ready: 0, pending: 0 };
    if (r.pendingReason) e.pending++;
    else e.ready++;
    bySub.set(k, e);
  }
  const lines = [
    `Filas del inventario: ${data.source.length} (+ ${data.skipped.length} fila de totales ignorada)`,
    `Productos tras unir duplicados: ${data.all.length}`,
    `Listos para importar: ${data.ready.length} en ${files.length} archivos (${files.join(', ')})`,
    `Pendientes: ${data.pending.length}`,
    '',
    `Piezas listas: ${qty(data.ready)} | pendientes: ${qty(data.pending)} | total: ${qty(data.all)} (inventario: 99888)`,
    `Valorado listo: ${sum(data.ready, (r) => r.value).round(2)} | pendiente: ${sum(data.pending, (r) => r.value).round(2)} | total: ${sum(data.all, (r) => r.value).round(2)} (inventario: 7588114.01)`,
    '',
    'Por categoría (listos / pendientes):',
    ...[...bySub].sort((a, b) => b[1].ready + b[1].pending - (a[1].ready + a[1].pending)).map(([k, v]) => `  ${k}: ${v.ready} / ${v.pending}`),
  ];
  writeFileSync(join(outDir, 'resumen.txt'), lines.join('\n') + '\n', 'utf8');
  console.log(lines.join('\n'));
}

void main();
