import { parsePrice, PRICE_CHANGE_SOURCES, priceChangeDelta, validatePriceEdit } from './pricing';

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
