import { SALE_PAGE_SIZE_DEFAULT, SALE_PAGE_SIZE_MAX, SALE_STATUSES, saleItemsCount } from './sale-history';

describe('sale history', () => {
  it('counts the units, not the lines', () => {
    expect(saleItemsCount([{ quantity: 3 }, { quantity: 5 }])).toBe(8);
    expect(saleItemsCount([])).toBe(0);
  });

  it('keeps the page size inside its bounds', () => {
    expect(SALE_PAGE_SIZE_DEFAULT).toBeLessThanOrEqual(SALE_PAGE_SIZE_MAX);
  });

  it('lists the statuses of the sale machine', () => {
    expect(SALE_STATUSES).toEqual(['COMPLETED', 'CANCELLATION_PENDING', 'CANCELLED']);
  });
});
