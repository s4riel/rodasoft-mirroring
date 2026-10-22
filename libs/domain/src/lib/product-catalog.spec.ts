import { clampPage, clampPageSize, hasActiveFilters, PRODUCT_PAGE_SIZE_DEFAULT, PRODUCT_PAGE_SIZE_MAX } from './product-catalog';

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
  });
});
