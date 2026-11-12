import { Decimal } from './money';
import { brandInitials, cartTotals, isSameLineSet, lineTotal, maxSellable, moveLine, stockStatus } from './pos-cart';

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

describe('cartTotals · rounding (HU-VEN-35)', () => {
  const lines = [{ unitPrice: '10.30', quantity: 1 }];

  it('is zero with NONE', () => {
    expect(cartTotals(lines, { roundingMode: 'NONE' }).rounding.toString()).toBe('0.00');
  });

  it('is the signed difference to the rounded total, without a discount', () => {
    const half = cartTotals(lines, { roundingMode: 'HALF_BOLIVIANO' });
    expect(half.total.toString()).toBe('10.50');
    expect(half.rounding.toString()).toBe('0.20');
    const integer = cartTotals(lines, { roundingMode: 'INTEGER' });
    expect(integer.total.toString()).toBe('10.00');
    expect(integer.rounding.toString()).toBe('-0.30');
  });

  it('keeps subtotal − discount + rounding = total with a discount', () => {
    const t = cartTotals([{ unitPrice: '100.00', quantity: 1 }], {
      roundingMode: 'HALF_BOLIVIANO',
      discount: { type: 'PERCENT', value: '3.33' },
    });
    expect(t.discount.toString()).toBe('3.33');
    expect(t.rounding.toString()).toBe('-0.17');
    expect(t.subtotal.sub(t.discount).add(t.rounding).toString()).toBe(t.total.toString());
  });
});

describe('moveLine', () => {
  it('moves a line to a new position', () => {
    expect(moveLine(['a', 'b', 'c', 'd'], 2, 0)).toEqual(['c', 'a', 'b', 'd']);
    expect(moveLine(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('returns an equal copy when nothing moves or an index is out of range', () => {
    const ids = ['a', 'b', 'c'];
    for (const [from, to] of [[1, 1], [-1, 0], [0, 5], [1.5, 0]]) {
      const result = moveLine(ids, from, to);
      expect(result).toEqual(ids);
      expect(result).not.toBe(ids);
    }
  });
});

describe('isSameLineSet', () => {
  it('accepts the same ids in any order', () => {
    expect(isSameLineSet(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(isSameLineSet([], [])).toBe(true);
  });

  it('refuses a missing, extra, foreign or repeated id', () => {
    expect(isSameLineSet(['a', 'b'], ['a'])).toBe(false);
    expect(isSameLineSet(['a'], ['a', 'b'])).toBe(false);
    expect(isSameLineSet(['a', 'b'], ['a', 'x'])).toBe(false);
    expect(isSameLineSet(['a', 'b'], ['a', 'a'])).toBe(false);
    expect(isSameLineSet(['a', 'a'], ['a', 'a'])).toBe(false);
  });
});
