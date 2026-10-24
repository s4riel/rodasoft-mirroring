import {
  buildDuplicate,
  equivalencePairsForCopy,
  clampPage,
  clampPageSize,
  summarizeSpecs,
  DEFAULT_COPY_PARTS,
  DuplicateSource,
  formatSku,
  fieldIconOf,
  hasActiveFilters,
  isSellable,
  marginPercent,
  parseSkuNumber,
  parseMeasurement,
  PRODUCT_PAGE_SIZE_DEFAULT,
  PRODUCT_PAGE_SIZE_MAX,
  stockAvailability,
} from './product-catalog';

describe('parseMeasurement', () => {
  it('reads d × D × B in several spellings', () => {
    const expected = { innerDiameter: '25', outerDiameter: '52', width: '15' };
    expect(parseMeasurement('25x52x15')).toEqual(expected);
    expect(parseMeasurement(' 25 × 52 × 15 mm ')).toEqual(expected);
    expect(parseMeasurement('25*52*15')).toEqual(expected);
    expect(parseMeasurement('17,5x40x12')).toEqual({ innerDiameter: '17.5', outerDiameter: '40', width: '12' });
  });

  it('returns null for anything else', () => {
    expect(parseMeasurement('6205-2RS')).toBeNull();
    expect(parseMeasurement('25x52')).toBeNull();
    expect(parseMeasurement('')).toBeNull();
  });
});

describe('product catalog rules', () => {
  it('clamps the page size to the allowed range', () => {
    expect(clampPageSize(undefined)).toBe(PRODUCT_PAGE_SIZE_DEFAULT);
    expect(clampPageSize(0)).toBe(PRODUCT_PAGE_SIZE_DEFAULT);
    expect(clampPageSize(NaN)).toBe(PRODUCT_PAGE_SIZE_DEFAULT);
    expect(clampPageSize(500)).toBe(PRODUCT_PAGE_SIZE_MAX);
    expect(clampPageSize(10.9)).toBe(10);
  });

  it('never returns a page below 1', () => {
    expect(clampPage(undefined)).toBe(1);
    expect(clampPage(-3)).toBe(1);
    expect(clampPage(4.7)).toBe(4);
  });

  it('detects active filters', () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ brandId: 'b' })).toBe(true);
    expect(hasActiveFilters({ status: 'ACTIVE' })).toBe(true);
    expect(hasActiveFilters({ search: '  ' })).toBe(false);
    expect(hasActiveFilters({ search: '6205' })).toBe(true);
  });
});

describe('SKU helpers', () => {
  it('formats and parses RL-000001', () => {
    expect(formatSku('RL-', 1)).toBe('RL-000001');
    expect(formatSku('RL-', 1234567)).toBe('RL-1234567');
    expect(parseSkuNumber('RL-000042', 'RL-')).toBe(42);
  });

  it('ignores SKUs that do not follow the pattern', () => {
    expect(parseSkuNumber('BULK-000001', 'RL-')).toBeNull();
    expect(parseSkuNumber('RL-12', 'RL-')).toBeNull();
    expect(parseSkuNumber('RL-ABC123', 'RL-')).toBeNull();
  });
});

