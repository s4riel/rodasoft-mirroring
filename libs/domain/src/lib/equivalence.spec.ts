import {
  buildEquivalenceComparison,
  compareEquivalents,
  EQUIVALENCE_COMPARE_MAX,
  EQUIVALENCE_COMPARE_MIN,
  EquivalenceCompareDefinition,
  EquivalenceCompareProduct,
  EquivalenceComparable,
  isTaperedCategory,
  normalizePair,
} from './equivalence';

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

describe('buildEquivalenceComparison', () => {
  const DEFS: EquivalenceCompareDefinition[] = [
    { key: 'minRadius', label: 'Radio mínimo r', type: 'NUMBER', unit: 'mm' },
    { key: 'cage', label: 'Material de la jaula', type: 'ENUM', unit: null },
    { key: 'seal', label: 'Protección / sello', type: 'ENUM', unit: null },
    { key: 'dynamicLoad', label: 'Carga dinámica C', type: 'NUMBER', unit: 'kN' },
  ];
  const item = (productId: string, over: Partial<EquivalenceCompareProduct> = {}): EquivalenceCompareProduct => ({
    ...bearing(),
    productId,
    tapered: false,
    country: 'Suecia',
    ...over,
  });
  const row = (grid: ReturnType<typeof buildEquivalenceComparison>, key: string) => grid.rows.find((r) => r.key === key);

  it('limits the comparison to 2-4 products', () => {
    expect([EQUIVALENCE_COMPARE_MIN, EQUIVALENCE_COMPARE_MAX]).toEqual([2, 4]);
  });

  it('lists the three measures and the industry first, then the compared keys, then the other fields', () => {
    const grid = buildEquivalenceComparison([item('a'), item('b')], DEFS);
    expect(grid.rows.map((r) => r.key)).toEqual(['innerDiameter', 'outerDiameter', 'width', 'country', 'seal', 'cage', 'dynamicLoad', 'minRadius']);
    expect(grid.rows.map((r) => r.group)).toEqual(['MEASURES', 'MEASURES', 'MEASURES', 'SPECS', 'SPECS', 'SPECS', 'SPECS', 'SPECS']);
  });

  it('gives one value per product, in the order given, with the unit and label of the definition', () => {
    const grid = buildEquivalenceComparison(
      [item('a'), item('b', { attributes: { ...bearing().attributes, seal: '2Z' } }), item('c', { attributes: {} })],
      DEFS,
    );
    expect(row(grid, 'seal')).toMatchObject({ label: 'Protección / sello', values: ['2RS', '2Z', null] });
    expect(row(grid, 'dynamicLoad')).toMatchObject({ unit: 'kN', values: ['14,8', '14,8', null] });
    expect(grid.columns.map((c) => c.productId)).toEqual(['a', 'b', 'c']);
  });

  it('marks a row as differing when any two values differ', () => {
    const grid = buildEquivalenceComparison(
      [item('a'), item('b'), item('c', { attributes: { ...bearing().attributes, cage: 'Poliamida' } })],
      DEFS,
    );
    expect(row(grid, 'cage')?.differs).toBe(true);
    expect(row(grid, 'seal')?.differs).toBe(false);
    expect(row(grid, 'country')?.differs).toBe(false);
  });

  it('treats "25" and "25.000", and 14.8 and "14.80", as equal', () => {
    const grid = buildEquivalenceComparison(
      [
        item('a'),
        item('b', {
          dimensions: { innerDiameter: '25.000', outerDiameter: '52.000', width: '15.000' },
          attributes: { ...bearing().attributes, dynamicLoad: '14.80' },
        }),
      ],
      DEFS,
    );
    expect(grid.rows.filter((r) => r.differs)).toEqual([]);
  });

  it('differs when a value is missing on one side and is equal when it is missing on all', () => {
    const grid = buildEquivalenceComparison(
      [item('a', { attributes: { seal: '2RS' } }), item('b', { attributes: {} })],
      DEFS,
    );
    expect(row(grid, 'seal')?.differs).toBe(true);
    expect(row(grid, 'minRadius')).toMatchObject({ values: [null, null], differs: false });
  });

  it('flags a different measure and marks that column INCOMPATIBLE', () => {
    const other = item('b', { dimensions: { innerDiameter: '25', outerDiameter: '62', width: '15' } });
    const grid = buildEquivalenceComparison([item('a'), other], DEFS);
    expect(row(grid, 'outerDiameter')).toMatchObject({ values: ['52', '62'], differs: true });
    expect(grid.columns[1].kind).toBe('INCOMPATIBLE');
  });

  it('compares every column with the first: the reference is EXACT, the others carry their differences', () => {
    const grid = buildEquivalenceComparison(
      [
        item('a'),
        item('b', { attributes: { ...bearing().attributes, seal: '2Z' } }),
        item('c'),
        item('d', { attributes: { ...bearing().attributes, cage: 'Poliamida', seal: '2Z' } }),
      ],
      DEFS,
    );
    expect(grid.columns.map((c) => c.kind)).toEqual(['EXACT', 'WITH_DIFFERENCES', 'EXACT', 'WITH_DIFFERENCES']);
    expect(grid.columns[0].differences).toEqual([]);
    expect(grid.columns[3].differences.map((d) => d.key)).toEqual(['seal', 'cage']);
  });

  it('labels the width B, T when every product is tapered, and B / T when they are mixed', () => {
    const width = (items: EquivalenceCompareProduct[]) => row(buildEquivalenceComparison(items, DEFS), 'width')?.label;
    expect(width([item('a'), item('b')])).toBe('B');
    expect(width([item('a', { tapered: true }), item('b', { tapered: true })])).toBe('T');
    expect(width([item('a', { tapered: true }), item('b')])).toBe('B / T');
  });

  it('shows missing dimensions as no value', () => {
    const grid = buildEquivalenceComparison([item('a'), item('b', { dimensions: null })], DEFS);
    expect(row(grid, 'width')).toMatchObject({ values: ['15', null], differs: true });
  });
});

describe('isTaperedCategory', () => {
  it('recognizes the tapered roller category', () => {
    expect(isTaperedCategory('Rodillos cónicos')).toBe(true);
    expect(isTaperedCategory('Rodillos conicos')).toBe(true);
    expect(isTaperedCategory('Rígidos de bolas')).toBe(false);
  });
});
