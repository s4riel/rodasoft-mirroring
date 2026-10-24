import type { EquivalenceComparisonColumn, EquivalenceComparisonRow } from '@rodasoft/domain';
import { cellText, columnPill, parseIds, rowTitle } from './equivalence-compare.mapper';

const row = (over: Partial<EquivalenceComparisonRow>): EquivalenceComparisonRow => ({
  key: 'seal',
  label: 'Protección / sello',
  unit: null,
  group: 'SPECS',
  values: [],
  differs: false,
  ...over,
});

const column = (over: Partial<EquivalenceComparisonColumn>): EquivalenceComparisonColumn =>
  ({ productId: 'p', kind: 'EXACT', differences: [], ...over }) as EquivalenceComparisonColumn;

describe('parseIds', () => {
  it('splits, trims and drops blanks and repeats, keeping the order', () => {
    expect(parseIds(' b, a ,,b,c ')).toEqual(['b', 'a', 'c']);
    expect(parseIds(null)).toEqual([]);
    expect(parseIds('')).toEqual([]);
  });
});

describe('rowTitle', () => {
  it('names the measures with their symbol and the width as B, T or both', () => {
    expect(rowTitle(row({ key: 'innerDiameter', label: 'd', group: 'MEASURES' }))).toBe('Diámetro interior (d)');
    expect(rowTitle(row({ key: 'outerDiameter', label: 'D', group: 'MEASURES' }))).toBe('Diámetro exterior (D)');
    expect(rowTitle(row({ key: 'width', label: 'B', group: 'MEASURES' }))).toBe('Ancho (B)');
    expect(rowTitle(row({ key: 'width', label: 'T', group: 'MEASURES' }))).toBe('Ancho total (T)');
    expect(rowTitle(row({ key: 'width', label: 'B / T', group: 'MEASURES' }))).toBe('Ancho (B / T)');
  });

  it('names the industry, and keeps the label of a category field', () => {
    expect(rowTitle(row({ key: 'country', label: 'country' }))).toBe('Industria');
    expect(rowTitle(row({ key: 'cage', label: 'Material de la jaula' }))).toBe('Material de la jaula');
  });
});

describe('cellText', () => {
  it('writes a missing value as an em dash and appends the unit', () => {
    expect(cellText(row({ unit: 'kN' }), null)).toBe('—');
    expect(cellText(row({ unit: 'kN' }), '14,8')).toBe('14,8 kN');
    expect(cellText(row({ unit: null }), '2RS')).toBe('2RS');
  });
});

describe('columnPill', () => {
  it('marks the first column as the reference whatever its kind', () => {
    expect(columnPill(column({ kind: 'EXACT' }), 0)).toMatchObject({ label: 'Referencia', status: 'info' });
  });

  it('says how the others compare, with the differences in the tooltip', () => {
    expect(columnPill(column({ kind: 'EXACT' }), 1)).toMatchObject({ label: 'Exacta', status: 'success' });
    expect(columnPill(column({ kind: 'INCOMPATIBLE' }), 2)).toMatchObject({ label: 'Incompatible', status: 'danger' });
    const pill = columnPill(
      column({ kind: 'WITH_DIFFERENCES', differences: [{ key: 'seal', label: 'Sello', source: '2RS', other: '2Z' }] }),
      1,
    );
    expect(pill).toMatchObject({ label: 'Con diferencias', status: 'warning', tooltip: 'Sello: 2RS → 2Z' });
  });
});