describe('buildDuplicate', () => {
  const source: DuplicateSource = {
    name: 'Rodamiento 6205-2RS',
    categoryId: 'cat-1',
    unit: 'UN',
    salePrice: '120.50',
    cost: '70.0000',
    attributes: { seal: '2RS' },
    photos: ['a.jpg'],
    datasheetUrl: 'https://x/d.pdf',
    dimensions: { innerDiameter: '25', outerDiameter: '52', width: '15', weight: '0.13' },
  };
  const request = (copy: Parameters<typeof buildDuplicate>[1]['copy']) => ({
    manufacturerCode: ' 6205-2RS-B ',
    brandId: 'brand-2',
    countryId: 'jp',
    copy,
  });

  it('always copies name, category and unit and trims the new code', () => {
    const copy = buildDuplicate(source, request([]));
    expect(copy).toMatchObject({
      manufacturerCode: '6205-2RS-B',
      brandId: 'brand-2',
      countryId: 'jp',
      categoryId: 'cat-1',
      name: 'Rodamiento 6205-2RS',
      unit: 'UN',
    });
  });

  it('is a DRAFT without price and ACTIVE with it', () => {
    expect(buildDuplicate(source, request([])).status).toBe('DRAFT');
    expect(buildDuplicate(source, request(['dimensions', 'specifications'])).status).toBe('DRAFT');
    expect(buildDuplicate(source, request(['price'])).status).toBe('ACTIVE');
  });

  it('copies nothing else when no part is chosen', () => {
    expect(buildDuplicate(source, request([]))).toMatchObject({
      salePrice: '0.00',
      cost: null,
      attributes: {},
      photos: [],
      datasheetUrl: null,
      dimensions: null,
    });
  });

  it('copies each part independently', () => {
    expect(buildDuplicate(source, request(['price']))).toMatchObject({ salePrice: '120.50', cost: '70.0000', dimensions: null });
    expect(buildDuplicate(source, request(['specifications'])).attributes).toEqual({ seal: '2RS' });
    expect(buildDuplicate(source, request(['dimensions'])).dimensions).toEqual(source.dimensions);
    expect(buildDuplicate(source, request(['media']))).toMatchObject({ photos: ['a.jpg'], datasheetUrl: 'https://x/d.pdf' });
  });

  it('copies the default parts as in Figma and tolerates a source without dimensions', () => {
    const copy = buildDuplicate({ ...source, dimensions: null }, request([...DEFAULT_COPY_PARTS]));
    expect(copy.dimensions).toBeNull();
    expect(copy.salePrice).toBe('120.50');
    expect(copy.photos).toEqual([]);
  });
});

describe('isSellable', () => {
  it('only an active product can be sold', () => {
    expect(isSellable('ACTIVE')).toBe(true);
    expect(isSellable('INACTIVE')).toBe(false);
    expect(isSellable('DRAFT')).toBe(false);
  });
});

describe('stockAvailability', () => {
  it('is out at zero or below, low at the minimum or under, available above', () => {
    expect(stockAvailability(0, 6)).toBe('out');
    expect(stockAvailability(-2, null)).toBe('out');
    expect(stockAvailability(6, 6)).toBe('low');
    expect(stockAvailability(3, 6)).toBe('low');
    expect(stockAvailability(7, 6)).toBe('available');
  });

  it('never reports low without a minimum', () => {
    expect(stockAvailability(1, null)).toBe('available');
  });
});

describe('marginPercent', () => {
  it('computes (price − cost) / price with one decimal', () => {
    expect(marginPercent('100.00', '60.0000')).toBe('40.0');
    expect(marginPercent('245.00', '147.0000')).toBe('40.0');
    expect(marginPercent('120.50', '70.0000')).toBe('41.9');
  });

  it('is negative when the cost is above the price', () => {
    expect(marginPercent('10.00', '12.5000')).toBe('-25.0');
  });

  it('is null without cost or with a zero price', () => {
    expect(marginPercent('100.00', null)).toBeNull();
    expect(marginPercent('0.00', '5.0000')).toBeNull();
  });
});

