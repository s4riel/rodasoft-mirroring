import { Decimal } from './money';
import {
  applyBulkAdjustment,
  BULK_PERCENT_MAX,
  parsePrice,
  PRICE_CHANGE_SOURCES,
  priceChangeDelta,
  validateBulkAdjustment,
  validatePriceEdit,
  type BulkAdjustment,
} from './pricing';

describe('parsePrice', () => {
  it.each([
    ['255', '255.00'],
    ['255.5', '255.50'],
    ['255,50', '255.50'],
    ['1.250,50', '1250.50'],
    ['0', '0.00'],
    [' 12.30 ', '12.30'],
  ])('reads %j as %s', (text, expected) => {
    expect(parsePrice(text)?.toString()).toBe(expected);
  });

  it.each(['', '   ', 'abc', '-1', '10.123', '1,2,3', '99999999999999', null, undefined])('refuses %j', (text) => {
    expect(parsePrice(text)).toBeNull();
  });
});

describe('validatePriceEdit', () => {
  it('accepts a new price above zero that differs from the current one', () => {
    const result = validatePriceEdit('245.00', '255');
    expect(result.ok && result.value.toString()).toBe('255.00');
    const lower = validatePriceEdit('245.00', '0.01');
    expect(lower.ok && lower.value.toString()).toBe('0.01');
  });

  it('gives a price to a product that had none', () => {
    expect(validatePriceEdit('0.00', '10').ok).toBe(true);
  });

  it.each(['0', '0.00', '-5', 'abc', '', '10.123', null, undefined])('answers INVALID_PRICE for %j', (next) => {
    expect(validatePriceEdit('245.00', next)).toEqual({ ok: false, error: 'INVALID_PRICE' });
  });

  it('answers PRICE_UNCHANGED for the same amount, however it is written', () => {
    expect(validatePriceEdit('245.00', '245')).toEqual({ ok: false, error: 'PRICE_UNCHANGED' });
    expect(validatePriceEdit('245.00', '245,00')).toEqual({ ok: false, error: 'PRICE_UNCHANGED' });
    expect(validatePriceEdit('245', '245.00')).toEqual({ ok: false, error: 'PRICE_UNCHANGED' });
  });
});

describe('priceChangeDelta', () => {
  it('gives the change in Bs and in percent of the old price', () => {
    expect(priceChangeDelta('245.00', '255.00')).toEqual({ amount: '10.00', percent: '4.1' });
    expect(priceChangeDelta('250.00', '240.00')).toEqual({ amount: '-10.00', percent: '-4.0' });
    expect(priceChangeDelta('100.00', '200.00')).toEqual({ amount: '100.00', percent: '100.0' });
  });

  it('rounds the percent to one decimal', () => {
    // 1 / 3 = 33.33… %
    expect(priceChangeDelta('3.00', '4.00').percent).toBe('33.3');
    // 2 / 3 = 66.66… %
    expect(priceChangeDelta('3.00', '5.00').percent).toBe('66.7');
    expect(priceChangeDelta('3.00', '1.00').percent).toBe('-66.7');
    expect(priceChangeDelta('1000.00', '1000.01').percent).toBe('0.0');
  });

  it('has no percent when the product had no price', () => {
    expect(priceChangeDelta('0.00', '50.00')).toEqual({ amount: '50.00', percent: null });
  });

  it('is zero for the same price', () => {
    expect(priceChangeDelta('10.00', '10.00')).toEqual({ amount: '0.00', percent: '0.0' });
  });
});

describe('PRICE_CHANGE_SOURCES', () => {
  it('names every path that changes a price', () => {
    expect(PRICE_CHANGE_SOURCES).toEqual(['MANUAL', 'PRODUCT_FORM', 'IMPORT', 'BULK']);
  });
});

