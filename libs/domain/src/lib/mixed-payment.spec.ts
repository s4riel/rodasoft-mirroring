import { Decimal } from './money';
import { isPartialAmount, mixedRemaining, suggestRemainder, validateMixedPayments, type MixedLine } from './mixed-payment';

const d = (value: string) => Decimal.of(value);
const cash = (amount: string): MixedLine => ({ method: 'CASH', amount: d(amount) });
const qr = (amount: string): MixedLine => ({ method: 'QR', amount: d(amount) });

describe('mixedRemaining', () => {
  it('is the total minus what the lines cover', () => {
    expect(mixedRemaining(d('1000.00'), [qr('700.00')]).toString()).toBe('300.00');
    expect(mixedRemaining(d('1000.00'), [])).toEqual(d('1000.00'));
  });

  it('is 0 when covered, and never negative when over-covered', () => {
    expect(mixedRemaining(d('1000.00'), [qr('700.00'), cash('300.00')]).isZero()).toBe(true);
    expect(mixedRemaining(d('1000.00'), [qr('700.00'), cash('500.00')]).isZero()).toBe(true);
  });

  it('suggests the remainder for the last line', () => {
    expect(suggestRemainder(d('1000.00'), [qr('250.50')]).toString()).toBe('749.50');
  });
});

describe('validateMixedPayments', () => {
  const total = d('1000.00');

  it('accepts cash plus QR that cover the total exactly', () => {
    const result = validateMixedPayments(total, [qr('700.00'), cash('300.00')], true);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.change.isZero()).toBe(true);
      expect(result.cashDue.toString()).toBe('300.00');
    }
  });

  it('gives the change on the cash line only', () => {
    const result = validateMixedPayments(total, [qr('700.00'), cash('500.00')], true);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.change.toString()).toBe('200.00');
  });

  it('refuses when the setting is off', () => {
    expect(validateMixedPayments(total, [qr('700.00'), cash('300.00')], false)).toEqual({
      ok: false,
      error: 'MIXED_PAYMENT_DISABLED',
    });
  });

  it('refuses cash that does not cover what the QR leaves', () => {
    expect(validateMixedPayments(total, [qr('700.00'), cash('299.99')], true)).toEqual({ ok: false, error: 'PAYMENT_NOT_COVERED' });
  });

  it('refuses a QR that covers everything or more: nothing is left for the cash', () => {
    expect(validateMixedPayments(total, [qr('1000.00'), cash('10.00')], true)).toEqual({ ok: false, error: 'PAYMENT_NOT_COVERED' });
    expect(validateMixedPayments(total, [qr('1200.00'), cash('10.00')], true)).toEqual({ ok: false, error: 'PAYMENT_NOT_COVERED' });
  });

  it('refuses the same method twice', () => {
    expect(validateMixedPayments(total, [qr('300.00'), qr('700.00')], true)).toEqual({
      ok: false,
      error: 'PAYMENT_DUPLICATE_METHOD',
    });
  });

  it('refuses a zero or negative amount', () => {
    expect(validateMixedPayments(total, [qr('0.00'), cash('1000.00')], true)).toEqual({ ok: false, error: 'PAYMENT_INVALID_AMOUNT' });
    expect(validateMixedPayments(total, [qr('-5.00'), cash('1000.00')], true)).toEqual({ ok: false, error: 'PAYMENT_INVALID_AMOUNT' });
  });

  it('refuses methods that cannot be mixed yet', () => {
    expect(
      validateMixedPayments(total, [{ method: 'CARD', amount: d('500.00') }, cash('500.00')], true),
    ).toEqual({ ok: false, error: 'PAYMENT_METHOD_NOT_AVAILABLE' });
  });

  it('is not a mix with a single line', () => {
    expect(validateMixedPayments(total, [cash('1000.00')], true)).toEqual({ ok: false, error: 'PAYMENT_NOT_COVERED' });
  });
});

describe('isPartialAmount', () => {
  it('is true only above 0 and below the total', () => {
    const total = d('100.00');
    expect(isPartialAmount(total, d('0.01'))).toBe(true);
    expect(isPartialAmount(total, d('99.99'))).toBe(true);
    expect(isPartialAmount(total, d('100.00'))).toBe(false);
    expect(isPartialAmount(total, d('0.00'))).toBe(false);
    expect(isPartialAmount(total, d('150.00'))).toBe(false);
  });
});
