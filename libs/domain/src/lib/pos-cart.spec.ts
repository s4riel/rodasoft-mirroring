import { Decimal } from './money';
import { brandInitials, cartTotals, lineTotal, maxSellable, stockStatus } from './pos-cart';

describe('lineTotal', () => {
  it('multiplies the unit price by the quantity, exactly', () => {
    expect(lineTotal('245.00', 2).toString()).toBe('490.00');
    expect(lineTotal(Decimal.of('0.10'), 3).toString()).toBe('0.30');
  });

  it('refuses a negative or fractional quantity', () => {
    expect(() => lineTotal('1.00', -1)).toThrow();
    expect(() => lineTotal('1.00', 1.5)).toThrow();
  });
});

describe('cartTotals', () => {
  it('adds the lines without floating point errors (3 × 0,10 = 0,30)', () => {
    const t = cartTotals([{ unitPrice: '0.10', quantity: 3 }], { roundingMode: 'NONE' });
    expect(t.subtotal.toString()).toBe('0.30');
    expect(t.discount.toString()).toBe('0.00');
    expect(t.total.toString()).toBe('0.30');
  });

  it('sums several lines', () => {
    const t = cartTotals(
      [
        { unitPrice: '245.00', quantity: 2 },
        { unitPrice: '380.00', quantity: 1 },
        { unitPrice: '260.00', quantity: 1 },
      ],
      { roundingMode: 'NONE' },
    );
    expect(t.subtotal.toString()).toBe('1130.00');
    expect(t.total.toString()).toBe('1130.00');
  });

  it('is zero for an empty cart', () => {
    expect(cartTotals([], { roundingMode: 'INTEGER' }).total.toString()).toBe('0.00');
  });

  it('applies the customer discount and then the rounding', () => {
    const t = cartTotals([{ unitPrice: '100.30', quantity: 1 }], {
      discount: { type: 'PERCENT', value: '10' },
      roundingMode: 'HALF_BOLIVIANO',
    });
    expect(t.subtotal.toString()).toBe('100.30');
    expect(t.discount.toString()).toBe('10.03');
    // 90.27 → 90.50
    expect(t.total.toString()).toBe('90.50');
  });

  it('never goes below 0: a fixed discount larger than the sale takes only the sale (HU-VEN-37)', () => {
    const t = cartTotals([{ unitPrice: '40.00', quantity: 1 }], { discount: { type: 'AMOUNT', value: '100.00' }, roundingMode: 'NONE' });
    expect(t.discount.toString()).toBe('40.00');
    expect(t.total.toString()).toBe('0.00');
  });

  it('takes a fixed amount off the whole sale, not off each line', () => {
    const t = cartTotals(
      [
        { unitPrice: '50.00', quantity: 2 },
        { unitPrice: '30.00', quantity: 1 },
      ],
      { discount: { type: 'AMOUNT', value: '15.00' }, roundingMode: 'NONE' },
    );
    expect(t.discount.toString()).toBe('15.00');
    expect(t.total.toString()).toBe('115.00');
  });
});

describe('stockStatus', () => {
  it('is out with nothing available', () => {
    expect(stockStatus(0, 5)).toBe('out');
    expect(stockStatus(-2, null)).toBe('out');
  });

  it('is low at or under the minimum, ok above it or without one', () => {
    expect(stockStatus(3, 5)).toBe('low');
    expect(stockStatus(5, 5)).toBe('low');
    expect(stockStatus(6, 5)).toBe('ok');
    expect(stockStatus(1, null)).toBe('ok');
  });
});

describe('maxSellable', () => {
  it('is the available stock, never below zero', () => {
    expect(maxSellable(24, false)).toBe(24);
    expect(maxSellable(-3, false)).toBe(0);
  });

  it('has no limit with negative stock allowed', () => {
    expect(maxSellable(0, true)).toBeNull();
  });
});

describe('brandInitials', () => {
  it('takes the first two letters', () => {
    expect(brandInitials('SKF')).toBe('SK');
    expect(brandInitials('Fersa')).toBe('FE');
    expect(brandInitials('A-1 Bearings')).toBe('A1');
  });
});
