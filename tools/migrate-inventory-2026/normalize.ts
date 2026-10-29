/**
 * Reads the CSV extracted from "INVENTARIO ALMACEN 2026.xls" and turns each line into a clean product row:
 * code and brand split, brand alias, category, price, unit cost and stock as exact decimals (never floats).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COST_SCALE, Decimal, normalizeImportText } from '@rodasoft/domain';

const HERE = __dirname;
const categoryRules: { match: string; category: string; subcategory: string | null; icon: string }[] = JSON.parse(
  readFileSync(join(HERE, 'category-map.json'), 'utf8'),
).rules;
const brandAliases: Record<string, string> = JSON.parse(readFileSync(join(HERE, 'brand-aliases.json'), 'utf8')).aliases;

export interface InventoryRow {
  /** 1-based number in the inventory file (`Nro`). */
  nro: number;
  /** The `codigo` cell as written. */
  rawCode: string;
  code: string;
  /** Brand as the ERP will know it (alias applied). */
  brand: string;
  /** Brand exactly as the `marca` column says. */
  fileBrand: string;
  productType: string;
  category: string;
  subcategory: string | null;
  description: string;
  price: string;
  /** Unit cost with 4 decimals: valorado / cantidad, because the file shows costs rounded to 2 decimals. */
  cost: string;
  quantity: number;
  unit: string;
  /** Country text of the file, repaired ("ESPAÑA"); `NN` = unknown. */
  country: string;
  /** What the `valorado` column says, for the reconciliation. */
  value: string;
  notes: string[];
}

/** Minimal CSV reader for the extract (every cell quoted, `""` inside a cell is a quote). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** "1,316.37" -> "1316.37"; null when the text is not a plain number. */
export function cleanNumber(text: string): string | null {
  const t = text.trim().replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(t) ? t : null;
}

/** The file's country text arrives with broken accents ("ESPAÃ‘A"); only the first letters are trusted. */
export function repairCountry(text: string): string {
  const t = text.trim().toUpperCase();
  if (t.startsWith('ESPA')) return 'ESPAÑA';
  if (t === 'JAPON') return 'JAPÓN';
  return t;
}

const sentenceCase = (text: string): string => {
  const lower = text.trim().replace(/\s+/g, ' ').toLowerCase();
  return (lower.charAt(0).toUpperCase() + lower.slice(1)).replace(/\((mm|pg)\)/g, (m) => m.toUpperCase());
};

export function categoryOf(productType: string): { category: string; subcategory: string | null; icon: string } {
  const key = normalizeImportText(productType).toUpperCase();
  for (const rule of categoryRules) {
    if (new RegExp(rule.match, 'i').test(key)) return { category: rule.category, subcategory: rule.subcategory, icon: rule.icon };
  }
  throw new Error(`No category rule for "${productType}"`);
}

const sameBrand = (a: string, b: string) => normalizeImportText(a).replace(/[^a-z0-9]/g, '') === normalizeImportText(b).replace(/[^a-z0-9]/g, '');

/**
 * `6205-2RS / SKF` -> `6205-2RS`. The brand marker is only removed when it names the row's own brand (or an alias of it),
 * so a real code such as `NU208/ETN` is never cut. Irregular spellings (`X /NKE`, `X/ NKE`, `X AYS`) are handled too.
 */
export function splitCode(raw: string, fileBrand: string, brand: string): { code: string; stripped: boolean } {
  const text = raw.trim().replace(/\s+/g, ' ');
  const markers = new Set([fileBrand, brand, 'TIMKEN', 'YOTO', 'SACHS', 'ZSG ERROR']);
  const isMarker = (s: string) => [...markers].some((m) => sameBrand(s, m));
  // a brand that contains a slash itself (`H2315 / C/S`) is matched as a whole before cutting at the last slash
  for (const marker of markers) {
    if (marker.includes('/') && text.toUpperCase().endsWith(` / ${marker.toUpperCase()}`)) {
      return { code: text.slice(0, text.length - marker.length - 3).trim(), stripped: true };
    }
  }
  const slash = text.lastIndexOf('/');
  if (slash >= 0) {
    const tail = text.slice(slash + 1);
    if (isMarker(tail)) return { code: text.slice(0, slash).trim(), stripped: true };
  }
  const space = text.lastIndexOf(' ');
  if (space >= 0 && isMarker(text.slice(space + 1))) return { code: text.slice(0, space).trim(), stripped: true };
  // the file always writes " / BRAND" at the end; a marker that is not this row's brand (`GUM-86 / GMB`, marca GMG) is
  // still a marker: the row is noted as CODE_BRAND_DIFFERS for review
  const spaced = / \/ ([A-Za-z][A-Za-z0-9.& ]{1,14})$/.exec(text);
  if (spaced) return { code: text.slice(0, spaced.index).trim(), stripped: true };
  return { code: text, stripped: false };
}

