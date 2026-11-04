import { cashChange, paymentsCover, suggestCashAmounts, validateCashTendered } from './cash-payment';
import { Decimal } from './money';

const d = (value: string) => Decimal.of(value);

describe('cashChange', () => {
  it('is received minus total', () => {
    expect(cashChange(d('1111.00'), d('1200.00')).toString()).toBe('89.00');
  });

  it('is zero for the exact amount', () => {
    expect(cashChange(d('1111.00'), d('1111.00')).toString()).toBe('0.00');
  });

  it('never goes below zero', () => {
    expect(cashChange(d('50.00'), d('20.00')).toString()).toBe('0.00');
  });

  it('keeps the cents exact', () => {
    expect(cashChange(d('99.90'), d('100.00')).toString()).toBe('0.10');
    expect(cashChange(d('0.10'), d('0.30')).toString()).toBe('0.20');
  });
});

describe('validateCashTendered', () => {
  const total = d('1111.00');

  it('accepts more than the total and returns the change', () => {
    const result = validateCashTendered(total, '1.200,00');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.received.toString()).toBe('1200.00');
      expect(result.change.toString()).toBe('89.00');
    }
  });

  it('accepts the exact total and the API format', () => {
    expect(validateCashTendered(total, '1111.00')).toMatchObject({ ok: true });
    expect(validateCashTendered(total, '1111,00')).toMatchObject({ ok: true });
  });

  it('refuses less than the total', () => {
    expect(validateCashTendered(total, '1110,99')).toEqual({ ok: false, error: 'INSUFFICIENT_CASH' });
  });

  it.each(['', '   ', null, undefined, 'abc', '-5', '12,3,4', '1200,123'])('refuses %j as an invalid amount', (text) => {
    expect(validateCashTendered(total, text)).toEqual({ ok: false, error: 'INVALID_AMOUNT' });
  });

  it('refuses an amount the column cannot hold', () => {
    expect(validateCashTendered(total, '99999999999999')).toEqual({ ok: false, error: 'AMOUNT_TOO_LARGE' });
  });

  it('accepts zero for a zero total', () => {
    expect(validateCashTendered(d('0.00'), '0')).toMatchObject({ ok: true });
  });
});

describe('suggestCashAmounts', () => {
  const text = (total: string) => suggestCashAmounts(d(total)).map((a) => a.toString());

  it('gives the next multiples of 50, 100 and 500', () => {
    expect(text('1111.00')).toEqual(['1150.00', '1200.00', '1500.00']);
  });

  it('is always above the total, also when the total is a multiple', () => {
    expect(text('1100.00')).toEqual(['1150.00', '1200.00', '1500.00']);
  });

  it('drops repeats', () => {
    expect(text('1450.00')).toEqual(['1500.00']);
    expect(text('1400.00')).toEqual(['1450.00', '1500.00']);
  });

  it('works for small totals', () => {
    expect(text('12.50')).toEqual(['50.00', '100.00', '500.00']);
  });
});

describe('paymentsCover', () => {
  const total = d('100.00');

  it('covers a sale with cash above the total and returns the change', () => {
    const result = paymentsCover(total, [{ method: 'CASH', amount: d('120.00') }]);
    expect(result).toEqual({ ok: true, change: d('20.00') });
  });

  it('refuses cash below the total', () => {
    expect(paymentsCover(total, [{ method: 'CASH', amount: d('99.99') }])).toMatchObject({ ok: false, error: 'INSUFFICIENT_PAYMENT' });
  });

  it('lets cash cover what a card left', () => {
    const result = paymentsCover(total, [
      { method: 'CARD', amount: d('60.00') },
      { method: 'CASH', amount: d('50.00') },
    ]);
    expect(result).toEqual({ ok: true, change: d('10.00') });
  });

  it('does not let a non-cash payment exceed the total', () => {
    const result = paymentsCover(total, [{ method: 'QR', amount: d('100.01') }]);
    expect(result).toMatchObject({ ok: false, error: 'NON_CASH_EXCEEDS_TOTAL' });
  });

  it('accepts exact non-cash payments', () => {
    expect(paymentsCover(total, [{ method: 'QR', amount: d('100.00') }])).toEqual({ ok: true, change: d('0.00') });
  });
});
