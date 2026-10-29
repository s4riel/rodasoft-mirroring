/** Shared by build-template-files.ts and prepare-reference-data.ts: the inventory rows, merged and with dimensions derived. */
import { type Dimensions, deriveDimensions } from './dimensions';
import { type InventoryRow, loadRows, type MergedRow, mergeDuplicates } from './normalize';

export interface PreparedRow extends MergedRow {
  dimensions: Dimensions | null;
  /** Why the row cannot go through the importer yet; null = ready. */
  pendingReason: string | null;
}

/** The codes of the file are at most this long; the ERP accepts 60. */
const MAX_CODE_LENGTH = 60;

export function prepare(csvPath: string) {
  const { rows, skipped } = loadRows(csvPath);
  const merged = mergeDuplicates(rows);
  const prepared: PreparedRow[] = merged.rows.map((row) => {
    const isBearing = row.category === 'Rodamientos';
    const dimensions = isBearing ? deriveDimensions(row.subcategory, row.code) : null;
    let pendingReason: string | null = null;
    if (isBearing && !dimensions) pendingReason = 'SIN_MEDIDAS: no se pudo derivar d, D y B del código';
    else if (row.code.length > MAX_CODE_LENGTH) pendingReason = 'CODIGO_LARGO: más de 60 caracteres';
    else if (!row.code) pendingReason = 'SIN_CODIGO';
    else if (row.notes.includes('INVALID_NUMBER')) pendingReason = 'NUMERO_INVALIDO: precio, costo o cantidad ilegible';
    return { ...row, dimensions, pendingReason };
  });
  return {
    skipped,
    source: rows as readonly InventoryRow[],
    all: prepared,
    ready: prepared.filter((r) => !r.pendingReason),
    pending: prepared.filter((r) => r.pendingReason),
    duplicates: merged.duplicates,
  };
}