export function loadRows(csvPath: string): { rows: InventoryRow[]; skipped: string[][] } {
  const lines = parseCsv(readFileSync(csvPath, 'utf8'));
  const [header, ...body] = lines;
  const idx = (name: string) => header.indexOf(name);
  const col = { nro: idx('Nro'), code: idx('codigo'), type: idx('nombre'), brand: idx('marca'), price: idx('preciobs1'), unit: idx('unidad'), country: idx('pais'), qty: idx('cantidad'), cost: idx('costounitario'), value: idx('valorado') };
  if (Object.values(col).some((i) => i < 0)) throw new Error(`Unexpected header: ${header.join(',')}`);

  const rows: InventoryRow[] = [];
  const skipped: string[][] = [];
  for (const line of body) {
    // the last line of the workbook holds the totals: no product code
    if (!line[col.code]?.trim()) {
      skipped.push(line);
      continue;
    }
    const notes: string[] = [];
    const fileBrand = line[col.brand].trim().toUpperCase();
    const brand = brandAliases[fileBrand] ?? fileBrand;
    const { code, stripped } = splitCode(line[col.code], fileBrand, brand);
    if (!stripped) notes.push('CODE_WITHOUT_BRAND_MARKER');
    if (brand !== fileBrand) notes.push(`BRAND_ALIAS:${fileBrand}->${brand}`);
    const suffix = /\/\s*([^/]+)$/.exec(line[col.code]);
    if (suffix && stripped && !/\//.test(fileBrand) && !sameBrand(suffix[1], fileBrand) && !sameBrand(suffix[1], brand)) notes.push(`CODE_BRAND_DIFFERS:${suffix[1].trim()}`);

    const price = cleanNumber(line[col.price]);
    const qty = cleanNumber(line[col.qty]);
    const value = cleanNumber(line[col.value]);
    const fileCost = cleanNumber(line[col.cost]);
    if (price === null || qty === null || value === null || fileCost === null) {
      notes.push('INVALID_NUMBER');
    }
    const quantity = qty === null ? 0 : Math.round(Number(qty));
    if (qty !== null && Number(qty) !== quantity) notes.push('FRACTIONAL_QUANTITY');
    // the unit cost is rebuilt from the row value: the 2-decimal cost column would lose cents over thousands of pieces
    let cost = fileCost ?? '0';
    if (value !== null && quantity > 0) cost = Decimal.of(value).div(quantity, COST_SCALE).toString();

    const type = line[col.type].trim();
    const target = categoryOf(type);
    const unit = line[col.unit].trim() || 'pza';
    if (unit.toLowerCase() !== 'pza') notes.push(`UNIT:${unit}`);

    rows.push({
      nro: Number(line[col.nro]),
      rawCode: line[col.code],
      code,
      brand,
      fileBrand,
      productType: type,
      category: target.category,
      subcategory: target.subcategory,
      description: sentenceCase(type),
      price: price ?? '0',
      cost,
      quantity,
      unit,
      country: repairCountry(line[col.country]),
      value: value ?? '0',
      notes,
    });
  }
  return { rows, skipped };
}

export interface MergedRow extends InventoryRow {
  /** Nro of every inventory line that was merged into this one. */
  mergedFrom: number[];
}

/** The same (brand, code) twice: one product, quantities and values added up. */
export function mergeDuplicates(rows: readonly InventoryRow[]): { rows: MergedRow[]; duplicates: MergedRow[] } {
  const byKey = new Map<string, MergedRow>();
  const duplicates = new Set<MergedRow>();
  for (const row of rows) {
    const key = `${normalizeImportText(row.brand)}|${normalizeImportText(row.code)}`;
    const found = byKey.get(key);
    if (!found) {
      byKey.set(key, { ...row, mergedFrom: [row.nro] });
      continue;
    }
    found.quantity += row.quantity;
    found.value = Decimal.of(found.value).add(Decimal.of(row.value)).toString();
    found.cost = found.quantity > 0 ? Decimal.of(found.value).div(found.quantity, COST_SCALE).toString() : found.cost;
    found.mergedFrom.push(row.nro);
    found.notes.push(`MERGED_WITH:${row.nro}`);
    if (row.price !== found.price) found.notes.push(`PRICE_DIFFERS:${row.price}`);
    duplicates.add(found);
  }
  return { rows: [...byKey.values()], duplicates: [...duplicates] };
}