describe('fieldIconOf', () => {
  it('maps each data type to its icon', () => {
    expect(fieldIconOf({ type: 'CODE' })).toBe('barcode');
    expect(fieldIconOf({ type: 'SKU' })).toBe('hash');
    expect(fieldIconOf({ type: 'MONEY' })).toBe('currency');
    expect(fieldIconOf({ type: 'PERCENT' })).toBe('percent');
    expect(fieldIconOf({ type: 'DATE' })).toBe('calendar');
    expect(fieldIconOf({ type: 'LOCATION' })).toBe('warehouse');
    expect(fieldIconOf({ type: 'ENUM' })).toBe('tag');
    expect(fieldIconOf({ type: 'TEXT' })).toBe('info');
    expect(fieldIconOf({ type: 'NUMBER' })).toBe('hash');
  });

  it('tells diameters, lengths and weights apart by unit', () => {
    expect(fieldIconOf({ type: 'NUMBER', unit: 'mm', key: 'innerDiameter' })).toBe('diameter');
    expect(fieldIconOf({ type: 'NUMBER', unit: 'mm', key: 'minRadius' })).toBe('diameter');
    expect(fieldIconOf({ type: 'NUMBER', unit: 'mm', key: 'width' })).toBe('ruler');
    expect(fieldIconOf({ type: 'NUMBER', unit: 'kg', key: 'weight' })).toBe('package');
  });
});

describe('summarizeSpecs', () => {
  const defs = [
    { key: 'innerDiameter', label: 'Ø Interior d', type: 'NUMBER' as const, unit: 'mm' },
    { key: 'seal', label: 'Protección / sello', type: 'ENUM' as const, unit: null },
    { key: 'dynamicLoad', label: 'Carga dinámica C', type: 'NUMBER' as const, unit: 'kN' },
    { key: 'sealed', label: 'Sellado', type: 'BOOLEAN' as const, unit: null },
    { key: 'technicalNotes', label: 'Observaciones técnicas', type: 'TEXT' as const, unit: null },
    { key: 'material', label: 'Material', type: 'TEXT' as const, unit: null },
  ];

  it('keeps the filled fields in definition order, with unit, leaving out the measures and empty values', () => {
    const attributes = { innerDiameter: 25, seal: '2RS', dynamicLoad: 14.8, sealed: true, technicalNotes: 'Uso intensivo', material: '  ' };
    expect(summarizeSpecs(defs, attributes)).toEqual([
      { label: 'Protección / sello', value: '2RS' },
      { label: 'Carga dinámica C', value: '14,8 kN' },
      { label: 'Sellado', value: 'Sí' },
      { label: 'Observaciones técnicas', value: 'Uso intensivo' },
    ]);
  });

  it('also keeps stored values whose field the category no longer defines, under the name of their key', () => {
    expect(summarizeSpecs(defs, { seal: '2RS', oldField: 'x', coating_type: 3, nested: { a: 1 }, flag: false })).toEqual([
      { label: 'Protección / sello', value: '2RS' },
      { label: 'Old field', value: 'x' },
      { label: 'Coating type', value: '3' },
      { label: 'Flag', value: 'No' },
    ]);
  });

  it('stops at the limit', () => {
    expect(summarizeSpecs(defs, { seal: 'a', dynamicLoad: 1, sealed: false }, { limit: 2 })).toHaveLength(2);
  });
});

describe('summarizeSpecs measures', () => {
  const defs = [
    { key: 'innerDiameter', label: 'Ø Interior d', type: 'NUMBER' as const, unit: 'mm' },
    { key: 'material', label: 'Material', type: 'TEXT' as const, unit: null },
  ];
  const attributes = { innerDiameter: 40, material: 'Goma' };

  it('keeps the measure fields of a product that has no measures of its own (a seal)', () => {
    expect(summarizeSpecs(defs, attributes, { hasMeasures: false })).toEqual([
      { label: 'Ø Interior d', value: '40 mm' },
      { label: 'Material', value: 'Goma' },
    ]);
    expect(summarizeSpecs(defs, attributes)).toEqual([{ label: 'Material', value: 'Goma' }]);
  });
});

describe('equivalencePairsForCopy', () => {
  it('pairs the copy with each equivalent in canonical order, without repeats or self links', () => {
    const pairs = equivalencePairsForCopy('m', ['z', 'a', 'a', 'm']);
    expect(pairs).toEqual([
      ['m', 'z'],
      ['a', 'm'],
    ]);
  });

  it('is empty when the source has no equivalents', () => {
    expect(equivalencePairsForCopy('m', [])).toEqual([]);
  });
});
