import type { EquivalenceListItem, EquivalenceListProduct } from '@rodasoft/domain';
import { EQUIVALENCES_PAGE_SIZE, measuresLabel, parseKind, toQuery, toRow } from './equivalences.mapper';

const product = (over: Partial<EquivalenceListProduct> = {}): EquivalenceListProduct => ({
  id: 'p1',
  manufacturerCode: '6205-2RS',
  brand: { id: 'b-skf', name: 'SKF', logoUrl: null },
  country: { id: 'c-se', code: 'SE', name: 'Suecia' },
  photoUrl: null,
  categoryIcon: 'bearing',
  dimensions: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000' },
  totalStock: 24,
  status: 'ACTIVE',
  ...over,
});

const item = (over: Partial<EquivalenceListItem> = {}): EquivalenceListItem => ({
  id: 'e1',
  productA: product(),
  productB: product({ id: 'p2', manufacturerCode: '6205-DDU' }),
  kind: 'EXACT',
  differences: [],
  createdBy: null,
  createdAt: '2026-10-24T10:00:00.000Z',
  ...over,
});

describe('equivalences mapper', () => {
  it('maps the URL filters to the API query and leaves out the empty ones', () => {
    expect(toQuery({ q: '', brandId: null, categoryId: null, kind: null, page: 1 })).toEqual({
      q: undefined,
      brandId: undefined,
      categoryId: undefined,
      kind: undefined,
      page: 1,
      pageSize: EQUIVALENCES_PAGE_SIZE,
    });
    expect(toQuery({ q: '6205', brandId: 'b1', categoryId: 'k1', kind: 'EXACT', page: 3 })).toEqual({
      q: '6205',
      brandId: 'b1',
      categoryId: 'k1',
      kind: 'EXACT',
      page: 3,
      pageSize: 10,
    });
  });

  it('accepts only the known kinds from the URL', () => {
    expect(parseKind('WITH_DIFFERENCES')).toBe('WITH_DIFFERENCES');
    expect(parseKind('whatever')).toBeNull();
    expect(parseKind(null)).toBeNull();
  });

  it('writes the measures without trailing zeros, and an en dash when one is missing', () => {
    expect(measuresLabel(product())).toBe('25×52×15 mm');
    expect(measuresLabel(product({ dimensions: { innerDiameter: '17.500', outerDiameter: '40.000', width: '12.000' } }))).toBe('17,5×40×12 mm');
    expect(measuresLabel(product({ dimensions: null }))).toBe('–');
    expect(measuresLabel(product({ dimensions: { innerDiameter: '25', outerDiameter: null, width: '15' } }))).toBe('–');
  });

  it('shows an exact link as "Exacta" and one with differences with each difference in the tooltip', () => {
    expect(toRow(item()).cells['kind']).toMatchObject({ label: 'Exacta', status: 'success' });
    const withDifferences = toRow(
      item({
        kind: 'WITH_DIFFERENCES',
        differences: [
          { key: 'seal', label: 'Sello', source: '2RS', other: 'DDU' },
          { key: 'cage', label: 'Jaula', source: 'Acero', other: null },
        ],
      }),
    );
    expect(withDifferences.cells['kind']).toMatchObject({
      label: 'Con diferencias',
      status: 'warning',
      tooltip: 'Sello: 2RS → DDU · Jaula: Acero → —',
    });
  });
});
