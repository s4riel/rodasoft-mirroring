import { Decimal } from './money';
import { applyCustomerDiscount, roundSaleTotal } from './sales-pricing';

const d = (v: string) => Decimal.of(v);

describe('applyCustomerDiscount', () => {
  it('takes a percent of the total', () => {
    const r = applyCustomerDiscount(d('200.00'), 'PERCENT', '10');
    expect(r.discountAmount.toString()).toBe('20.00');
    expect(r.totalAfterDiscount.toString()).toBe('180.00');
  });

  it('rounds a percent discount half up to the cent', () => {
    // 12.5 % of 99.99 = 12.49875
    expect(applyCustomerDiscount(d('99.99'), 'PERCENT', '12.5').discountAmount.toString()).toBe('12.50');
    // 5 % of 10.10 = 0.505
    expect(applyCustomerDiscount(d('10.10'), 'PERCENT', '5').discountAmount.toString()).toBe('0.51');
  });

  it('takes a fixed amount off the whole sale', () => {
    const r = applyCustomerDiscount(d('150.00'), 'AMOUNT', '25.50');
    expect(r.discountAmount.toString()).toBe('25.50');
    expect(r.totalAfterDiscount.toString()).toBe('124.50');
  });

  it('does nothing without a discount', () => {
    const r = applyCustomerDiscount(d('150.00'), 'NONE', '99');
    expect(r.discountAmount.toString()).toBe('0.00');
    expect(r.totalAfterDiscount.toString()).toBe('150.00');
  });

  it('never goes below zero: a fixed amount above the total takes the whole total', () => {
    const r = applyCustomerDiscount(d('30.00'), 'AMOUNT', '50.00');
    expect(r.discountAmount.toString()).toBe('30.00');
    expect(r.totalAfterDiscount.toString()).toBe('0.00');
  });

  it('never goes below zero: a percent above 100 takes the whole total', () => {
    expect(applyCustomerDiscount(d('30.00'), 'PERCENT', '150').totalAfterDiscount.toString()).toBe('0.00');
  });

  it('handles a zero total and the 100 percent boundary', () => {
    expect(applyCustomerDiscount(d('0.00'), 'PERCENT', '10').totalAfterDiscount.toString()).toBe('0.00');
    expect(applyCustomerDiscount(d('80.00'), 'PERCENT', '100').totalAfterDiscount.toString()).toBe('0.00');
  });

  it('refuses a negative discount or total', () => {
    expect(() => applyCustomerDiscount(d('10.00'), 'AMOUNT', '-1')).toThrow();
    expect(() => applyCustomerDiscount(d('-10.00'), 'NONE', '0')).toThrow();
  });
});

describe('roundSaleTotal', () => {
  const round = (total: string, mode: Parameters<typeof roundSaleTotal>[1]) => {
    const r = roundSaleTotal(d(total), mode);
    return [r.total.toString(), r.roundingAmount.toString()];
  };

  it('keeps the total as it is with NONE', () => {
    expect(round('10.37', 'NONE')).toEqual(['10.37', '0.00']);
  });

  it('rounds to the nearest boliviano with INTEGER, half up', () => {
    expect(round('10.49', 'INTEGER')).toEqual(['10.00', '-0.49']);
    expect(round('10.50', 'INTEGER')).toEqual(['11.00', '0.50']);
    expect(round('10.25', 'INTEGER')).toEqual(['10.00', '-0.25']);
    expect(round('10.75', 'INTEGER')).toEqual(['11.00', '0.25']);
  });

  it('rounds to the nearest Bs 0.50 with HALF_BOLIVIANO, half up', () => {
    expect(round('10.24', 'HALF_BOLIVIANO')).toEqual(['10.00', '-0.24']);
    expect(round('10.25', 'HALF_BOLIVIANO')).toEqual(['10.50', '0.25']);
    expect(round('10.50', 'HALF_BOLIVIANO')).toEqual(['10.50', '0.00']);
    expect(round('10.74', 'HALF_BOLIVIANO')).toEqual(['10.50', '-0.24']);
    expect(round('10.75', 'HALF_BOLIVIANO')).toEqual(['11.00', '0.25']);
  });

  it('leaves an exact total untouched and handles zero', () => {
    expect(round('12.00', 'INTEGER')).toEqual(['12.00', '0.00']);
    expect(round('0.00', 'HALF_BOLIVIANO')).toEqual(['0.00', '0.00']);
  });
});
