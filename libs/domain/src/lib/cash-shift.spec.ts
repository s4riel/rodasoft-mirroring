import { CASH_SHIFT_REF_TYPE, floatMatchesLastClose, validateOpeningFloat } from './cash-shift';
import { Decimal } from './money';

describe('validateOpeningFloat', () => {
  it.each([
    ['500,00', '500.00'],
    ['500.00', '500.00'],
    ['500', '500.00'],
    ['0', '0.00'],
    ['0,5', '0.50'],
    ['1.500,50', '1500.50'],
    ['  250,75 ', '250.75'],
  ])('accepts %j as %s', (text, expected) => {
    const result = validateOpeningFloat(text);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.toString()).toBe(expected);
  });

  it.each([
    ['', 'REQUIRED'],
    ['   ', 'REQUIRED'],
    [null, 'REQUIRED'],
    [undefined, 'REQUIRED'],
    ['-1', 'NEGATIVE'],
    ['-0,50', 'NEGATIVE'],
    ['abc', 'INVALID_FORMAT'],
    ['12,3,4', 'INVALID_FORMAT'],
    ['1e3', 'INVALID_FORMAT'],
    ['500,', 'INVALID_FORMAT'],
    ['500,123', 'TOO_MANY_DECIMALS'],
    ['0.001', 'TOO_MANY_DECIMALS'],
    ['10000000000', 'TOO_LARGE'],
  ])('rejects %j with %s', (text, error) => {
    expect(validateOpeningFloat(text)).toEqual({ ok: false, error });
  });

  it('accepts the largest amount the column holds', () => {
    expect(validateOpeningFloat('9999999999,99').ok).toBe(true);
  });
});

describe('floatMatchesLastClose', () => {
  it('matches when there is no previous close', () => {
    expect(floatMatchesLastClose(Decimal.of('500.00'), null)).toBe(true);
  });

  it('matches an equal float', () => {
    expect(floatMatchesLastClose(Decimal.of('500.00'), Decimal.of('500'))).toBe(true);
  });

  it('does not match a different float', () => {
    expect(floatMatchesLastClose(Decimal.of('450.00'), Decimal.of('500.00'))).toBe(false);
  });
});

describe('CASH_SHIFT_REF_TYPE', () => {
  it('names the cash shift entity', () => {
    expect(CASH_SHIFT_REF_TYPE).toBe('CASH_SHIFT');
  });
});
