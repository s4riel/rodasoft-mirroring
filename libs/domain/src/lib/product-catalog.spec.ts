import {
  buildDuplicate,
  clampPage,
  clampPageSize,
  DEFAULT_COPY_PARTS,
  DuplicateSource,
  formatSku,
  hasActiveFilters,
  parseSkuNumber,
  parseMeasurement,
  PRODUCT_PAGE_SIZE_DEFAULT,
  PRODUCT_PAGE_SIZE_MAX,
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

  it('always copies name, category and unit, trims the new code and starts ACTIVE', () => {
    const copy = buildDuplicate(source, request([]));
    expect(copy).toMatchObject({
      manufacturerCode: '6205-2RS-B',
      brandId: 'brand-2',
      countryId: 'jp',
      categoryId: 'cat-1',
      name: 'Rodamiento 6205-2RS',
      unit: 'UN',
      status: 'ACTIVE',
    });
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
