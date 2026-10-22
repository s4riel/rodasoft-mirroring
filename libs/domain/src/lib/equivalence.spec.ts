import { compareEquivalents, EquivalenceComparable, normalizePair } from './equivalence';

const LABELS = { seal: 'Protección / sello', cage: 'Material de la jaula', dynamicLoad: 'Carga dinámica C' };

const bearing = (over: Partial<EquivalenceComparable> = {}): EquivalenceComparable => ({
  categoryId: 'balls',
  dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15' },
  attributes: { seal: '2RS', internalClearance: 'CN', toleranceClass: 'P0', cage: 'Acero', dynamicLoad: 14.8, staticLoad: 7.8 },
  ...over,
});

describe('compareEquivalents', () => {
  it('is EXACT when type, measures and every compared specification match', () => {
    expect(compareEquivalents(bearing(), bearing())).toEqual({ kind: 'EXACT', differences: [] });
  });

  it('is WITH_DIFFERENCES and lists a differing seal with its values and label', () => {
    const other = bearing({ attributes: { ...bearing().attributes, seal: '2Z' } });
    expect(compareEquivalents(bearing(), other, LABELS)).toEqual({
      kind: 'WITH_DIFFERENCES',
      differences: [{ key: 'seal', label: 'Protección / sello', source: '2RS', other: '2Z' }],
    });
  });

  it('lists every differing key, in the compared order', () => {
    const other = bearing({ attributes: { ...bearing().attributes, cage: 'Poliamida', seal: '2Z', dynamicLoad: 15 } });
    const { differences } = compareEquivalents(bearing(), other, LABELS);
    expect(differences.map((d) => d.key)).toEqual(['seal', 'cage', 'dynamicLoad']);
  });

  it('compares each of the six keys', () => {
    for (const key of ['seal', 'internalClearance', 'toleranceClass', 'cage', 'dynamicLoad', 'staticLoad']) {
      const other = bearing({ attributes: { ...bearing().attributes, [key]: 'x' } });
      expect(compareEquivalents(bearing(), other).differences.map((d) => d.key)).toEqual([key]);
    }
  });

  it('ignores specifications that are not compared', () => {
    const other = bearing({ attributes: { ...bearing().attributes, lubricant: 'Grasa', supplierName: 'X' } });
    expect(compareEquivalents(bearing(), other).kind).toBe('EXACT');
  });

  it('counts a specification missing on one side as a difference, but not when missing on both', () => {
    const { seal: _seal, ...withoutSeal } = bearing().attributes;
    const other = bearing({ attributes: withoutSeal });
    expect(compareEquivalents(bearing(), other, LABELS).differences).toEqual([
      { key: 'seal', label: 'Protección / sello', source: '2RS', other: null },
    ]);
    expect(compareEquivalents(bearing({ attributes: withoutSeal }), other).kind).toBe('EXACT');
  });

  it('falls back to the key when there is no label', () => {
    const other = bearing({ attributes: { ...bearing().attributes, seal: '2Z' } });
    expect(compareEquivalents(bearing(), other).differences[0].label).toBe('seal');
  });

  it('is INCOMPATIBLE when the type differs', () => {
    expect(compareEquivalents(bearing(), bearing({ categoryId: 'rollers' })).kind).toBe('INCOMPATIBLE');
  });

  it.each([
    ['d', { innerDiameter: '30', outerDiameter: '52', width: '15' }],
    ['D', { innerDiameter: '25', outerDiameter: '62', width: '15' }],
    ['B', { innerDiameter: '25', outerDiameter: '52', width: '16' }],
  ])('is INCOMPATIBLE when %s differs', (_name, dimensions) => {
    expect(compareEquivalents(bearing(), bearing({ dimensions }))).toEqual({ kind: 'INCOMPATIBLE', differences: [] });
  });

  it('is INCOMPATIBLE when a product has no measures', () => {
    expect(compareEquivalents(bearing(), bearing({ dimensions: null })).kind).toBe('INCOMPATIBLE');
    expect(compareEquivalents(bearing({ dimensions: null }), bearing({ dimensions: null })).kind).toBe('INCOMPATIBLE');
  });

  it('compares measures as decimals: "25" equals "25.000" and a tapered T of 16.25 equals 16.250', () => {
    const same = bearing({ dimensions: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000' } });
    expect(compareEquivalents(bearing(), same).kind).toBe('EXACT');
    const tapered = bearing({ dimensions: { innerDiameter: '25', outerDiameter: '52', width: '16.25' } });
    const taperedSame = bearing({ dimensions: { innerDiameter: '25', outerDiameter: '52', width: '16.250' } });
    expect(compareEquivalents(tapered, taperedSame).kind).toBe('EXACT');
    expect(compareEquivalents(tapered, bearing()).kind).toBe('INCOMPATIBLE');
  });
});

describe('normalizePair', () => {
  it('stores the smaller id first, whatever the order given', () => {
    expect(normalizePair('b', 'a')).toEqual(['a', 'b']);
    expect(normalizePair('a', 'b')).toEqual(['a', 'b']);
  });

  it('orders uuids like Postgres (hex digits before letters)', () => {
    expect(normalizePair('0a000000-0000-0000-0000-000000000000', '09000000-0000-0000-0000-000000000000')[0]).toBe(
      '09000000-0000-0000-0000-000000000000',
    );
    expect(normalizePair('a0000000-0000-0000-0000-000000000000', '90000000-0000-0000-0000-000000000000')[0]).toBe(
      '90000000-0000-0000-0000-000000000000',
    );
  });
});
