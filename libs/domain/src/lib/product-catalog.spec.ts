import {
  clampPage,
  clampPageSize,
  hasActiveFilters,
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