describe('validateBulkAdjustment', () => {
  const valid = (direction: string, percent: string, rounding = 'NONE') => validateBulkAdjustment({ direction, percent, rounding });

  it('accepts a direction, a percent above zero and a rounding mode', () => {
    const result = valid('INCREASE', '5');
    expect(result.ok && result.value.percent.toString()).toBe('5.00');
    expect(result.ok && result.value.direction).toBe('INCREASE');
    const comma = valid('DECREASE', ' 2,5 ', 'HALF_BOLIVIANO');
    expect(comma.ok && comma.value.percent.toString()).toBe('2.50');
    expect(comma.ok && comma.value.rounding).toBe('HALF_BOLIVIANO');
  });

  it('lets an increase reach the maximum and refuses more', () => {
    expect(valid('INCREASE', String(BULK_PERCENT_MAX)).ok).toBe(true);
    expect(valid('INCREASE', '1000.01')).toEqual({ ok: false, error: 'INVALID_PERCENT' });
    expect(valid('INCREASE', '1001')).toEqual({ ok: false, error: 'INVALID_PERCENT' });
  });

  it('keeps a decrease below 100 %', () => {
    expect(valid('DECREASE', '99.99').ok).toBe(true);
    expect(valid('DECREASE', '100')).toEqual({ ok: false, error: 'INVALID_PERCENT' });
    expect(valid('DECREASE', '150')).toEqual({ ok: false, error: 'INVALID_PERCENT' });
  });

  it.each(['0', '0.00', '-5', '', '   ', 'abc', '5.123', '1,2,3', '5%'])('refuses the percent %j', (percent) => {
    expect(valid('INCREASE', percent)).toEqual({ ok: false, error: 'INVALID_PERCENT' });
  });

  it('refuses an unknown direction or rounding', () => {
    expect(valid('UP', '5')).toEqual({ ok: false, error: 'INVALID_DIRECTION' });
    expect(validateBulkAdjustment({ direction: null, percent: '5', rounding: 'NONE' })).toEqual({ ok: false, error: 'INVALID_DIRECTION' });
    expect(valid('INCREASE', '5', 'CEIL')).toEqual({ ok: false, error: 'INVALID_ROUNDING' });
    expect(validateBulkAdjustment({ direction: 'INCREASE', percent: '5', rounding: undefined })).toEqual({ ok: false, error: 'INVALID_ROUNDING' });
  });
});

describe('applyBulkAdjustment', () => {
  const adjust = (direction: BulkAdjustment['direction'], percent: string, rounding: BulkAdjustment['rounding'] = 'NONE'): BulkAdjustment => ({
    direction,
    percent: Decimal.of(percent),
    rounding,
  });
  const newPriceOf = (price: string, adjustment: BulkAdjustment) => {
    const result = applyBulkAdjustment(price, adjustment);
    return 'newPrice' in result ? result.newPrice.toString() : result.skipped;
  };

  it('adds or takes off the percent of the price', () => {
    expect(newPriceOf('245.00', adjust('INCREASE', '5'))).toBe('257.25');
    expect(newPriceOf('245.00', adjust('DECREASE', '10'))).toBe('220.50');
    expect(newPriceOf('100.00', adjust('INCREASE', '1000'))).toBe('1100.00');
  });

  it('rounds the percent half up to the cent, so the result always has 2 decimals', () => {
    // 3.33 x 0.5 % = 0.01665 -> 0.02
    expect(newPriceOf('3.33', adjust('INCREASE', '0.5'))).toBe('3.35');
    // 10.05 x 33.33 % = 3.349665 -> 3.35
    expect(newPriceOf('10.05', adjust('INCREASE', '33.33'))).toBe('13.40');
  });

  it('rounds the new price with the mode of the batch', () => {
    expect(newPriceOf('245.00', adjust('INCREASE', '5', 'HALF_BOLIVIANO'))).toBe('257.50');
    expect(newPriceOf('245.00', adjust('INCREASE', '5', 'INTEGER'))).toBe('257.00');
    expect(newPriceOf('245.00', adjust('DECREASE', '5', 'INTEGER'))).toBe('233.00');
  });

  it('skips a price that does not move once rounded', () => {
    expect(newPriceOf('100.00', adjust('INCREASE', '1', 'INTEGER'))).toBe('101.00');
    expect(newPriceOf('20.00', adjust('INCREASE', '1', 'INTEGER'))).toBe('UNCHANGED');
    expect(newPriceOf('20.00', adjust('DECREASE', '1', 'HALF_BOLIVIANO'))).toBe('UNCHANGED');
  });

  it('skips a product without a price and one the adjustment would take to zero', () => {
    expect(newPriceOf('0.00', adjust('INCREASE', '10'))).toBe('INVALID');
    expect(newPriceOf('0.40', adjust('DECREASE', '99.99', 'INTEGER'))).toBe('INVALID');
    // 99.99 % of Bs 1.00 rounds to the whole price at the cent, which leaves nothing
    expect(newPriceOf('1.00', adjust('DECREASE', '99.99'))).toBe('INVALID');
    expect(newPriceOf('100.00', adjust('DECREASE', '99.99'))).toBe('0.01');
  });

  it('accepts a Decimal as the price', () => {
    const result = applyBulkAdjustment(Decimal.of('245.00'), adjust('INCREASE', '5'));
    expect('newPrice' in result && result.newPrice.toString()).toBe('257.25');
  });
});
